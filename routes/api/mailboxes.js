'use strict';

const { Router } = require('express');
const fs = require('fs');
const router = Router({ mergeParams: true });

// ── Dashboard stats ────────────────────────────────────────────────────────────

router.get('/dashboard', (req, res) => {
  const db = req.db;
  try {
    const total    = db.prepare('SELECT COUNT(*) AS n FROM emails').get().n;
    const analyzed = db.prepare('SELECT COUNT(*) AS n FROM email_analysis').get().n;
    const digested = db.prepare('SELECT COUNT(*) AS n FROM email_analysis WHERE digested_at IS NOT NULL').get().n;
    const pending  = db.prepare(`
      SELECT COUNT(*) AS n FROM emails e
      LEFT JOIN email_analysis ea ON ea.email_id = e.id
      WHERE ea.email_id IS NULL OR ea.digested_at IS NULL
    `).get().n;
    const groups   = db.prepare('SELECT COUNT(*) AS n FROM email_groups').get().n;
    const memory   = db.prepare(`
      SELECT COUNT(*) AS n FROM memory_items
      WHERE expires_at IS NULL OR expires_at > datetime('now')
    `).get().n;

    const recentRuns = (() => {
      try {
        return db.prepare(
          'SELECT id, run_type, started_at, completed_at, status, email_count, notes FROM processing_runs ORDER BY id DESC LIMIT 10'
        ).all();
      } catch (_) { return []; }
    })();

    res.json({ stats: { total, analyzed, digested, pending, groups, memory }, recentRuns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Emails ─────────────────────────────────────────────────────────────────────

router.get('/emails/categories', (req, res) => {
  const db = req.db;
  try {
    const rows = db.prepare(
      'SELECT DISTINCT category FROM email_analysis WHERE category IS NOT NULL ORDER BY category'
    ).all();
    res.json(rows.map(r => r.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/emails', (req, res) => {
  const db = req.db;
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 25));
  const offset   = (page - 1) * pageSize;
  const category = req.query.category || null;
  const digested = req.query.digested;

  const digestedFilter =
    digested === 'true'  ? 'AND ea.digested_at IS NOT NULL' :
    digested === 'false' ? 'AND (ea.digested_at IS NULL OR ea.email_id IS NULL)' : '';
  const categoryFilter = category ? 'AND ea.category = ?' : '';
  const params = category ? [category] : [];

  const where = `LEFT JOIN email_analysis ea ON ea.email_id = e.id WHERE 1=1 ${categoryFilter} ${digestedFilter}`;

  try {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM emails e ${where}`).get(...params).n;
    const rows  = db.prepare(`
      SELECT e.id, e.from_name, e.from_email, e.subject, e.received_at,
             ea.category, ea.importance, ea.summary,
             ea.include_in_digest, ea.digested_at,
             ea.possible_action_required, ea.likely_routine, ea.group_id
      FROM emails e ${where}
      ORDER BY e.received_at DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);

    res.json({ data: rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/emails/:eid', (req, res) => {
  const db = req.db;
  const id = parseInt(req.params.eid);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const row = db.prepare(`
      SELECT e.id, e.message_id, e.from_name, e.from_email, e.to_email,
             e.subject, e.received_at, e.raw_path, e.import_source, e.created_at,
             eb.clean_body, eb.clean_body_char_count, eb.text_body,
             ea.category, ea.event_type, ea.summary, ea.importance,
             ea.likely_routine, ea.possible_action_required,
             ea.include_in_digest, ea.analysis_json, ea.analyzed_at,
             ea.group_id, ea.digested_at
      FROM emails e
      LEFT JOIN email_bodies eb ON eb.email_id = e.id
      LEFT JOIN email_analysis ea ON ea.email_id = e.id
      WHERE e.id = ?
    `).get(id);

    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.analysis_json) try { row.analysis_json = JSON.parse(row.analysis_json); } catch (_) {}
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Groups ─────────────────────────────────────────────────────────────────────

function parseJsonField(val) {
  if (!val) return [];
  try { return JSON.parse(val); } catch (_) { return []; }
}

router.get('/groups', (req, res) => {
  const db = req.db;
  try {
    const rows = db.prepare(`
      SELECT eg.id, eg.group_key, eg.group_name, eg.group_summary,
             eg.routine_count, eg.include_in_digest,
             eg.notable_items, eg.aggregate_facts, eg.analyzed_at,
             COUNT(ea.email_id) AS email_count
      FROM email_groups eg
      LEFT JOIN email_analysis ea ON ea.group_id = eg.id
      GROUP BY eg.id ORDER BY eg.analyzed_at DESC
    `).all();
    rows.forEach(r => {
      r.notable_items   = parseJsonField(r.notable_items);
      r.aggregate_facts = parseJsonField(r.aggregate_facts);
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups/:gid', (req, res) => {
  const db = req.db;
  const id = parseInt(req.params.gid);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const group = db.prepare(`
      SELECT eg.*, COUNT(ea.email_id) AS email_count
      FROM email_groups eg
      LEFT JOIN email_analysis ea ON ea.group_id = eg.id
      WHERE eg.id = ? GROUP BY eg.id
    `).get(id);
    if (!group) return res.status(404).json({ error: 'Not found' });
    group.notable_items   = parseJsonField(group.notable_items);
    group.aggregate_facts = parseJsonField(group.aggregate_facts);
    if (group.analysis_json) try { group.analysis_json = JSON.parse(group.analysis_json); } catch (_) {}

    const emails = db.prepare(`
      SELECT e.id, e.from_name, e.from_email, e.subject, e.received_at,
             ea.category, ea.importance, ea.summary, ea.digested_at
      FROM emails e JOIN email_analysis ea ON ea.email_id = e.id
      WHERE ea.group_id = ? ORDER BY e.received_at DESC
    `).all(id);

    res.json({ group, emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Memory ─────────────────────────────────────────────────────────────────────

router.get('/memory', (req, res) => {
  const db = req.db;
  try {
    const rows = db.prepare(`
      SELECT id, memory_key, memory_type, memory_text, source,
             created_at, updated_at, expires_at,
             CASE
               WHEN expires_at IS NULL THEN 'permanent'
               WHEN expires_at > datetime('now') THEN 'active'
               ELSE 'expired'
             END AS status
      FROM memory_items
      ORDER BY CASE WHEN expires_at IS NULL OR expires_at > datetime('now') THEN 0 ELSE 1 END, updated_at DESC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Brain & Prefs ──────────────────────────────────────────────────────────────

router.get('/brain', (req, res) => {
  const brainPath = req.mailbox.paths.brain;
  try {
    const content = fs.existsSync(brainPath) ? fs.readFileSync(brainPath, 'utf8') : '# Inbox Brain\n\nNo data yet.';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/prefs', (req, res) => {
  const prefsPath = req.mailbox.paths.prefs;
  try {
    const content = fs.existsSync(prefsPath) ? fs.readFileSync(prefsPath, 'utf8') : '# My Inbox Preferences\n\nNo preferences set yet.';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/prefs', (req, res) => {
  const prefsPath = req.mailbox.paths.prefs;
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
  try {
    fs.mkdirSync(require('path').dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
