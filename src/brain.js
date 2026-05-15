'use strict';

const fs = require('fs');
const { getMailboxPaths } = require('./config');

const DEFAULT = '# Inbox Brain\n\nNo patterns learned yet. This file is updated after each daily run.';

function loadBrain(mailboxId) {
  try {
    return fs.readFileSync(getMailboxPaths(mailboxId).brain, 'utf8');
  } catch (_) {
    return DEFAULT;
  }
}

function writeBrain(mailboxId, content) {
  fs.writeFileSync(getMailboxPaths(mailboxId).brain, content);
}

module.exports = { loadBrain, writeBrain };
