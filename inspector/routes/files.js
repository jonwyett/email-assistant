'use strict';

const { Router } = require('express');
const fs = require('fs');
const router = Router();

function readOrDefault(filePath, fallback) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback;
  } catch (_) {
    return fallback;
  }
}

router.get('/brain', (req, res) => {
  const content = readOrDefault(
    req.app.locals.paths.BRAIN_PATH,
    '# Inbox Brain\n\nNo data yet.'
  );
  res.json({ content });
});

router.get('/prefs', (req, res) => {
  const content = readOrDefault(
    req.app.locals.paths.PREFS_PATH,
    '# My Inbox Preferences\n\nNo preferences set yet.'
  );
  res.json({ content });
});

module.exports = router;
