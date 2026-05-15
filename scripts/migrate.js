'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

// Load .env directly (config.json doesn't exist yet at migration time)
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

const MAILBOX_ID = 'default';
const TARGET_BASE = path.join(PROJECT_ROOT, 'data', 'mailboxes', MAILBOX_ID);

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

function copyDirContents(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  const files = fs.readdirSync(srcDir);
  let copied = 0;
  for (const file of files) {
    const src  = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.statSync(src).isFile()) {
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        copied++;
      }
    }
  }
  return copied;
}

async function migrate() {
  console.log('=== Migration: single-mailbox → multi-mailbox ===');
  console.log(`Target mailbox id: "${MAILBOX_ID}"`);
  console.log(`Target dir: ${path.relative(PROJECT_ROOT, TARGET_BASE)}\n`);

  if (fs.existsSync(TARGET_BASE)) {
    console.log(`Target directory already exists. Migration may have already run.`);
    console.log('To re-run, delete the target dir first. Exiting safely.');
    return;
  }

  fs.mkdirSync(TARGET_BASE, { recursive: true });

  const results = [];

  // Database
  const dbSrc  = path.join(PROJECT_ROOT, 'data', 'email-assistant.db');
  const dbDest = path.join(TARGET_BASE, 'email-assistant.db');
  if (copyIfExists(dbSrc, dbDest)) {
    results.push('  data/email-assistant.db → data/mailboxes/default/email-assistant.db');
    // Also copy WAL files if present
    copyIfExists(dbSrc + '-shm', dbDest + '-shm');
    copyIfExists(dbSrc + '-wal', dbDest + '-wal');
  } else {
    results.push('  data/email-assistant.db — not found, skipped');
  }

  // brain.md
  if (copyIfExists(path.join(PROJECT_ROOT, 'data', 'brain.md'), path.join(TARGET_BASE, 'brain.md'))) {
    results.push('  data/brain.md → data/mailboxes/default/brain.md');
  }

  // user-prefs.md
  if (copyIfExists(path.join(PROJECT_ROOT, 'data', 'user-prefs.md'), path.join(TARGET_BASE, 'user-prefs.md'))) {
    results.push('  data/user-prefs.md → data/mailboxes/default/user-prefs.md');
  }

  // raw-emails/
  const rawCount = copyDirContents(
    path.join(PROJECT_ROOT, 'data', 'raw-emails'),
    path.join(TARGET_BASE, 'raw-emails')
  );
  results.push(`  data/raw-emails/ → data/mailboxes/default/raw-emails/ (${rawCount} file(s))`);

  // parsed-emails/
  const parsedCount = copyDirContents(
    path.join(PROJECT_ROOT, 'data', 'parsed-emails'),
    path.join(TARGET_BASE, 'parsed-emails')
  );
  results.push(`  data/parsed-emails/ → data/mailboxes/default/parsed-emails/ (${parsedCount} file(s))`);

  console.log('Copied:');
  results.forEach(r => console.log(r));

  console.log(`
Next steps:
  1. Copy config.json.example to config.json and fill in your credentials.
     Use "default" as the mailbox id to match the migrated data.
  2. Run: npm run go
  3. Once verified, you can safely delete the original data files:
       data/email-assistant.db
       data/brain.md
       data/user-prefs.md
       data/raw-emails/
       data/parsed-emails/
`);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
