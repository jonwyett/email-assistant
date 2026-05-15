'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig, resolveMailboxArg } = require('../src/config');
const { getDb } = require('../src/database');

function deleteIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`  Warning: could not delete ${filePath}: ${err.message}`);
    }
  }
}

async function housecleaning(mailbox) {
  const config = loadConfig();
  const { retentionDays } = config;
  const db = getDb(mailbox.id);
  const PROJECT_ROOT = path.join(__dirname, '..');

  const old = db.prepare(
    `SELECT id, raw_path FROM emails WHERE received_at < datetime('now', '-${retentionDays} days')`
  ).all();

  if (old.length === 0) {
    console.log(`  Housecleaning: nothing to remove (retention: ${retentionDays} days)`);
    return;
  }

  for (const row of old) {
    if (row.raw_path) {
      const absEml = path.join(PROJECT_ROOT, row.raw_path);
      deleteIfExists(absEml);

      const baseName = path.basename(row.raw_path, '.eml');
      deleteIfExists(path.join(mailbox.paths.parsedEmails, `${baseName}.metadata.json`));
      deleteIfExists(path.join(mailbox.paths.parsedEmails, `${baseName}.parsed.json`));
    }
  }

  const ids = old.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');

  db.prepare(`DELETE FROM email_analysis WHERE email_id IN (${placeholders})`).run(ids);
  db.prepare(`DELETE FROM email_bodies WHERE email_id IN (${placeholders})`).run(ids);
  db.prepare(`DELETE FROM emails WHERE id IN (${placeholders})`).run(ids);

  db.exec('VACUUM');

  console.log(`  Housecleaning: removed ${old.length} email(s) older than ${retentionDays} days`);
}

module.exports = { housecleaning };

if (require.main === module) {
  const { mailboxes } = loadConfig();
  const mailbox = resolveMailboxArg(mailboxes);
  housecleaning(mailbox).catch(err => {
    console.error('Housecleaning failed:', err.message);
    process.exit(1);
  });
}
