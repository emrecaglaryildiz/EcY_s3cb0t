"use strict";
const Database = require("better-sqlite3");
const bcrypt   = require("bcryptjs");
const path     = require("path");
const fs       = require("fs");

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, "../data/data.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Şema ─────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type      TEXT NOT NULL DEFAULT 'auto',
    content          TEXT NOT NULL,
    wazuh_alerts     INTEGER DEFAULT 0,
    wazuh_agents     INTEGER DEFAULT 0,
    obs_devices_up   INTEGER DEFAULT 0,
    obs_devices_down INTEGER DEFAULT 0,
    obs_alerts       INTEGER DEFAULT 0,
    status           TEXT DEFAULT 'success',
    created_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS signals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'info',
    title      TEXT NOT NULL,
    body       TEXT,
    raw        TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS telegram_messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    direction      TEXT NOT NULL DEFAULT 'out',
    chat_id        TEXT,
    message_type   TEXT DEFAULT 'report',
    content        TEXT,
    status         TEXT DEFAULT 'sent',
    trigger_source TEXT DEFAULT 'auto',
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bot_status (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_seen       TEXT,
    status          TEXT DEFAULT 'unknown',
    pending_trigger INTEGER DEFAULT 0,
    source_status   TEXT
  );

  INSERT OR IGNORE INTO bot_status (id, status) VALUES (1, 'unknown');
`);

// Mevcut bot_status tablosuna sütun ekle (migration)
try { db.exec("ALTER TABLE bot_status ADD COLUMN pending_trigger INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE bot_status ADD COLUMN source_status TEXT");                } catch {}

// İlk admin kullanıcı
const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!existing) {
  const hash = bcrypt.hashSync("admin", 10);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run("admin", hash);
}

module.exports = db;
