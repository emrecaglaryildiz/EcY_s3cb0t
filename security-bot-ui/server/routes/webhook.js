"use strict";
const express = require("express");
const db      = require("../db");
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

// POST /api/webhook veya /api/webhook/:source
router.post(["/:source", "/"], (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const source   = req.params.source || "generic";
  const payload  = req.body || {};
  const severity = parseSeverity(payload);
  const title    = extractTitle(payload, source);

  const result = db.prepare(
    "INSERT INTO signals (source, severity, title, body, raw) VALUES (?, ?, ?, ?, ?)"
  ).run(source, severity, title, payload.description || payload.message || null, JSON.stringify(payload));

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
