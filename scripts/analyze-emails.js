'use strict';

const { loadConfig, resolveMailboxArg } = require('../src/config');
const { getDb } = require('../src/database');
const { analyzeEmail } = require('../src/analysis');
const { getActiveMemories, applyMemoryOps } = require('../src/memory');

async function analyzeAll(mailbox) {
  const db = getDb(mailbox.id);

  const emails = db.prepare(`
    SELECT e.* FROM emails e
    LEFT JOIN email_analysis ea ON ea.email_id = e.id
    WHERE ea.email_id IS NULL
    ORDER BY e.received_at ASC
  `).all();

  if (emails.length === 0) {
    console.log('  All emails already analyzed.');
    return;
  }

  const memories = getActiveMemories(db);
  if (memories.length > 0) {
    console.log(`  Active memories: ${memories.length}`);
  }
  console.log(`  Analyzing ${emails.length} email(s)...\n`);

  const runId = db.prepare(`
    INSERT INTO processing_runs (run_type, started_at, status, email_count)
    VALUES ('pass1', datetime('now'), 'running', ?)
  `).run(emails.length).lastInsertRowid;

  const insertAnalysis = db.prepare(`
    INSERT OR REPLACE INTO email_analysis
      (email_id, category, event_type, summary, importance, likely_routine,
       possible_action_required, include_in_digest, analysis_json, analyzed_at)
    VALUES
      (@emailId, @category, @eventType, @summary, @importance, @likelyRoutine,
       @possibleActionRequired, @includeInDigest, @analysisJson, datetime('now'))
  `);

  const getBody = db.prepare('SELECT * FROM email_bodies WHERE email_id = ?');

  let succeeded = 0;
  let failed = 0;

  for (const email of emails) {
    const label = `  [${email.id}] ${email.subject.slice(0, 55)}`.padEnd(62);
    process.stdout.write(label);

    const body = getBody.get(email.id);
    let result;

    try {
      result = await analyzeEmail(email, body, memories, mailbox.id);
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
      continue;
    }

    const includeInDigest = (result.possible_action_required || result.importance >= 6) ? 1 : 0;

    insertAnalysis.run({
      emailId:                email.id,
      category:               result.category               ?? null,
      eventType:              result.event_type             ?? null,
      summary:                result.summary                ?? null,
      importance:             result.importance             ?? 0,
      likelyRoutine:          result.likely_routine         ? 1 : 0,
      possibleActionRequired: result.possible_action_required ? 1 : 0,
      includeInDigest,
      analysisJson: JSON.stringify(result),
    });

    const opsApplied = applyMemoryOps(db, result.memory_ops, email.id);
    const memNote = opsApplied > 0 ? ` [+${opsApplied} mem]` : '';
    console.log(`importance=${result.importance} | ${result.category}${memNote}`);
    succeeded++;
  }

  db.prepare(`
    UPDATE processing_runs
    SET completed_at = datetime('now'), status = ?, notes = ?
    WHERE id = ?
  `).run(
    failed > 0 ? 'partial' : 'complete',
    `${succeeded} succeeded, ${failed} failed`,
    runId
  );

  console.log(`\n  Done — ${succeeded} analyzed, ${failed} failed`);
}

module.exports = { analyzeAll };

if (require.main === module) {
  const { mailboxes } = loadConfig();
  const mailbox = resolveMailboxArg(mailboxes);
  analyzeAll(mailbox).catch(err => {
    console.error('Analysis run failed:', err.message);
    process.exit(1);
  });
}
