'use strict';

const { Router } = require('express');
const router = Router();

// req.app.locals.scheduler and req.app.locals.runDaily are set in server.js

router.get('/status', (req, res) => {
  res.json(req.app.locals.scheduler.getStatus());
});

router.post('/', async (req, res) => {
  const { scheduler, runDaily } = req.app.locals;
  if (scheduler.getStatus().running) {
    return res.status(409).json({ error: 'A pipeline run is already in progress' });
  }
  // Fire and forget — client streams logs via SSE
  scheduler.runNow(runDaily).catch(() => {});
  res.json({ ok: true, message: 'Pipeline started — watch the log stream for progress' });
});

module.exports = router;
