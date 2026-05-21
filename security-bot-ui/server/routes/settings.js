"use strict";
const express = require("express");
const db      = require("../db");
const { requireSession, requireBotAuth } = require("../middleware");
const router  = express.Router();

const ALLOWED_KEYS = [
  "llm_provider", "llm_base_url", "llm_api_key", "llm_model", "llm_timeout", "llm_system_prompt",
  "wazuh_host", "wazuh_user", "wazuh_pass", "wazuh_alert_level", "wazuh_verify_ssl",
  "wazuh_backend", "wazuh_es_host", "wazuh_es_user", "wazuh_es_pass",
  "obs_host", "obs_user", "obs_pass", "obs_backend",
  "telegram_token", "telegram_chat_id",
  // SMTP
  "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "smtp_to",
  "smtp_tls", "smtp_on_critical_only",
  // Slack
  "slack_webhook_url", "slack_channel", "slack_on_critical_only",
  // Teams
  "teams_webhook_url", "teams_on_critical_only",
  // Graylog
  "graylog_host", "graylog_user", "graylog_pass", "graylog_range_seconds", "graylog_verify_ssl",
  // Fortinet
  "fortinet_host", "fortinet_auth", "fortinet_api_token", "fortinet_user", "fortinet_pass",
  "fortinet_vdom", "fortinet_verify_ssl", "fortinet_timeout",
  // Prometheus
  "prometheus_host", "alertmanager_host", "prometheus_user", "prometheus_pass",
  "prometheus_verify_ssl", "prometheus_timeout",
  // Zabbix
  "zabbix_host", "zabbix_user", "zabbix_pass", "zabbix_api_token",
  "zabbix_verify_ssl", "zabbix_timeout",
  // Elastic
  "elastic_host", "elastic_user", "elastic_pass", "elastic_index",
  "elastic_verify_ssl", "elastic_timeout",
  // Genel
  "check_interval_minutes", "webhook_max_store",
];

// Fields that should be masked on GET (empty string returned, _set flag added)
const MASKED_KEYS = [
  "llm_api_key", "wazuh_pass", "wazuh_es_pass", "obs_pass", "telegram_token",
  "smtp_pass", "slack_webhook_url", "teams_webhook_url",
  "graylog_pass", "fortinet_api_token", "fortinet_pass",
  "prometheus_pass", "zabbix_pass", "zabbix_api_token", "elastic_pass",
];

// GET /api/settings — UI için (gizli alanlar maskeli, oturum gerektirir)
router.get("/", requireSession, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj  = Object.fromEntries(rows.map(r => [r.key, r.value]));
  for (const key of MASKED_KEYS) {
    obj[`${key}_set`] = (obj[key] || "") !== "";
    obj[key] = "";
  }
  res.json(obj);
});

// PATCH /api/settings — UI'dan güncelle
router.patch("/", requireSession, (req, res) => {
  const updates = req.body || {};
  const upsert  = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  db.transaction(() => {
    for (const key of ALLOWED_KEYS) {
      if (!(key in updates)) continue;
      // Skip empty values for masked/secret fields (preserve existing value)
      if (MASKED_KEYS.includes(key) && updates[key] === "") continue;
      upsert.run(key, String(updates[key] ?? ""));
    }
  })();
  res.json({ ok: true });
});

// GET /api/settings/llm — bot için tam LLM config (bot auth gerektirir)
router.get("/llm", requireBotAuth, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'llm_%'").all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// GET /api/settings/sources — bot için kaynak yapılandırmaları (tam değerler, bot auth gerektirir)
router.get("/sources", requireBotAuth, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'llm_%'").all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

module.exports = router;
