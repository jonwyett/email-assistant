'use strict';

const fs = require('fs');
const { getMailboxPaths } = require('./config');

function loadPrefs(mailboxId) {
  try {
    return fs.readFileSync(getMailboxPaths(mailboxId).prefs, 'utf8');
  } catch (_) {
    return '';
  }
}

module.exports = { loadPrefs };
