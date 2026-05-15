'use strict';

const { loadConfig } = require('./config');

async function chat(messages, options = {}) {
  const { llm } = loadConfig();

  // Auto-select model on first use; result sticks via the cached config object
  if (!llm.model) {
    const { models } = await checkHealth();
    const chosen = selectModel(llm.preference, models);
    if (!chosen) throw new Error('No models available in LM Studio. Load a model and retry.');
    llm.model = chosen;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? llm.timeoutMs);

  let response;
  try {
    response = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llm.model,
        messages,
        temperature: options.temperature ?? 0.1,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('LLM request timed out');
    if (err.cause?.code === 'ECONNREFUSED') {
      throw new Error(`LM Studio not reachable at ${llm.baseUrl} — is it running?`);
    }
    throw err;
  }

  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function chatJson(messages, options = {}) {
  const text = await chat(messages, { ...options, json: true });

  try {
    return JSON.parse(text);
  } catch (_) {}

  // Strip markdown code fences if the model wrapped its output
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  throw new Error(`LLM returned non-JSON:\n${text.slice(0, 500)}`);
}

async function checkHealth() {
  const { llm } = loadConfig();

  let response;
  try {
    response = await fetch(`${llm.baseUrl}/models`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.name === 'TimeoutError') {
      throw new Error(`LM Studio not reachable at ${llm.baseUrl} — is it running?`);
    }
    throw err;
  }

  if (!response.ok) {
    throw new Error(`LM Studio health check failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const models = data.data ?? [];
  return { ok: true, models };
}

function selectModel(preferences, models) {
  if (models.length === 0) return null;
  for (const keyword of preferences) {
    const match = models.find(m => m.id.toLowerCase().includes(keyword.toLowerCase()));
    if (match) return match.id;
  }
  return models[0].id;
}

module.exports = { chat, chatJson, checkHealth, selectModel };
