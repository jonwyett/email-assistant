'use strict';

const { Router } = require('express');
const router = Router();

router.get('/categories', (req, res) => {
  const db = req.app.locals.db;
  try {
    const rows = db.prepare(
      'SELECT DISTINCT category FROM email_analysis WHERE category IS NOT NULL ORDER BY category'
    ).all();
    res.json(rows.map(r => r.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const page     = Math.max(1, parseInt(req.query.page)     || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 25));
  const offset   = (page - 1) * pageSize;
  const category = req.query.category || null;
  const digested = req.query.digested;  // 'true', 'false', or undefined

  const digestedFilter =
    digested === 'true'  ? 'AND ea.digested_at IS NOT NULL' :
    digested === 'false' ? 'AND (ea.digested_at IS NULL OR ea.email_id IS NULL)' :
    '';

  const categoryFilter = category ? 'AND ea.category = ?' : '';
  const params = category ? [category] : [];

  const where = `
    LEFT JOIN email_analysis ea ON ea.email_id = e.id
    WHERE 1=1 ${categoryFilter} ${digestedFilter}
  `;

  try {
    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM emails e ${where}`
    ).get(...params).n;

    const rows = db.prepare(`
      SELECT
        e.id, e.from_name, e.from_email, e.subject, e.received_at,
        ea.category, ea.importance, ea.summary,
        ea.include_in_digest, ea.digested_at,
        ea.possible_action_required, ea.likely_routine,
        ea.group_id
      FROM emails e ${where}
      ORDER BY e.received_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);

    res.json({
      data: rows,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = db.prepare(`
      SELECT
        e.id, e.message_id, e.from_name, e.from_email, e.to_email,
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

    if (row.analysis_json) {
      try { row.analysis_json = JSON.parse(row.analysis_json); } catch (_) {}
    }

    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
