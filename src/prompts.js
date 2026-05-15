'use strict';

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '../prompts');

function loadPrompt(name, vars = {}) {
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  let content = fs.readFileSync(filePath, 'utf8');

  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value ?? '');
  }

  return content.trim();
}

module.exports = { loadPrompt };
