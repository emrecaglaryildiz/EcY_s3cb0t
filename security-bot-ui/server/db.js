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
    ack        INTEGER DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO bot_status (id, status) VALUES (1, 'unknown');
`);

// Mevcut tablolara sütun ekle (migration)
try { db.exec("ALTER TABLE bot_status ADD COLUMN pending_trigger INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE bot_status ADD COLUMN source_status TEXT");                } catch {}
try { db.exec("ALTER TABLE bot_status ADD COLUMN pending_alert TEXT");                } catch {}
try { db.exec("ALTER TABLE bot_status ADD COLUMN pending_telegram TEXT");             } catch {}
try { db.exec("ALTER TABLE signals ADD COLUMN ack INTEGER DEFAULT 0");                } catch {}
// Migrate old host.docker.internal default to fixed subnet gateway
try {
  db.exec("UPDATE settings SET value='http://172.28.0.1:11434' WHERE key='llm_base_url' AND value='http://host.docker.internal:11434'");
} catch {}

// ── LLM ayarları tablosu ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`);
const _ins = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of [
  ["llm_provider",     "ollama"],
  ["llm_base_url",     "http://172.28.0.1:11434"],
  ["llm_api_key",      ""],
  ["llm_model",        "qwen2.5:3b"],
  ["llm_timeout",      "60"],
  ["llm_system_prompt",""],
  // Wazuh
  ["wazuh_host",        "https://wazuh-server:55000"],
  ["wazuh_user",        "apiuser"],
  ["wazuh_pass",        ""],
  ["wazuh_alert_level", "7"],
  ["wazuh_verify_ssl",  "0"],
  ["wazuh_backend",     "api"],
  ["wazuh_es_host",     ""],
  ["wazuh_es_user",     ""],
  ["wazuh_es_pass",     ""],
  // Observium
  ["obs_host",          "http://observium"],
  ["obs_user",          "admin"],
  ["obs_pass",          ""],
  ["obs_backend",       "requests"],
  // Telegram
  ["telegram_token",    ""],
  ["telegram_chat_id",  ""],
  // Bildirimler — SMTP
  ["smtp_host",             ""],
  ["smtp_port",             "587"],
  ["smtp_user",             ""],
  ["smtp_pass",             ""],
  ["smtp_from",             ""],
  ["smtp_to",               ""],
  ["smtp_tls",              "1"],
  ["smtp_on_critical_only", "1"],
  // Bildirimler — Slack
  ["slack_webhook_url",      ""],
  ["slack_channel",          ""],
  ["slack_on_critical_only", "1"],
  // Bildirimler — Teams
  ["teams_webhook_url",      ""],
  ["teams_on_critical_only", "1"],
  // Graylog
  ["graylog_host",          ""],
  ["graylog_user",          ""],
  ["graylog_pass",          ""],
  ["graylog_range_seconds", "3600"],
  ["graylog_verify_ssl",    "0"],
  // Fortinet
  ["fortinet_host",        ""],
  ["fortinet_auth",        "token"],
  ["fortinet_api_token",   ""],
  ["fortinet_user",        "admin"],
  ["fortinet_pass",        ""],
  ["fortinet_vdom",        "root"],
  ["fortinet_verify_ssl",  "0"],
  ["fortinet_timeout",     "15"],
  // Prometheus
  ["prometheus_host",       ""],
  ["alertmanager_host",     ""],
  ["prometheus_user",       ""],
  ["prometheus_pass",       ""],
  ["prometheus_verify_ssl", "0"],
  ["prometheus_timeout",    "15"],
  // Zabbix
  ["zabbix_host",       ""],
  ["zabbix_user",       "Admin"],
  ["zabbix_pass",       ""],
  ["zabbix_api_token",  ""],
  ["zabbix_verify_ssl", "0"],
  ["zabbix_timeout",    "15"],
  // Elastic
  ["elastic_host",       ""],
  ["elastic_user",       "elastic"],
  ["elastic_pass",       ""],
  ["elastic_index",      "*"],
  ["elastic_verify_ssl", "0"],
  ["elastic_timeout",    "15"],
  // Genel
  ["check_interval_minutes", "30"],
  ["webhook_max_store",      "200"],
]) _ins.run(k, v);

// ── İndeksler ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_signals_severity   ON signals (severity);
  CREATE INDEX IF NOT EXISTS idx_signals_ack        ON signals (ack);
  CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_telegram_created_at ON telegram_messages (created_at DESC);
`);

// ── Veri saklama sınırı (her gün temizlik) ───────────────────────────────────
function _runRetention() {
  db.prepare("DELETE FROM signals          WHERE created_at < datetime('now', '-90 days')").run();
  db.prepare("DELETE FROM reports          WHERE created_at < datetime('now', '-180 days')").run();
  db.prepare("DELETE FROM telegram_messages WHERE created_at < datetime('now', '-90 days')").run();
}
// İlk çalıştırmada ve sonra her 24 saatte bir
_runRetention();
setInterval(_runRetention, 24 * 60 * 60 * 1000);

// ── İlk admin kullanıcı ───────────────────────────────────────────────────────
const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!existing) {
  const hash = bcrypt.hashSync("admin", 10);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run("admin", hash);
}

module.exports = db;
