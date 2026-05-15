'use strict';

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_JSON_PATH = path.join(PROJECT_ROOT, 'config.json');

function getMailboxPaths(mailboxId) {
  const base = path.join(PROJECT_ROOT, 'data', 'mailboxes', mailboxId);
  return {
    base,
    db:           path.join(base, 'email-assistant.db'),
    brain:        path.join(base, 'brain.md'),
    prefs:        path.join(base, 'user-prefs.md'),
    rawEmails:    path.join(base, 'raw-emails'),
    parsedEmails: path.join(base, 'parsed-emails'),
  };
}

function resolveMailboxArg(mailboxes) {
  const idx = process.argv.indexOf('--mailbox');
  const id = idx !== -1 ? process.argv[idx + 1] : null;
  if (!id) {
    const available = mailboxes
      .filter(m => m.enabled)
      .map(m => `${m.id} (${m.name})`)
      .join(', ');
    console.error('Error: --mailbox <id> is required.');
    console.error(`Available mailboxes: ${available || '(none enabled)'}`);
    process.exit(1);
  }
  const mailbox = mailboxes.find(m => m.id === id);
  if (!mailbox) {
    console.error(`Error: mailbox "${id}" not found.`);
    console.error('Available:', mailboxes.map(m => m.id).join(', '));
    process.exit(1);
  }
  if (!mailbox.enabled) {
    console.error(`Error: mailbox "${id}" is disabled.`);
    process.exit(1);
  }
  return mailbox;
}

function loadFromJson() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8'));
  const g = raw.global || {};

  const mailboxes = (raw.mailboxes || []).map(mb => ({
    id:      mb.id,
    name:    mb.name || mb.id,
    enabled: mb.enabled !== false,
    imap: {
      host:     mb.imap.host     || 'imap.gmail.com',
      port:     mb.imap.port     || 993,
      secure:   mb.imap.secure   !== false,
      user:     mb.imap.user,
      password: mb.imap.password,
      markRead: mb.imap.mark_read === true,
    },
    paths: getMailboxPaths(mb.id),
  }));

  return {
    llm: {
      baseUrl:    g.llm_base_url   || 'http://localhost:1234/v1',
      model:      g.llm_model      || '',
      timeoutMs:  g.llm_timeout_ms || 120000,
      preference: Array.isArray(g.llm_preference) ? g.llm_preference : [],
    },
    smtp: {
      host:     g.smtp?.host     || 'smtp.gmail.com',
      port:     g.smtp?.port     || 587,
      secure:   g.smtp?.secure   === true,
      user:     g.smtp?.user     || '',
      password: g.smtp?.password || '',
    },
    reportTo:      g.report_to     || '',
    retentionDays: g.retention_days || 30,
    port:          g.port          || 3000,
    schedule:      g.schedule      || '0 7 * * *',
    mailboxes,
  };
}

function loadFromEnv() {
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  const required = ['IMAP_USER', 'IMAP_PASSWORD'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}\nCopy .env.example to .env and fill in your credentials.`);
  }

  const mailboxId = 'default';
  return {
    llm: {
      baseUrl:    process.env.LLM_BASE_URL || 'http://localhost:1234/v1',
      model:      process.env.LLM_MODEL    || '',
      timeoutMs:  parseInt(process.env.LLM_TIMEOUT_MS || '120000', 10),
      preference: (process.env.LLM_PREFERENCE || '').split(',').map(s => s.trim()).filter(Boolean),
    },
    smtp: {
      host:     process.env.SMTP_HOST     || 'smtp.gmail.com',
      port:     parseInt(process.env.SMTP_PORT || '587', 10),
      secure:   process.env.SMTP_SECURE   === 'true',
      user:     process.env.SMTP_USER     || '',
      password: process.env.SMTP_PASSWORD || '',
    },
    reportTo:      process.env.REPORT_TO || '',
    retentionDays: parseInt(process.env.RETENTION_DAYS || '30', 10),
    port:          parseInt(process.env.PORT || '3000', 10),
    schedule:      process.env.SCHEDULE || '0 7 * * *',
    mailboxes: [{
      id:      mailboxId,
      name:    'Default',
      enabled: true,
      imap: {
        host:     process.env.IMAP_HOST     || 'imap.gmail.com',
        port:     parseInt(process.env.IMAP_PORT || '993', 10),
        secure:   process.env.IMAP_SECURE   !== 'false',
        user:     process.env.IMAP_USER,
        password: process.env.IMAP_PASSWORD,
        markRead: process.env.IMAP_MARK_READ === 'true',
      },
      paths: getMailboxPaths(mailboxId),
    }],
  };
}

let _cached = null;

function loadConfig() {
  if (_cached) return _cached;
  _cached = fs.existsSync(CONFIG_JSON_PATH) ? loadFromJson() : loadFromEnv();
  return _cached;
}

module.exports = { loadConfig, getMailboxPaths, resolveMailboxArg };
