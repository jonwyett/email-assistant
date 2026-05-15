'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig, resolveMailboxArg } = require('../src/config');
const { chat } = require('../src/llm-client');
const { loadPrompt } = require('../src/prompts');
const { loadBrain, writeBrain } = require('../src/brain');

const REPORTS_DIR = path.join(__dirname, '../data/reports');

async function reflect(targetDate, mailbox, digestText = null) {
  const date = targetDate || new Date().toISOString().slice(0, 10);

  let digest;
  if (digestText != null) {
    digest = digestText;
  } else {
    const digestPath = path.join(REPORTS_DIR, `${date}-digest.txt`);
    try {
      digest = fs.readFileSync(digestPath, 'utf8');
    } catch (_) {
      throw new Error(`No digest found for ${date}. Run npm run digest first.`);
    }
  }

  const brain = loadBrain(mailbox.id);
  console.log(`  Running reflection pass for ${mailbox.name}...`);

  const messages = [
    { role: 'system', content: loadPrompt('pass4-system') },
    {
      role: 'user', content: loadPrompt('pass4-user', {
        brain,
        date,
        digest,
      }),
    },
  ];

  let updated = await chat(messages);

  updated = updated.trim();
  const fenced = updated.match(/^```(?:markdown)?\s*([\s\S]*?)```\s*$/);
  if (fenced) updated = fenced[1].trim();

  writeBrain(mailbox.id, updated);
  console.log(`  brain.md updated (${updated.length} chars)`);
}

module.exports = { reflect };

if (require.main === module) {
  const { mailboxes } = loadConfig();
  const mailbox = resolveMailboxArg(mailboxes);
  const targetDate = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && a !== mailbox.id) || null;
  reflect(targetDate, mailbox).catch(err => {
    console.error('Reflection failed:', err.message);
    process.exit(1);
  });
}
