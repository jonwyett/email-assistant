'use strict';

const { Router } = require('express');
const router = Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const rows = db.prepare(`
      SELECT
        id, memory_key, memory_type, memory_text, source,
        created_at, updated_at, expires_at,
        CASE
          WHEN expires_at IS NULL THEN 'permanent'
          WHEN expires_at > datetime('now') THEN 'active'
          ELSE 'expired'
        END AS status
      FROM memory_items
      ORDER BY
        CASE WHEN expires_at IS NULL OR expires_at > datetime('now') THEN 0 ELSE 1 END,
        updated_at DESC
    `).all();

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
