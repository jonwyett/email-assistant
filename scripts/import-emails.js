'use strict';

const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const { loadConfig, resolveMailboxArg } = require('../src/config');
const { getDb } = require('../src/database');
const { buildCleanBody } = require('../src/email-cleaner');

const PROJECT_ROOT = path.join(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, '../fixtures/emails');

async function importEmails(mailbox, sourceDir) {
  const dir = sourceDir || mailbox.paths.rawEmails;
  const db = getDb(mailbox.id);

  const emlFiles = fs.readdirSync(dir)
    .filter(f => f.endsWith('.eml'))
    .sort();

  if (emlFiles.length === 0) {
    console.log(`  No .eml files found in ${path.relative(PROJECT_ROOT, dir)}`);
    return { imported: 0, skipped: 0 };
  }

  const label = path.relative(PROJECT_ROOT, dir);
  console.log(`  Importing from ${label} — ${emlFiles.length} file(s)`);

  const parsed = [];
  for (const emlFile of emlFiles) {
    const emlPath = path.join(dir, emlFile);
    const mail = await simpleParser(fs.readFileSync(emlPath));
    parsed.push({ emlFile, emlPath, mail });
  }

  const insertEmail = db.prepare(`
    INSERT OR IGNORE INTO emails
      (message_id, from_name, from_email, to_email, subject, received_at, raw_path, import_source)
    VALUES
      (@messageId, @fromName, @fromEmail, @toEmail, @subject, @receivedAt, @rawPath, @importSource)
  `);

  const insertBody = db.prepare(`
    INSERT OR IGNORE INTO email_bodies
      (email_id, text_body, html_body, clean_body, clean_body_char_count)
    VALUES
      (@emailId, @textBody, @htmlBody, @cleanBody, @cleanBodyCharCount)
  `);

  let imported = 0;
  let skipped = 0;

  const importAll = db.transaction(() => {
    for (const { emlFile, emlPath, mail } of parsed) {
      const messageId = mail.messageId || `no-id::${emlFile}`;
      const fromAddr = mail.from?.value?.[0];
      const toAddr = mail.to?.value?.[0];
      const cleanBody = buildCleanBody(mail);

      const result = insertEmail.run({
        messageId,
        fromName:   fromAddr?.name    || '',
        fromEmail:  fromAddr?.address || '',
        toEmail:    toAddr?.address   || '',
        subject:    mail.subject      || '(no subject)',
        receivedAt: mail.date?.toISOString() || null,
        rawPath:    path.relative(PROJECT_ROOT, emlPath),
        importSource: label,
      });

      if (result.changes === 0) {
        skipped++;
        continue;
      }

      const emailId = result.lastInsertRowid;
      insertBody.run({
        emailId,
        textBody:           mail.text || null,
        htmlBody:           mail.html || null,
        cleanBody,
        cleanBodyCharCount: cleanBody.length,
      });

      imported++;
    }
  });

  importAll();

  console.log(`  Done — ${imported} imported, ${skipped} skipped`);
  return { imported, skipped };
}

module.exports = { importEmails };

if (require.main === module) {
  const { mailboxes } = loadConfig();
  const mailbox = resolveMailboxArg(mailboxes);
  const useFixtures = process.argv.includes('--fixtures');
  const sourceDir = useFixtures ? FIXTURES_DIR : mailbox.paths.rawEmails;
  importEmails(mailbox, sourceDir).catch(err => {
    console.error('Import failed:', err.message);
    process.exit(1);
  });
}
