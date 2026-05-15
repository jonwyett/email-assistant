'use strict';

const { chat } = require('../src/llm-client');
const { loadConfig, resolveMailboxArg } = require('../src/config');
const { getDb } = require('../src/database');
const { analyzeEmail } = require('../src/analysis');

async function testLlm(mailbox) {
  console.log('=== Step 1: Connectivity ===');
  try {
    const reply = await chat([
      { role: 'user', content: 'Reply with exactly: OK' },
    ], { timeoutMs: 15000 });
    console.log(`LM Studio responded: "${reply}"\n`);
  } catch (err) {
    console.error(`Connection failed: ${err.message}`);
    process.exit(1);
  }

  console.log('=== Step 2: Structured JSON analysis ===');
  const db = getDb(mailbox.id);

  const emailId = parseInt(process.argv.find((a, i) => i > 1 && !a.startsWith('--') && a !== mailbox.id) || '1', 10);
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  const body  = db.prepare('SELECT * FROM email_bodies WHERE email_id = ?').get(emailId);

  if (!email) {
    console.error(`No email found with id=${emailId} in mailbox "${mailbox.id}"`);
    process.exit(1);
  }

  console.log(`Email: [${email.id}] ${email.from_email} — ${email.subject}`);
  console.log(`Body length: ${body?.clean_body_char_count ?? 0} chars\n`);

  let result;
  try {
    result = await analyzeEmail(email, body, [], mailbox.id);
  } catch (err) {
    console.error(`Analysis failed: ${err.message}`);
    process.exit(1);
  }

  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  const { mailboxes } = loadConfig();
  const mailbox = resolveMailboxArg(mailboxes);
  testLlm(mailbox).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
