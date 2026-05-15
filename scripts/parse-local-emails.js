'use strict';

const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const { buildCleanBody } = require('../src/email-cleaner');

const RAW_DIR = path.join(__dirname, '../data/raw-emails');
const PARSED_DIR = path.join(__dirname, '../data/parsed-emails');

async function parseLocalEmails() {
  const emlFiles = fs.readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.eml'))
    .sort();

  if (emlFiles.length === 0) {
    console.log('No .eml files found in data/raw-emails/\nRun `npm run download` first.');
    return;
  }

  console.log(`Found ${emlFiles.length} .eml file(s)\n`);

  for (const emlFile of emlFiles) {
    const baseName = emlFile.replace(/\.eml$/, '');
    const parsedPath = path.join(PARSED_DIR, `${baseName}.parsed.json`);

    if (fs.existsSync(parsedPath)) {
      console.log(`[skip]   ${emlFile}`);
      continue;
    }

    const source = fs.readFileSync(path.join(RAW_DIR, emlFile));
    const parsed = await simpleParser(source);
    const cleanBody = buildCleanBody(parsed);

    const output = {
      baseName,
      messageId: parsed.messageId || null,
      subject: parsed.subject || '(no subject)',
      from: parsed.from?.value || [],
      to: parsed.to?.value || [],
      date: parsed.date ? parsed.date.toISOString() : null,
      textBody: parsed.text || null,
      hasHtml: !!parsed.html,
      cleanBody,
      cleanBodyCharCount: cleanBody.length,
      parsedAt: new Date().toISOString(),
    };

    fs.writeFileSync(parsedPath, JSON.stringify(output, null, 2));

    const fromAddr = output.from[0]?.address || 'unknown';
    console.log(`[parsed] ${emlFile}`);
    console.log(`         from: ${fromAddr}`);
    console.log(`         subject: ${output.subject}`);
    console.log(`         clean body: ${cleanBody.length} chars\n`);
  }

  console.log('Done.');
}

parseLocalEmails().catch(err => {
  console.error('Parse failed:', err.message);
  process.exit(1);
});
