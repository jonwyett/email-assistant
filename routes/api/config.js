'use strict';

const { Router } = require('express');
const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');
const router = Router();

const CONFIG_JSON_PATH = path.join(__dirname, '../../config.json');

// Sanitized view of config.json (no passwords)
router.get('/', (req, res) => {
  const { llm, smtp, retentionDays, reportTo, mailboxes, schedule } = req.app.locals.appConfig;
  res.json({
    llm,
    smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user },
    retentionDays,
    reportTo,
    mailboxes: mailboxes.map(m => ({
      id: m.id, name: m.name, enabled: m.enabled,
      imap: { host: m.imap.host, port: m.imap.port, secure: m.imap.secure, user: m.imap.user },
    })),
    schedule,
  });
});

// Update cron schedule
router.put('/schedule', (req, res) => {
  const { schedule } = req.body;
  if (typeof schedule !== 'string') return res.status(400).json({ error: 'schedule must be a string' });
  if (schedule && !cron.validate(schedule)) return res.status(400).json({ error: 'Invalid cron expression' });

  if (fs.existsSync(CONFIG_JSON_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8'));
      if (!raw.global) raw.global = {};
      raw.global.schedule = schedule;
      fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(raw, null, 2), 'utf8');
    } catch (err) {
      return res.status(500).json({ error: 'Failed to persist schedule to config.json' });
    }
  }

  req.app.locals.appConfig.schedule = schedule;

  const { scheduler, runDaily } = req.app.locals;
  scheduler.start(schedule, runDaily);

  res.json({ ok: true, schedule });
});

module.exports = router;
