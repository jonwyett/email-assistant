'use strict';

const { convert } = require('html-to-text');

const HTML_OPTS = {
  wordwrap: 120,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'head', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'script', format: 'skip' },
  ],
};

function buildCleanBody(parsed) {
  let body = parsed.text || '';
  if (!body.trim() && parsed.html) {
    body = convert(parsed.html, HTML_OPTS);
  }
  return body.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { buildCleanBody };
