'use strict';

const { loadConfig, resolveMailboxArg } = require('../src/config');
const { getDb } = require('../src/database');
const { chatJson } = require('../src/llm-client');
const { loadPrompt } = require('../src/prompts');

function extractDomain(fromEmail) {
  if (!fromEmail) return 'unknown';
  const at = fromEmail.indexOf('@');
  return at >= 0 ? fromEmail.slice(at + 1).toLowerCase() : fromEmail.toLowerCase();
}

function makeGroupKey(fromEmail, category) {
  return `${extractDomain(fromEmail)}|${category || 'other'}`;
}

function formatMembersForPrompt(members) {
  return members.map(m => {
    const action = m.possible_action_required ? 'ACTION REQUIRED' : 'no action';
    return `- [importance=${m.importance}, ${action}] ${m.event_type}: ${m.summary}`;
  }).join('\n');
}

async function groupEmails(mailbox) {
  const db = getDb(mailbox.id);

  db.prepare('UPDATE email_analysis SET group_id = NULL WHERE digested_at IS NULL').run();
  db.prepare('DELETE FROM email_groups').run();

  const rows = db.prepare(`
    SELECT e.id, e.from_name, e.from_email, e.subject, e.received_at,
           ea.category, ea.event_type, ea.summary, ea.importance,
           ea.likely_routine, ea.possible_action_required, ea.include_in_digest
    FROM emails e
    JOIN email_analysis ea ON ea.email_id = e.id
    WHERE ea.digested_at IS NULL
    ORDER BY e.received_at ASC
  `).all();

  if (rows.length === 0) {
    console.log('  No undigested emails to group.');
    return;
  }

  const groupMap = new Map();
  for (const row of rows) {
    const key = makeGroupKey(row.from_email, row.category);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(row);
  }

  console.log(`  ${rows.length} email(s) → ${groupMap.size} group(s)\n`);

  const upsertGroup = db.prepare(`
    INSERT OR REPLACE INTO email_groups
      (group_key, group_name, group_summary, routine_count, notable_items,
       aggregate_facts, include_in_digest, analysis_json, analyzed_at)
    VALUES
      (@groupKey, @groupName, @groupSummary, @routineCount, @notableItems,
       @aggregateFacts, @includeInDigest, @analysisJson, datetime('now'))
  `);

  const setGroupId = db.prepare(
    'UPDATE email_analysis SET group_id = ? WHERE email_id = ?'
  );

  let processed = 0;
  let failed = 0;

  for (const [key, members] of groupMap) {
    const domain = extractDomain(members[0].from_email);
    const senderLabel = members[0].from_name || domain;

    if (members.length === 1) {
      const m = members[0];
      const result = upsertGroup.run({
        groupKey:       key,
        groupName:      senderLabel,
        groupSummary:   m.summary,
        routineCount:   m.likely_routine ? 1 : 0,
        notableItems:   JSON.stringify(m.possible_action_required ? [m.summary] : []),
        aggregateFacts: JSON.stringify([]),
        includeInDigest: m.include_in_digest,
        analysisJson:   null,
      });
      setGroupId.run(result.lastInsertRowid, m.id);
      console.log(`    [1 email ] ${key}`);
      processed++;
      continue;
    }

    process.stdout.write(`    [${String(members.length).padStart(2)} emails] ${key} ... `);

    const messages = [
      { role: 'system', content: loadPrompt('pass2-system') },
      {
        role: 'user', content: loadPrompt('pass2-user', {
          count:      members.length,
          group_name: senderLabel,
          emails:     formatMembersForPrompt(members),
        }),
      },
    ];

    let analysis;
    let llmFailed = false;

    try {
      analysis = await chatJson(messages);
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      llmFailed = true;
      failed++;
      analysis = {
        group_name:      senderLabel,
        group_summary:   `${members.length} emails from ${senderLabel}`,
        routine_count:   members.filter(m => m.likely_routine).length,
        notable_items:   members.filter(m => m.possible_action_required).map(m => m.summary),
        aggregate_facts: [],
        include_in_digest: members.some(m => m.include_in_digest) ? 1 : 0,
      };
    }

    const result = upsertGroup.run({
      groupKey:       key,
      groupName:      analysis.group_name      ?? senderLabel,
      groupSummary:   analysis.group_summary   ?? '',
      routineCount:   analysis.routine_count   ?? 0,
      notableItems:   JSON.stringify(Array.isArray(analysis.notable_items)   ? analysis.notable_items   : []),
      aggregateFacts: JSON.stringify(Array.isArray(analysis.aggregate_facts) ? analysis.aggregate_facts : []),
      includeInDigest: analysis.include_in_digest ? 1 : 0,
      analysisJson:   JSON.stringify(analysis),
    });

    for (const m of members) {
      setGroupId.run(result.lastInsertRowid, m.id);
    }

    if (!llmFailed) console.log('done');
    processed++;
  }

  console.log(`\n  Done — ${processed} group(s) processed, ${failed} LLM failure(s)`);
}

module.exports = { groupEmails };

if (require.main === module) {
  const { mailboxes } = loadConfig();
  const mailbox = resolveMailboxArg(mailboxes);
  groupEmails(mailbox).catch(err => {
    console.error('Grouping failed:', err.message);
    process.exit(1);
  });
}
