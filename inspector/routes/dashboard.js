'use strict';

const { Router } = require('express');
const router = Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const total     = db.prepare('SELECT COUNT(*) AS n FROM emails').get().n;
    const analyzed  = db.prepare('SELECT COUNT(*) AS n FROM email_analysis').get().n;
    const digested  = db.prepare('SELECT COUNT(*) AS n FROM email_analysis WHERE digested_at IS NOT NULL').get().n;
    const pending   = db.prepare(`
      SELECT COUNT(*) AS n FROM emails e
      LEFT JOIN email_analysis ea ON ea.email_id = e.id
      WHERE ea.email_id IS NULL OR ea.digested_at IS NULL
    `).get().n;
    const groups    = db.prepare('SELECT COUNT(*) AS n FROM email_groups').get().n;
    const memory    = db.prepare(`
      SELECT COUNT(*) AS n FROM memory_items
      WHERE expires_at IS NULL OR expires_at > datetime('now')
    `).get().n;

    const recentRuns = db.prepare(`
      SELECT id, run_type, started_at, completed_at, status, email_count, notes
      FROM processing_runs
      ORDER BY id DESC
      LIMIT 10
    `).all();

    res.json({
      stats: { total, analyzed, digested, pending, groups, memory },
      recentRuns
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
