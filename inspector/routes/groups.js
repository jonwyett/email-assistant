'use strict';

const { Router } = require('express');
const router = Router();

function parseJsonField(val) {
  if (!val) return [];
  try { return JSON.parse(val); } catch (_) { return []; }
}

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const rows = db.prepare(`
      SELECT
        eg.id, eg.group_key, eg.group_name, eg.group_summary,
        eg.routine_count, eg.include_in_digest,
        eg.notable_items, eg.aggregate_facts,
        eg.analyzed_at,
        COUNT(ea.email_id) AS email_count
      FROM email_groups eg
      LEFT JOIN email_analysis ea ON ea.group_id = eg.id
      GROUP BY eg.id
      ORDER BY eg.analyzed_at DESC
    `).all();

    rows.forEach(r => {
      r.notable_items    = parseJsonField(r.notable_items);
      r.aggregate_facts  = parseJsonField(r.aggregate_facts);
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const group = db.prepare(`
      SELECT eg.*, COUNT(ea.email_id) AS email_count
      FROM email_groups eg
      LEFT JOIN email_analysis ea ON ea.group_id = eg.id
      WHERE eg.id = ?
      GROUP BY eg.id
    `).get(id);

    if (!group) return res.status(404).json({ error: 'Not found' });

    group.notable_items   = parseJsonField(group.notable_items);
    group.aggregate_facts = parseJsonField(group.aggregate_facts);
    if (group.analysis_json) {
      try { group.analysis_json = JSON.parse(group.analysis_json); } catch (_) {}
    }

    const emails = db.prepare(`
      SELECT
        e.id, e.from_name, e.from_email, e.subject, e.received_at,
        ea.category, ea.importance, ea.summary, ea.digested_at
      FROM emails e
      JOIN email_analysis ea ON ea.email_id = e.id
      WHERE ea.group_id = ?
      ORDER BY e.received_at DESC
    `).all(id);

    res.json({ group, emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
