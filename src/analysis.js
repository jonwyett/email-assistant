'use strict';

const { chatJson } = require('./llm-client');
const { loadPrompt } = require('./prompts');
const { formatMemoriesForPrompt } = require('./memory');
const { loadBrain } = require('./brain');
const { loadPrefs } = require('./prefs');

const MAX_BODY_CHARS = 3000;

function buildFrom(email) {
  return email.from_name
    ? `${email.from_name} <${email.from_email}>`
    : email.from_email;
}

async function analyzeEmail(email, body, memories = [], mailboxId) {
  const cleanBody = body?.clean_body ?? '';
  const truncated = cleanBody.length > MAX_BODY_CHARS
    ? cleanBody.slice(0, MAX_BODY_CHARS) + '\n[...truncated]'
    : cleanBody;

  const messages = [
    { role: 'system', content: loadPrompt('pass1-system', { brain: loadBrain(mailboxId), prefs: loadPrefs(mailboxId) }) },
    {
      role: 'user', content: loadPrompt('pass1-user', {
        memory: formatMemoriesForPrompt(memories),
        from: buildFrom(email),
        subject: email.subject,
        date: email.received_at || 'unknown',
        body: truncated,
      }),
    },
  ];

  return chatJson(messages);
}

module.exports = { analyzeEmail };
