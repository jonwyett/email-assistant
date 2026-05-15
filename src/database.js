'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { getMailboxPaths } = require('./config');

const dbs = new Map();

function getDb(mailboxId) {
  if (dbs.has(mailboxId)) return dbs.get(mailboxId);

  const dbPath = getMailboxPaths(mailboxId).db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);

  dbs.set(mailboxId, db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id      TEXT UNIQUE,
      from_name       TEXT,
      from_email      TEXT,
      to_email        TEXT,
      subject         TEXT,
      received_at     TEXT,
      raw_path        TEXT,
      import_source   TEXT,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_bodies (
      email_id              INTEGER PRIMARY KEY,
      text_body             TEXT,
      html_body             TEXT,
      clean_body            TEXT,
      clean_body_char_count INTEGER,
      FOREIGN KEY (email_id) REFERENCES emails(id)
    );

    CREATE TABLE IF NOT EXISTS email_analysis (
      email_id                  INTEGER PRIMARY KEY,
      category                  TEXT,
      event_type                TEXT,
      summary                   TEXT,
      importance                INTEGER,
      likely_routine            INTEGER DEFAULT 1,
      possible_action_required  INTEGER DEFAULT 0,
      include_in_digest         INTEGER DEFAULT 0,
      analysis_json             TEXT,
      analyzed_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (email_id) REFERENCES emails(id)
    );

    CREATE TABLE IF NOT EXISTS email_groups (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key         TEXT UNIQUE,
      group_name        TEXT,
      group_summary     TEXT,
      routine_count     INTEGER DEFAULT 0,
      notable_items     TEXT,
      aggregate_facts   TEXT,
      include_in_digest INTEGER DEFAULT 1,
      analysis_json     TEXT,
      analyzed_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memory_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_key   TEXT UNIQUE,
      memory_type  TEXT,
      memory_text  TEXT,
      source       TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS processing_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_type     TEXT,
      started_at   TEXT,
      completed_at TEXT,
      status       TEXT,
      email_count  INTEGER,
      notes        TEXT
    );
  `);

  // Migrations
  try { db.exec('ALTER TABLE email_analysis ADD COLUMN group_id INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE email_analysis ADD COLUMN digested_at TEXT'); } catch (_) {}
}

module.exports = { getDb };
