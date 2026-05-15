'use strict';

const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');
const { loadConfig, resolveMailboxArg } = require('../src/config');
const { getDb } = require('../src/database');

const PROJECT_ROOT = path.join(__dirname, '..');
const FALLBACK_DAYS = 7;

function formatTimestamp(date) {
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split('T');
  const timeStr = timePart.replace(/:/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${datePart}T${timeStr}`;
}

function getSinceDate(db) {
  try {
    const row = db.prepare('SELECT MAX(received_at) as last FROM emails').get();
    if (row?.last) {
      const d = new Date(row.last);
      d.setDate(d.getDate() - 1);
      return d;
    }
  } catch (_) {}

  const d = new Date();
  d.setDate(d.getDate() - FALLBACK_DAYS);
  return d;
}

async function downloadLatestEmails(mailbox) {
  const { rawEmails: RAW_DIR, parsedEmails: PARSED_DIR } = mailbox.paths;
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(PARSED_DIR, { recursive: true });

  const db = getDb(mailbox.id);
  const { imap } = mailbox;

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: {
      user: imap.user,
      pass: imap.password,
    },
    logger: false,
  });

  await client.connect();
  console.log(`  Connected to ${imap.host}`);

  const lock = await client.getMailboxLock('INBOX');

  let downloaded = 0;
  try {
    const sinceDate = getSinceDate(db);
    console.log(`  Searching since ${sinceDate.toDateString()}...`);

    const uids = await client.search({ since: sinceDate }, { uid: true });

    if (uids.length === 0) {
      console.log('  No new emails found.');
      return { downloaded: 0 };
    }

    console.log(`  Found ${uids.length} email(s) — downloading...`);

    const runTimestamp = formatTimestamp(new Date());
    let index = 1;

    for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
      const baseName = `${runTimestamp}_email_${index}`;
      const emlPath = path.join(RAW_DIR, `${baseName}.eml`);
      const metaPath = path.join(PARSED_DIR, `${baseName}.metadata.json`);

      fs.writeFileSync(emlPath, msg.source);

      const env = msg.envelope;
      const metadata = {
        baseName,
        uid: msg.uid,
        seq: msg.seq,
        subject: env.subject || '(no subject)',
        from: (env.from || []).map(a => ({ name: a.name || '', address: a.address || '' })),
        to: (env.to || []).map(a => ({ name: a.name || '', address: a.address || '' })),
        date: env.date ? env.date.toISOString() : null,
        emlPath: path.relative(PROJECT_ROOT, emlPath),
        downloadedAt: new Date().toISOString(),
      };

      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

      const fromAddr = metadata.from[0]?.address || 'unknown';
      console.log(`  [${index}] uid:${msg.uid} | ${fromAddr} | ${metadata.subject}`);
      index++;
      downloaded++;
    }

    console.log(`\n  Saved ${downloaded} email(s)`);

    if (imap.markRead && uids.length > 0) {
      await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      console.log(`  Marked ${uids.length} email(s) as read`);
    }
  } finally {
    lock.release();
  }

  await client.logout();
  return { downloaded };
}

module.exports = { downloadLatestEmails };

if (require.main === module) {
  const { mailboxes } = loadConfig();
  const mailbox = resolveMailboxArg(mailboxes);
  downloadLatestEmails(mailbox).catch(err => {
    console.error('Download failed:', err.message);
    if (err.response) console.error('Server response:', err.response);
    if (err.code) console.error('Error code:', err.code);
    process.exit(1);
  });
}
