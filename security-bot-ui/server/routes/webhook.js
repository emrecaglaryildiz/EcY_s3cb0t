"use strict";
const express = require("express");
const db      = require("../db");
const bus     = require("../emitter");
const router  = express.Router();

const SECRET = process.env.WEBHOOK_UI_SECRET || "";

function authOk(req) {
  if (!SECRET) return true;
  const h = req.headers["authorization"] || "";
  if (h.startsWith("Bearer ")) return h.slice(7) === SECRET;
  return req.headers["x-webhook-secret"] === SECRET;
}

function parseSeverity(payload) {
  if (payload.state) {
    const s = payload.state.toLowerCase();
    if (["alerting", "firing", "critical"].includes(s)) return "critical";
    if (["pending", "warning"].includes(s)) return "warning";
    return "info";
  }
  const alerts = payload.alerts || [];
  if (alerts.length) {
    const sevs = alerts.map(a => (a.labels?.severity || "").toLowerCase());
    if (sevs.some(s => ["critical","error"].includes(s))) return "critical";
    if (sevs.some(s => s === "warning")) return "warning";
    return "info";
  }
  const sev = String(payload.severity || payload.level || payload.priority || "info").toLowerCase();
  if (["critical","error","fatal","high","disaster"].includes(sev)) return "critical";
  if (["warning","warn","medium","average"].includes(sev)) return "warning";
  return "info";
}

function extractTitle(payload, source) {
  for (const k of ["title","message","summary","name","alertname"]) {
    if (payload[k]) return String(payload[k]).slice(0, 200);
  }
  const alerts = payload.alerts || [];
  if (alerts.length) return alerts[0].labels?.alertname || "Webhook Alarmı";
  return `${source} webhook`;
}

// Dashboard chip / SOURCE_META anahtarlarıyla eşleşmesi için normalize et
function normalizeSource(raw) {
  const s = (raw || "").toString().trim().toLowerCase();
  if (!s || s === "generic" || s === "webhook") return "webhook";
  // Sık kullanılan takma adları eşle
  const aliases = {
    grafana: "prometheus", alertmanager: "prometheus", promalert: "prometheus",
    forti: "fortinet", fortigate: "fortinet",
    obs: "observium",
    zbx: "zabbix", zabbixsrv: "zabbix",
    gl: "graylog",
    es: "elastic", opensearch: "elastic", elasticsearch: "elastic",
  };
  return aliases[s] || s;
}

// POST /api/webhook veya /api/webhook/:source
router.post(["/:source", "/"], (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const source   = normalizeSource(req.params.source);
  const payload  = req.body || {};
  const severity = parseSeverity(payload);
  const title    = extractTitle(payload, source);

  const body   = payload.description || payload.message || null;
  const now    = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO signals (source, severity, title, body, raw) VALUES (?, ?, ?, ?, ?)"
  ).run(source, severity, title, body, JSON.stringify(payload));

  const sigEvent = { id: result.lastInsertRowid, source, severity, title, body, created_at: now };
  bus.emit("signal", sigEvent);

  // Kritik sinyali bota ilet — bir sonraki heartbeat'te (≤60s) anlık bildirim gönderilir
  if (severity === "critical") {
    db.prepare("UPDATE bot_status SET pending_alert = ? WHERE id = 1").run(
      JSON.stringify({ title, source, severity, body, id: result.lastInsertRowid })
    );
  }

  res.json({ ok: true, id: result.lastInsertRowid, severity, title });
});

// Geçmiş webhook sinyalleri
router.get("/", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50"), 200);
  const rows  = db.prepare(
    "SELECT * FROM signals WHERE source != 'bot' ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  res.json({ total: rows.length, rows });
});

module.exports = router;
