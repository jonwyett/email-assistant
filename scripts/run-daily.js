'use strict';

const { loadConfig } = require('../src/config');
const { downloadLatestEmails } = require('./download-latest-emails');
const { importEmails } = require('./import-emails');
const { analyzeAll } = require('./analyze-emails');
const { groupEmails } = require('./group-emails');
const { buildDigest } = require('./build-digest');
const { sendDigest } = require('./send-digest');
const { housecleaning } = require('./housecleaning');
const { reflect } = require('./reflect');
const { cleanExpiredMemories } = require('../src/memory');
const { getDb } = require('../src/database');
const { checkHealth, selectModel } = require('../src/llm-client');

function mbHeader(mailboxName, step, total, label) {
  console.log(`\n  [${step}/${total}] ${label}`);
}

async function runDaily() {
  const date = new Date().toISOString().slice(0, 10);
  const startedAt = Date.now();
  const { llm, mailboxes } = loadConfig();
  const enabledMailboxes = mailboxes.filter(m => m.enabled);

  console.log(`=== Email Watchdog — ${date} ===`);
  console.log(`Mailboxes: ${enabledMailboxes.map(m => m.name).join(', ')}`);

  // Pre-flight: verify LM Studio is reachable and a model is available
  console.log('\nChecking LLM backend...');
  let health;
  try {
    health = await checkHealth();
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    console.error('  LLM backend unavailable — skipping this run. Will retry at next scheduled time.');
    return;
  }

  if (llm.model) {
    const found = health.models.find(m => m.id.toLowerCase().includes(llm.model.toLowerCase()));
    if (!found) {
      const available = health.models.map(m => m.id).join(', ') || '(none)';
      console.error(`  FAILED: LLM_MODEL "${llm.model}" not found. Available: ${available}`);
      console.error('  Skipping this run. Will retry at next scheduled time.');
      return;
    }
    console.log(`  Model confirmed: ${found.id}`);
  } else {
    const chosen = selectModel(llm.preference, health.models);
    if (!chosen) {
      console.error('  FAILED: No models available in LM Studio. Load a model and retry.');
      console.error('  Skipping this run. Will retry at next scheduled time.');
      return;
    }
    llm.model = chosen;
    console.log(`  Model selected: ${chosen}`);
  }

  // Per-mailbox pipeline
  for (const mailbox of enabledMailboxes) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${mailbox.name}`);
    console.log('─'.repeat(50));

    // Clean expired memories for this mailbox
    const expired = cleanExpiredMemories(getDb(mailbox.id));
    if (expired > 0) console.log(`  Cleaned ${expired} expired memory item(s)`);

    // 1/6 Download
    mbHeader(mailbox.name, 1, 5, 'Downloading emails...');
    try {
      await downloadLatestEmails(mailbox);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      console.error('  Skipping remaining steps for this mailbox.');
      continue;
    }

    // 2/6 Import
    mbHeader(mailbox.name, 2, 5, 'Importing to database...');
    try {
      await importEmails(mailbox);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      console.error('  Skipping remaining steps for this mailbox.');
      continue;
    }

    // 3/6 Analyze
    mbHeader(mailbox.name, 3, 5, 'Analyzing...');
    try {
      await analyzeAll(mailbox);
    } catch (err) {
      console.error(`  WARNING: ${err.message}`);
      console.error('  Continuing with partially analyzed emails.');
    }

    // 4/6 Group
    mbHeader(mailbox.name, 4, 5, 'Grouping...');
    try {
      await groupEmails(mailbox);
    } catch (err) {
      console.error(`  WARNING: ${err.message}`);
      console.error('  Continuing without grouping — digest will use flat email list.');
    }

    // 5/6 Housecleaning
    mbHeader(mailbox.name, 5, 6, 'Housecleaning...');
    try {
      await housecleaning(mailbox);
    } catch (err) {
      console.error(`  WARNING: ${err.message}`);
    }
  }

  // Global steps: digest + reflect + send
  console.log(`\n${'═'.repeat(50)}`);

  console.log('\n[Global 1/3] Building digest...');
  let reportName;
  let sectionsByMailbox = {};
  try {
    ({ reportName, sectionsByMailbox } = await buildDigest({}, enabledMailboxes));
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    console.error('  Cannot send without a digest. Aborting.');
    process.exit(1);
  }

  if (!reportName) {
    console.log('  No digest generated — nothing to reflect or send.');
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s`);
    return;
  }

  console.log('\n[Global 2/3] Updating brain.md (reflect)...');
  for (const mailbox of enabledMailboxes) {
    try {
      await reflect(date, mailbox, sectionsByMailbox[mailbox.id]);
    } catch (err) {
      console.error(`  WARNING (${mailbox.name}): ${err.message}`);
    }
  }

  console.log('\n[Global 3/3] Sending digest...');
  try {
    await sendDigest(reportName);
  } catch (err) {
    console.error(`  WARNING: Send failed — ${err.message}`);
    console.error('  Resend with: npm run send-digest');
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

if (require.main === module) {
  runDaily().catch(err => {
    console.error('Daily run failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runDaily };
