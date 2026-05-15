'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'data/reports');

// Derive DB and file paths from config.json if present, else legacy flat layout
let DB_PATH, BRAIN_PATH, PREFS_PATH;

const configJsonPath = path.join(ROOT, 'config.json');
if (fs.existsSync(configJsonPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
    const firstMailbox = (config.mailboxes || []).find(m => m.enabled !== false);
    if (firstMailbox) {
      const base = path.join(ROOT, 'data', 'mailboxes', firstMailbox.id);
      DB_PATH    = path.join(base, 'email-assistant.db');
      BRAIN_PATH = path.join(base, 'brain.md');
      PREFS_PATH = path.join(base, 'user-prefs.md');
      console.log(`Inspector: using mailbox "${firstMailbox.id}" (${firstMailbox.name || firstMailbox.id})`);
    }
  } catch (err) {
    console.warn(`Inspector: could not parse config.json — ${err.message}`);
  }
}

if (!DB_PATH) {
  DB_PATH    = path.join(ROOT, 'data/email-assistant.db');
  BRAIN_PATH = path.join(ROOT, 'data/brain.md');
  PREFS_PATH = path.join(ROOT, 'data/user-prefs.md');
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const app = express();

app.locals.db    = db;
app.locals.paths = { REPORTS_DIR, BRAIN_PATH, PREFS_PATH };

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/emails',    require('./routes/emails'));
app.use('/api/groups',    require('./routes/groups'));
app.use('/api/memory',    require('./routes/memory'));
app.use('/api/digests',   require('./routes/digests'));
app.use('/api',           require('./routes/files'));

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.INSPECTOR_PORT || 3001;
app.listen(PORT, () => {
  console.log(`Email Inspector running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
