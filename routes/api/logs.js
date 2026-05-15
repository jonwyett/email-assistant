'use strict';

const { Router } = require('express');
const logStream = require('../../src/log-stream');
const router = Router();

// Server-Sent Events endpoint — streams log entries to the browser
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send buffered history first
  for (const entry of logStream.getBuffer()) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const unsubscribe = logStream.subscribe(entry => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  req.on('close', unsubscribe);
});

module.exports = router;
