'use strict';

const path      = require('path');
const fs        = require('fs');
const express   = require('express');
const logStream = require('./src/log-stream');
const scheduler = require('./src/scheduler');
const { loadConfig, getMailboxPaths } = require('./src/config');
const { getDb }  = require('./src/database');

// Intercept console.* before any other requires so all output is captured
logStream.install();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Read once at startup; injected per-request with APP_CENTER_BASE_PATH
const _indexHtml = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

// ── Config & app state ────────────────────────────────────────────────────────

const appConfig = loadConfig();
const { mailboxes } = appConfig;

app.locals.appConfig = appConfig;
app.locals.scheduler = scheduler;

// ── Run-daily wrapper (imported lazily to avoid circular logger issues) ────────

let _runDailyFn = null;
function runDaily() {
  if (!_runDailyFn) {
    // Import run-daily logic without executing it (it guards with require.main === module)
    const rd = require('./scripts/run-daily');
    _runDailyFn = rd.runDaily || (() => { throw new Error('runDaily not exported'); });
  }
  return _runDailyFn();
}
app.locals.runDaily = runDaily;

// ── Mailbox param middleware ───────────────────────────────────────────────────

app.param('mailboxId', (req, res, next, id) => {
  const mailbox = mailboxes.find(m => m.id === id);
  if (!mailbox) return res.status(404).json({ error: `Mailbox "${id}" not found` });
  req.mailbox = mailbox;
  req.db = getDb(id);
  next();
});

// ── API routes ────────────────────────────────────────────────────────────────

const mailboxRoutes = require('./routes/api/mailboxes');

// Mailbox list
app.get('/api/mailboxes', (req, res) => {
  res.json(mailboxes.map(m => ({ id: m.id, name: m.name, enabled: m.enabled })));
});

// Per-mailbox data routes
app.use('/api/mailboxes/:mailboxId', mailboxRoutes);

// Shared / global routes
app.use('/api/digests', require('./routes/api/digests'));
app.use('/api/run',    require('./routes/api/run'));
app.use('/api/logs',   require('./routes/api/logs'));
app.use('/api/config', require('./routes/api/config'));

// SPA fallback — injects window._basePath so the frontend can prefix API calls
// correctly when running behind the App Center reverse proxy.
app.get('/{*path}', (req, res) => {
  const basePath = process.env.APP_CENTER_BASE_PATH || '';
  const html = _indexHtml.replace(
    '<head>',
    `<head>\n<script>window._basePath=${JSON.stringify(basePath)};</script>`
  );
  res.type('html').send(html);
});

// ── Scheduler ─────────────────────────────────────────────────────────────────

scheduler.start(appConfig.schedule, runDaily);

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT || appConfig.port);
app.listen(PORT, () => {
  console.log(`Email Assistant server running at http://localhost:${PORT}`);
  console.log(`Mailboxes: ${mailboxes.filter(m => m.enabled).map(m => m.name).join(', ') || '(none enabled)'}`);
});
