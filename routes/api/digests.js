'use strict';

const { Router } = require('express');
const fs   = require('fs');
const path = require('path');
const { getReportsDir } = require('../../src/config');
const router = Router();

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+\.txt$/;
const REPORTS_DIR   = getReportsDir();

router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(REPORTS_DIR)) return res.json({ files: [] });
    const files = fs.readdirSync(REPORTS_DIR)
      .filter(f => SAFE_FILENAME.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(REPORTS_DIR, f));
        return { filename: f, mtime: stat.mtime.toISOString(), size: stat.size };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:filename', (req, res) => {
  const { filename } = req.params;
  if (!SAFE_FILENAME.test(filename)) return res.status(400).json({ error: 'Invalid filename' });
  const fullPath = path.join(REPORTS_DIR, filename);
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ filename, content });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
