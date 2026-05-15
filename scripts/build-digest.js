'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { getDb } = require('../src/database');
const { chatJson } = require('../src/llm-client');
const { loadPrompt } = require('../src/prompts');
const { loadPrefs } = require('../src/prefs');

const REPORTS_DIR = path.join(__dirname, '../data/reports');

function parseSinceArg(args) {
  const idx = args.indexOf('--since');
  if (idx === -1 || !args[idx + 1]) return null;
  const val = args[idx + 1];
  const match = val.match(/^(\d+)d$/);
  if (!match) throw new Error(`Invalid --since value "${val}". Use format: 7d`);
  const days = parseInt(match[1], 10);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function uniqueReportPath(date) {
  let p = path.join(REPORTS_DIR, `${date}-digest.txt`);
  if (!fs.existsSync(p)) return p;
  let n = 2;
  while (fs.existsSync(path.join(REPORTS_DIR, `${date}-${n}-digest.txt`))) n++;
  return path.join(REPORTS_DIR, `${date}-${n}-digest.txt`);
}

function formatEmailsForPrompt(rows) {
  return rows.map(r => {
    const action = r.possible_action_required ? 'ACTION REQUIRED' : 'no action';
    return `[importance=${r.importance}, ${action}] ${r.category} (${r.event_type}): ${r.summary}`;
  }).join('\n');
}

function formatGroupsForPrompt(groups) {
  return groups.map(g => {
    const notableItems   = JSON.parse(g.notable_items  || '[]');
    const aggregateFacts = JSON.parse(g.aggregate_facts || '[]');
    const lines = [
      `[GROUP: ${g.group_name} | ${g.email_count} email(s), ${g.routine_count} routine]`,
      `  Summary: ${g.group_summary}`,
    ];
    notableItems.forEach(item  => lines.push(`  Notable: ${item}`));
    aggregateFacts.forEach(fact => lines.push(`  Fact: ${fact}`));
    return lines.join('\n');
  }).join('\n\n');
}

function dateRange(minDate, maxDate) {
  const fmt = iso => iso ? iso.slice(0, 10) : '?';
  return minDate === maxDate ? fmt(minDate) : `${fmt(minDate)} to ${fmt(maxDate)}`;
}

function buildReportText(header, digest) {
  const lines = [header, ''];

  if (digest.needs_attention?.length > 0) {
    lines.push('Needs attention:');
    digest.needs_attention.forEach(item => lines.push(`  - ${item}`));
    lines.push('');
  }

  if (digest.worth_noting?.length > 0) {
    lines.push('Worth noting:');
    digest.worth_noting.forEach(item => lines.push(`  - ${item}`));
    lines.push('');
  }

  if (digest.activity_summary?.length > 0) {
    lines.push('Activity:');
    digest.activity_summary.forEach(item => lines.push(`  - ${item}`));
    lines.push('');
  }

  const suppressed = digest.suppressed || {};
  const suppressedEntries = Object.entries(suppressed).filter(([, n]) => n > 0);
  if (suppressedEntries.length > 0) {
    lines.push('Ignored:');
    suppressedEntries.forEach(([type, count]) => lines.push(`  - ${count} ${type}`));
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// Builds the digest section for a single mailbox. Returns { text, emailIds, totalEmails }.
async function buildMailboxSection(mailbox, sinceClause, today) {
  const db    = getDb(mailbox.id);
  const prefs = loadPrefs(mailbox.id) || '';

  const groupCount = db.prepare('SELECT COUNT(*) as n FROM email_groups').get().n;

  if (groupCount > 0) {
    const groups = db.prepare(`
      SELECT eg.group_name, eg.group_summary, eg.routine_count,
             eg.notable_items, eg.aggregate_facts,
             COUNT(ea.email_id) as email_count,
             MAX(ea.importance) as max_importance,
             MIN(e.received_at) as min_date,
             MAX(e.received_at) as max_date
      FROM email_groups eg
      JOIN email_analysis ea ON ea.group_id = eg.id
      JOIN emails e ON e.id = ea.email_id
      WHERE ea.digested_at IS NULL ${sinceClause}
      GROUP BY eg.id
      HAVING COUNT(ea.email_id) > 0
      ORDER BY MAX(ea.importance) DESC,
               json_array_length(eg.notable_items) DESC
    `).all();

    if (groups.length === 0) {
      return { text: `${mailbox.name}\n\nNothing new this period.`, emailIds: [], totalEmails: 0 };
    }

    const idRows = db.prepare(`
      SELECT ea.email_id FROM email_analysis ea
      JOIN email_groups eg ON eg.id = ea.group_id
      JOIN emails e ON e.id = ea.email_id
      WHERE ea.digested_at IS NULL ${sinceClause}
    `).all();
    const emailIds = idRows.map(r => r.email_id);

    let totalEmails = 0;
    let minDate = null;
    let maxDate = null;
    for (const g of groups) {
      totalEmails += g.email_count;
      if (!minDate || g.min_date < minDate) minDate = g.min_date;
      if (!maxDate || g.max_date > maxDate) maxDate = g.max_date;
    }

    const showGroups      = groups.filter(g => g.max_importance > 2);
    const suppressedGroups = groups.filter(g => g.max_importance <= 2);
    const suppressedCount  = suppressedGroups.reduce((n, g) => n + g.email_count, 0);

    const sectionHeader = `${mailbox.name} — ${totalEmails} email(s) — ${dateRange(minDate, maxDate)}`;

    if (showGroups.length === 0) {
      const digest = {
        needs_attention: [], worth_noting: [], activity_summary: [],
        suppressed: { marketing: suppressedCount },
      };
      return { text: buildReportText(sectionHeader, digest), emailIds, totalEmails };
    }

    let promptContent = formatGroupsForPrompt(showGroups);
    if (suppressedGroups.length > 0) {
      promptContent += `\n\nNote: ${suppressedCount} email(s) in ${suppressedGroups.length} group(s) were pre-identified as marketing/promotional and excluded from the above list. Add them to suppressed.marketing in your response.`;
    }

    console.log(`  ${mailbox.name}: ${totalEmails} email(s) in ${groups.length} group(s) (${suppressedGroups.length} suppressed)`);

    const messages = [
      { role: 'system', content: loadPrompt('pass3-system', { prefs }) },
      { role: 'user',   content: loadPrompt('pass3-user',   { date: today, total: totalEmails, emails: promptContent }) },
    ];
    const digestJson = await chatJson(messages);
    return { text: buildReportText(sectionHeader, digestJson), emailIds, totalEmails };

  } else {
    const rows = db.prepare(`
      SELECT e.id, e.subject, e.from_email, e.received_at,
             ea.category, ea.event_type, ea.summary, ea.importance,
             ea.likely_routine, ea.possible_action_required
      FROM email_analysis ea
      JOIN emails e ON e.id = ea.email_id
      WHERE ea.digested_at IS NULL ${sinceClause}
      ORDER BY ea.importance DESC, e.received_at DESC
    `).all();

    if (rows.length === 0) {
      return { text: `${mailbox.name}\n\nNothing new this period.`, emailIds: [], totalEmails: 0 };
    }

    const emailIds = rows.map(r => r.id);
    let minDate = null;
    let maxDate = null;
    for (const r of rows) {
      if (!minDate || r.received_at < minDate) minDate = r.received_at;
      if (!maxDate || r.received_at > maxDate) maxDate = r.received_at;
    }

    console.log(`  ${mailbox.name}: ${rows.length} email(s)`);

    const sectionHeader = `${mailbox.name} — ${rows.length} email(s) — ${dateRange(minDate, maxDate)}`;
    const messages = [
      { role: 'system', content: loadPrompt('pass3-system', { prefs }) },
      { role: 'user',   content: loadPrompt('pass3-user',   { date: today, total: rows.length, emails: formatEmailsForPrompt(rows) }) },
    ];
    const digestJson = await chatJson(messages);
    return { text: buildReportText(sectionHeader, digestJson), emailIds, totalEmails: rows.length };
  }
}

function markDigested(mailboxes, emailIdsToMarkByMailbox) {
  for (const mailbox of mailboxes) {
    const ids = emailIdsToMarkByMailbox[mailbox.id] || [];
    if (ids.length === 0) continue;
    const db = getDb(mailbox.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE email_analysis SET digested_at = datetime('now') WHERE email_id IN (${placeholders})`).run(...ids);
  }
}

// Builds per-mailbox digest sections, stitches them into a unified file, marks emails as digested.
// Returns { reportName, sectionsByMailbox: { [mailboxId]: text } }.
async function buildDigest(opts, mailboxes) {
  if (mailboxes.length === 0) {
    console.log('No enabled mailboxes — nothing to digest.');
    return { reportName: null, sectionsByMailbox: {} };
  }

  const today       = new Date().toISOString().slice(0, 10);
  const sinceClause = opts.sinceDate ? `AND e.received_at >= '${opts.sinceDate}'` : '';

  const emailIdsToMarkByMailbox = {};
  const sectionsByMailbox       = {};
  let totalEmails = 0;

  for (const mailbox of mailboxes) {
    const result = await buildMailboxSection(mailbox, sinceClause, today);
    emailIdsToMarkByMailbox[mailbox.id] = result.emailIds;
    sectionsByMailbox[mailbox.id]       = result.text;
    totalEmails += result.totalEmails;
  }

  const countSuffix  = totalEmails > 0 ? ` — ${totalEmails} email(s)` : '';
  const globalHeader = `Email Digest — ${today}${countSuffix}`;

  const SEP       = '─'.repeat(50);
  const fileLines = [globalHeader, ''];

  for (const mailbox of mailboxes) {
    fileLines.push(SEP, '', sectionsByMailbox[mailbox.id], '');
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = uniqueReportPath(today);
  const reportName = path.basename(reportPath);
  fs.writeFileSync(reportPath, fileLines.join('\n').trimEnd() + '\n');

  markDigested(mailboxes, emailIdsToMarkByMailbox);

  console.log(`\nSaved → data/reports/${reportName}`);
  return { reportName, sectionsByMailbox };
}

module.exports = { buildDigest };

if (require.main === module) {
  const sinceDate = parseSinceArg(process.argv);
  const { mailboxes } = loadConfig();
  const enabled = mailboxes.filter(m => m.enabled);
  buildDigest({ sinceDate }, enabled).catch(err => {
    console.error('Digest build failed:', err.message);
    process.exit(1);
  });
}
