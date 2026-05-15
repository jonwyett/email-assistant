# Email Watchdog Assistant — Project Context

## What This Is

A local-first Node.js application that monitors one or more Gmail inboxes, runs LLM-based analysis on incoming emails, and delivers a unified plain-text "what's new?" digest covering everything not yet processed. Run it daily, weekly, or ad-hoc — it always processes the backlog since the last run. The inbox is mostly noise; the goal is to surface the small number of emails that aren't.

See `docs/project-overview-phase1.md` for the full design philosophy and `docs/spint-list.md` for the original sprint plan (treat both as reference, not gospel — we've deviated where it made sense).

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (CommonJS modules throughout) |
| Email retrieval | `imapflow` via Gmail IMAP |
| Email parsing | `mailparser` + `html-to-text` |
| Email sending | `nodemailer` v8 |
| Storage | SQLite via `better-sqlite3` |
| LLM | LM Studio — OpenAI-compatible API at `http://localhost:1234/v1` |

**Note on module style:** VS Code will persistently suggest converting files to ES modules. Ignore this — the project is intentionally CommonJS for `better-sqlite3` compatibility.

---

## Key Decisions Made

**Gmail instead of Hotmail.** Microsoft personal accounts require OAuth2/Modern Auth only — app passwords don't work for IMAP. Switched to Gmail, which supports app passwords with IMAP when 2FA is enabled.

**LM Studio, no `response_format`.** The model in use is `google/gemma-3-4b`. It does not support `response_format: {type: "json_object"}` — causes a 400 error. JSON output is obtained through prompt engineering alone, with a code-fence fallback parser in `src/llm-client.js`.

**Prompts as markdown files.** All LLM prompts live in `/prompts/` as `.md` files with `{{placeholder}}` interpolation. The loader is `src/prompts.js`. Keeps prompt content out of application code.

**Scripts export + guard pattern.** Every script exports its main function and guards direct invocation with `require.main === module`. This allows `scripts/run-daily.js` to import and call them directly without spawning child processes.

**Download uses DB-driven SINCE search.** `scripts/download-latest-emails.js` queries `MAX(received_at)` from the DB, subtracts 1 day for overlap safety, and searches IMAP SINCE that date. On first run (empty DB) falls back to 7 days. Deduplication happens at import time via `message_id`.

**"What's new?" model.** `email_analysis.digested_at` tracks which emails have been processed. `NULL` = pending. Grouping and digest both scope to undigested emails only. After a successful digest build, all included emails are marked `digested_at = datetime('now')`. Re-running the pipeline immediately produces "No new emails to digest."

**Deterministic marketing suppression.** In `build-digest.js`, groups where all emails score importance ≤ 2 are excluded from the LLM prompt entirely and counted directly in "Ignored". This prevents marketing from leaking into digest sections regardless of LLM judgment.

**User preferences file.** `data/mailboxes/{id}/user-prefs.md` is a user-editable plain-English rules file injected into Pass 1 and Pass 3 as hard constraints. Edit it to teach the system what to suppress or flag.

**Multi-mailbox architecture.** Each mailbox is a fully independent assistant with its own DB, brain.md, user-prefs.md, and raw-emails directory under `data/mailboxes/{id}/`. Pass 3 (digest) runs once per mailbox with that mailbox's own prefs, producing a per-mailbox section. Pass 4 (reflect) updates each mailbox's brain.md using only that mailbox's section — brains do not cross-contaminate. The per-mailbox sections are then stitched into one unified digest file that is sent. Configuration moved from `.env` to `config.json` (gitignored; `config.json.example` is the committed template). Run `npm run migrate` once to move existing single-mailbox data to `data/mailboxes/default/`. `.env` still works as a fallback for single-mailbox setups.

---

## Unified Server & Web Interface

The app runs as a persistent server (`npm start` → `node server.js`, port 3000) that combines the Express API, a cron scheduler, and a management SPA into one process.

**Scheduler:** `src/scheduler.js` wraps `node-cron`. The schedule is loaded from `config.json` (`global.schedule`, default `0 7 * * *`) at startup and can be updated live via `PUT /api/config/schedule` without restarting. Only one pipeline run executes at a time — `POST /api/run` returns 409 if already running.

**Log streaming:** `src/log-stream.js` intercepts all `console.log/error/warn` calls globally at startup, buffers the last 500 entries, and streams new entries to subscribers. The SSE endpoint `GET /api/logs` replays the buffer then streams live — the browser shows real-time pipeline output.

**Management SPA (`public/index.html`, port 3000):** Full management interface. Features:
- Dashboard with mailbox stats and recent processing runs
- Email browser (paginated, filterable by category/status, full detail modal)
- Group browser with member email drill-down
- Memory item viewer
- Digest history viewer
- Brain.md viewer and user-prefs editor (`PUT /api/mailboxes/:id/prefs`)
- Scheduler controls: trigger "Run Now", view status, update cron schedule

**API routes (`routes/api/`):**

| Route | Purpose |
|---|---|
| `GET /api/mailboxes` | List all mailboxes |
| `GET /api/mailboxes/:id/dashboard` | Stats + recent runs |
| `GET /api/mailboxes/:id/emails` | Paginated email list |
| `GET /api/mailboxes/:id/emails/:eid` | Full email detail |
| `GET /api/mailboxes/:id/groups` | Group list |
| `GET /api/mailboxes/:id/groups/:gid` | Group detail + members |
| `GET /api/mailboxes/:id/memory` | Memory items |
| `GET /api/mailboxes/:id/brain` | brain.md content |
| `GET /api/mailboxes/:id/prefs` | user-prefs.md content |
| `PUT /api/mailboxes/:id/prefs` | Update user-prefs.md |
| `GET /api/digests` | List saved digest files |
| `GET /api/digests/:filename` | Read a digest |
| `GET /api/run/status` | Scheduler status |
| `POST /api/run` | Trigger pipeline manually |
| `GET /api/logs` | SSE log stream |
| `GET /api/config` | Sanitized config (no passwords) |
| `PUT /api/config/schedule` | Update + hot-reload cron schedule |

**Deployment:** `process.json` provides PM2 config. Run `pm2 start process.json` for auto-restart on failure. Logs go to `logs/pm2-error.log` and `logs/pm2-out.log`.

---

## What's Been Built

**Sprint 0 — Gmail IMAP connection**
- Downloads new emails as `.eml` files to `data/raw-emails/`
- SINCE-based fetch (DB-driven); optional mark-as-read via `IMAP_MARK_READ=true`

**Sprint 1 — SQLite storage**
- DB at `data/mailboxes/{id}/email-assistant.db` (was `data/email-assistant.db` pre-multi-mailbox)
- Tables: `emails`, `email_bodies`, `email_analysis`, `email_groups`, `memory_items`, `processing_runs`
- Import deduplicates by `message_id`

**Sprint 2 — LM Studio connectivity**
- `src/llm-client.js`: `chat()`, `chatJson()`, `checkHealth()`, `selectModel()` — timeout, offline error handling, model availability check

**Sprint 3 — Pass 1: single email analysis**
- `src/analysis.js`: `analyzeEmail(email, body, memories)` — builds prompt with brain + prefs + scratch memory, calls LLM
- Fields: `category`, `event_type`, `sender_type`, `summary`, `importance` (1–10), `likely_routine`, `possible_action_required`, `reason`, `memory_ops`
- Results stored in `email_analysis`

**Sprint 4 — Digest (Pass 3)**
- LLM receives grouped or flat email summaries → structured JSON (needs_attention / worth_noting / activity_summary / suppressed)
- Report header shows actual email date range and count
- Saved to `data/reports/YYYY-MM-DD[-N]-digest.txt` (auto-increments if run multiple times same day)

**Sprint 5 — Send digest**
- `scripts/send-digest.js` reads most recent saved digest (or named file), sends via nodemailer
- Subject line taken from first line of the digest file
- SMTP via Gmail on port 587 (STARTTLS)

**Sprint 6 — Grouping/aggregation (Pass 2)**
- `scripts/group-emails.js`: groups undigested emails by sender domain + category
- Singletons synthesized from Pass 1 data (no LLM call); multi-email groups run Pass 2 LLM
- Clears `email_groups` and resets `group_id` at start of each run — always a fresh batch
- `email_analysis.group_id` links each email to its group

**Sprint 7 — Scratch memory**
- `src/memory.js`: `getActiveMemories`, `applyMemoryOps`, `cleanExpiredMemories`
- LLM can return `memory_ops` in Pass 1 response to write/update/delete `memory_items` rows
- Active memories injected into every Pass 1 prompt; expired items cleaned at start of each `npm run go`
- TTL controlled by LLM (`ttl_days` field)

**Sprint 8 — Brain.md**
- `scripts/reflect.js`: Pass 4 — reads today's digest + current brain.md, asks LLM to produce updated brain.md
- `data/brain.md`: compact learned knowledge (known senders, patterns, baselines)
- Injected into Pass 1 system prompt so future analysis is context-aware
- Runs after send in `npm run go`; failure is non-fatal

**Post-sprint features**
- **User preferences:** `data/user-prefs.md` (user-editable) injected into Pass 1 + Pass 3 as hard rules
- **"What's new?" model:** `digested_at` tracking, undigested scoping, `--since Nd` CLI flag for digest
- **Prompt tightening:** importance scale clarified (marketing always 1–2), Pass 3 hard rule for suppression
- **LLM pre-flight check:** `run-daily.js` calls `checkHealth()` before any pipeline step — hard-aborts if LM Studio is unreachable, requested model is missing, or no models are loaded. `llm_preference` (config.json) or `LLM_PREFERENCE` (.env) picks the best available model when `llm_model` is blank.
- **Housecleaning:** `scripts/housecleaning.js` runs per mailbox — deletes emails (and their `.eml`, `.metadata.json`, `.parsed.json` files) older than `retention_days` (default 30), then VACUUMs the DB.
- **Multi-mailbox:** `config.json` replaces `.env` as the primary config. Each mailbox runs its own download→import→analyze→group→housecleaning loop. `build-digest.js` runs Pass 3 independently per mailbox (with each mailbox's own prefs), then stitches the per-mailbox sections into a unified digest file. `reflect.js` updates each mailbox's brain.md using only that mailbox's own digest section, preventing cross-mailbox brain contamination.

**Pipeline (npm run go)**

Pre-flight: verify LM Studio is reachable and a model is available — hard-abort if not.

For each enabled mailbox:
1. Download new emails from Gmail IMAP
2. Import `.eml` files → SQLite
3. Analyze unanalyzed emails (Pass 1, with brain + prefs + memory)
4. Group undigested emails (Pass 2)
5. Housecleaning — delete emails older than `retention_days`, vacuum DB

Global (once, after all mailboxes):
6. Build digest — Pass 3 runs per mailbox with each mailbox's own prefs, producing a per-mailbox section; sections stitched into unified file; emails marked as digested
7. Reflect — each mailbox's brain.md updated from its own digest section only (Pass 4, isolated per mailbox)
8. Send digest email

Error tiers: pre-flight failure → abort; per-mailbox download/import failure → skip that mailbox; analysis/grouping/reflect/housecleaning failure → warn and continue; digest failure → abort; send failure → warn and continue.

---

## File Structure

```
server.js                   ← persistent server entry point (npm start, port 3000)
process.json                ← PM2 deployment config

routes/api/
  mailboxes.js              ← per-mailbox data + PUT /prefs (write)
  digests.js                ← GET /digests, GET /digests/:filename
  run.js                    ← GET /run/status, POST /run (manual trigger)
  logs.js                   ← GET /logs — SSE stream of console output
  config.js                 ← GET /config (sanitized), PUT /config/schedule

public/
  index.html                ← management SPA (served by main server, port 3000)

scripts/
  run-daily.js              ← full pipeline (npm run go) — loops over mailboxes, then digest+send
  download-latest-emails.js ← IMAP fetch → .eml files per mailbox
  import-emails.js          ← .eml files → mailbox SQLite (--fixtures for dev, default: mailbox raw-emails/)
  parse-local-emails.js     ← .eml → .parsed.json (debug/inspection tool, not multi-mailbox-aware)
  analyze-emails.js         ← Pass 1: LLM analysis → email_analysis table
  group-emails.js           ← Pass 2: group by domain+category → email_groups table
  build-digest.js           ← Pass 3: per-mailbox digest sections → stitched unified file → data/reports/
  send-digest.js            ← sends most recent saved digest via SMTP
  reflect.js                ← Pass 4: updates mailbox brain.md from digest
  housecleaning.js          ← delete old emails + vacuum DB (per mailbox)
  migrate.js                ← one-time migration: flat data/ → data/mailboxes/default/
  test-llm.js               ← connectivity test + single email analysis

src/
  config.js                 ← loadConfig() (config.json or .env fallback), getMailboxPaths(), resolveMailboxArg()
  database.js               ← getDb(mailboxId) — per-mailbox Map cache, schema init + migrations
  scheduler.js              ← node-cron wrapper: start(), runNow(), getStatus(); single-run guard
  log-stream.js             ← install() patches console.*; circular buffer; subscribe(fn) for SSE
  llm-client.js             ← chat(), chatJson(), checkHealth(), selectModel()
  prompts.js                ← loadPrompt(name, vars) — reads from /prompts/
  email-cleaner.js          ← buildCleanBody(parsed) — shared HTML→text logic
  analysis.js               ← analyzeEmail(email, body, memories, mailboxId) — Pass 1 logic
  memory.js                 ← scratch memory read/write/cleanup
  brain.js                  ← loadBrain(mailboxId) / writeBrain(mailboxId, content)
  prefs.js                  ← loadPrefs(mailboxId) — silent if missing

prompts/
  pass1-system.md           ← system prompt: role, rules, brain context, user prefs
  pass1-user.md             ← user prompt: {{memory}}, email, JSON schema with memory_ops
  pass2-system.md           ← system prompt for group aggregation
  pass2-user.md             ← user prompt: {{count}}, {{group_name}}, {{emails}}
  pass3-system.md           ← system prompt: digest rules, hard marketing rule, user prefs
  pass3-user.md             ← user prompt: {{date}}, {{total}}, {{emails}}
  pass4-system.md           ← system prompt for brain.md reflection
  pass4-user.md             ← user prompt: {{brain}}, {{date}}, {{digest}}

config.json                 ← gitignored; copy from config.json.example
config.json.example         ← committed template

data/                       ← runtime data, gitignored
  mailboxes/
    {id}/
      email-assistant.db    ← per-mailbox SQLite
      brain.md              ← LLM-generated; do not edit manually
      user-prefs.md         ← user-editable suppression/flagging rules
      raw-emails/           ← downloaded .eml files
      parsed-emails/        ← metadata + parsed JSON
  reports/                  ← generated digest text files (global, shared)

fixtures/emails/            ← .eml files for offline dev, gitignored
docs/                       ← this file and project design docs
```

---

## Inspector (Legacy Read-Only Data Viewer)

A read-only web UI for inspecting the database and runtime files. Lives in `inspector/` as a **standalone** Express app with its own `package.json` and `node_modules` — completely separate from the main server.

> **Note:** The main server at port 3000 now provides a superset of what the Inspector shows, plus write capabilities (edit prefs, trigger runs). The Inspector is retained as a lightweight, dependency-free viewer that can run independently.

**Start:** `cd inspector && npm start`  
**Port:** 3001 (override with `INSPECTOR_PORT` env var)  
**Access:** http://localhost:3001  

The server opens the SQLite DB in `readonly` mode — it cannot modify any data. With `config.json` present it reads the first enabled mailbox's DB and files; without it, it falls back to the legacy `data/email-assistant.db` path.

### Tabs

| Tab | What it shows |
|---|---|
| **Dashboard** | DB stats (total / analyzed / digested / pending emails, active groups, active memory items) + last 10 processing runs |
| **Emails** | Paginated email list; filterable by category and digested status; click any row for full detail (body, analysis JSON, all fields) |
| **Groups** | Current `email_groups` rows with email count, summary, notable items, aggregate facts; click for group detail + member emails |
| **Memory** | All `memory_items` rows with active/expired/permanent status badges |
| **Digests** | Lists saved digest `.txt` files from `data/reports/`; click to view full digest content |
| **Brain & Prefs** | Side-by-side read-only view of `data/brain.md` and `data/user-prefs.md` |

### File layout

```
inspector/
  server.js              ← Express entry point; opens DB readonly; registers routes
  package.json           ← separate deps (express only); start with `npm start`
  public/
    index.html           ← single-page Bootstrap 5 UI (all JS inline)
  routes/
    dashboard.js         ← GET /api/dashboard — stats + recent runs
    emails.js            ← GET /api/emails, /api/emails/:id, /api/emails/categories
    groups.js            ← GET /api/groups, /api/groups/:id
    memory.js            ← GET /api/memory
    digests.js           ← GET /api/digests, /api/digests/:filename
    files.js             ← GET /api/brain, /api/prefs
```

---

## npm Scripts

Most scripts require `-- --mailbox <id>` when run standalone. `npm run go` and `npm run digest` operate on all enabled mailboxes automatically.

| Command | Does |
|---|---|
| `npm start` | Start persistent server with scheduler (port 3000) |
| `npm run go` | Full pipeline: all mailboxes → digest → send (one-shot CLI) |
| `npm run migrate` | One-time migration: flat data/ → data/mailboxes/default/ |
| `npm run download -- --mailbox <id>` | Download new emails from Gmail IMAP |
| `npm run import -- --mailbox <id>` | Import fixtures/emails/ into mailbox DB (offline dev) |
| `npm run import:live -- --mailbox <id>` | Import mailbox raw-emails/ into DB |
| `npm run parse` | Parse `.eml` files to JSON (debug tool, legacy) |
| `npm run analyze -- --mailbox <id>` | Run Pass 1 LLM analysis on unanalyzed emails |
| `npm run group -- --mailbox <id>` | Run Pass 2 grouping on undigested emails |
| `npm run digest` | Build unified digest from all enabled mailboxes |
| `npm run digest -- --since 7d` | Digest: undigested emails from last N days only |
| `npm run send-digest` | Send most recent saved digest |
| `npm run send-digest [file]` | Send a specific digest file or date |
| `npm run reflect -- --mailbox <id>` | Update brain.md from most recent digest |
| `npm run housecleaning -- --mailbox <id>` | Delete old emails + vacuum DB |
| `npm run test-llm -- --mailbox <id> [email_id]` | Test LM Studio connectivity + analyze one email |

---

## Configuration

**Preferred:** Copy `config.json.example` to `config.json` and fill in your credentials.

**Legacy fallback:** If `config.json` is absent, `loadConfig()` reads `.env` and synthesizes a single-mailbox config with id `"default"`. Existing `.env` setups require no changes.

```json
{
  "global": {
    "llm_base_url": "http://localhost:1234/v1",
    "llm_model": "",
    "llm_preference": ["gemma-3", "gemma", "llama-3"],
    "retention_days": 30,
    "report_to": "your_digest@example.com",
    "smtp": { "host": "smtp.gmail.com", "port": 587, "user": "...", "password": "..." }
  },
  "mailboxes": [
    { "id": "personal", "name": "Personal Gmail", "enabled": true,
      "imap": { "host": "imap.gmail.com", "port": 993, "secure": true,
                "user": "...", "password": "...", "mark_read": false } }
  ]
}
```
