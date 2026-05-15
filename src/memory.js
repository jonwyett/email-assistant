'use strict';

function getActiveMemories(db) {
  return db.prepare(`
    SELECT memory_key, memory_type, memory_text, expires_at
    FROM memory_items
    WHERE expires_at IS NULL OR expires_at > datetime('now')
    ORDER BY updated_at DESC
  `).all();
}

function formatMemoriesForPrompt(memories) {
  if (!memories || memories.length === 0) {
    return 'No active memories from previous runs.';
  }
  return memories.map(m => {
    const expiry = m.expires_at ? ` (expires ${m.expires_at.slice(0, 10)})` : '';
    return `- [${m.memory_type}] ${m.memory_text}${expiry}`;
  }).join('\n');
}

function applyMemoryOps(db, ops, emailId) {
  if (!Array.isArray(ops) || ops.length === 0) return 0;

  const upsert = db.prepare(`
    INSERT INTO memory_items (memory_key, memory_type, memory_text, source, expires_at, updated_at)
    VALUES (@key, @type, @text, @source, @expiresAt, datetime('now'))
    ON CONFLICT(memory_key) DO UPDATE SET
      memory_text = @text,
      memory_type = @type,
      source      = @source,
      expires_at  = @expiresAt,
      updated_at  = datetime('now')
  `);

  const del = db.prepare('DELETE FROM memory_items WHERE memory_key = ?');

  let applied = 0;
  for (const op of ops) {
    if (op.op === 'remember' && op.key && op.text) {
      const expiresAt = op.ttl_days
        ? new Date(Date.now() + op.ttl_days * 86400000).toISOString()
        : null;
      upsert.run({
        key: op.key,
        type: op.type || 'thread',
        text: op.text,
        source: `email:${emailId}`,
        expiresAt,
      });
      applied++;
    } else if (op.op === 'forget' && op.key) {
      del.run(op.key);
      applied++;
    }
  }
  return applied;
}

function cleanExpiredMemories(db) {
  return db.prepare(`
    DELETE FROM memory_items
    WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
  `).run().changes;
}

module.exports = { getActiveMemories, formatMemoriesForPrompt, applyMemoryOps, cleanExpiredMemories };
