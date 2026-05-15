'use strict';

const { Router } = require('express');
const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');
const router = Router();

const SERVER_CONFIG_PATH = path.join(__dirname, '../../server-config.json');
const CONFIG_JSON_PATH   = path.join(__dirname, '../../config.json');

function readServerConfig() {
  if (!fs.existsSync(SERVER_CONFIG_PATH)) return { schedule: '0 7 * * *', port: 3000 };
  try { return JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}

function writeServerConfig(obj) {
  fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

// Sanitized view of config.json (no passwords)
router.get('/', (req, res) => {
  const { llm, smtp, retentionDays, reportTo, mailboxes } = req.app.locals.appConfig;
  const serverCfg = readServerConfig();
  res.json({
    llm,
    smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user },
    retentionDays,
    reportTo,
    mailboxes: mailboxes.map(m => ({
      id: m.id, name: m.name, enabled: m.enabled,
      imap: { host: m.imap.host, port: m.imap.port, secure: m.imap.secure, user: m.imap.user },
    })),
    schedule: serverCfg.schedule || '0 7 * * *',
  });
});

// Update cron schedule
router.put('/schedule', (req, res) => {
  const { schedule } = req.body;
  if (typeof schedule !== 'string') return res.status(400).json({ error: 'schedule must be a string' });
  if (schedule && !cron.validate(schedule)) return res.status(400).json({ error: 'Invalid cron expression' });

  const cfg = readServerConfig();
  cfg.schedule = schedule;
  writeServerConfig(cfg);

  // Keep config.json in sync if it exists
  if (fs.existsSync(CONFIG_JSON_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8'));
      if (!raw.global) raw.global = {};
      raw.global.schedule = schedule;
      fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(raw, null, 2), 'utf8');
    } catch (_) { /* non-fatal — server-config.json is authoritative */ }
  }

  // Apply to running scheduler
  const { scheduler, runDaily } = req.app.locals;
  scheduler.start(schedule, runDaily);

  res.json({ ok: true, schedule });
});

module.exports = router;
