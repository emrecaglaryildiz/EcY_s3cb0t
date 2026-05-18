"use strict";
const express = require("express");
const db      = require("../db");
const bus     = require("../emitter");
const router  = express.Router();

// Sinyal kaydet
router.post("/", (req, res) => {
  const { source, severity, title, body, raw } = req.body || {};
  if (!source || !title) return res.status(400).json({ error: "source ve title gerekli" });

  const sev    = ["critical", "warning", "info"].includes(severity) ? severity : "info";
  const now    = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO signals (source, severity, title, body, raw) VALUES (?, ?, ?, ?, ?)"
  ).run(source, sev, title, body || null, raw ? JSON.stringify(raw) : null);

  // SSE ile bağlı istemcilere canlı bildir
  bus.emit("signal", { id: result.lastInsertRowid, source, severity: sev, title, body: body || null, created_at: now });

  res.json({ ok: true, id: result.lastInsertRowid });
});

// Sinyal listesi — filtre + `since` tarih desteği
router.get("/", (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || "100"), 500);
  const offset = parseInt(req.query.offset || "0");
  const { severity, source, since, until } = req.query;

  let where  = "WHERE 1=1";
  const params = [];
  if (severity) { where += " AND severity = ?";      params.push(severity); }
  if (source)   { where += " AND source = ?";        params.push(source);   }
  if (since) { where += " AND created_at >= ?"; params.push(since.replace("T", " ")); }
  if (until) { where += " AND created_at <= ?"; params.push(until.replace("T", " ")); }

  const rows  = db.prepare(`SELECT * FROM signals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM signals ${where}`).get(...params).cnt;
  res.json({ total, rows });
});

// Özet istatistikler
router.get("/stats", (req, res) => {
  const sinceRaw   = req.query.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since      = sinceRaw.replace("T", " ");
  const bySeverity = db.prepare("SELECT severity, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY severity").all(since);
  const bySource   = db.prepare("SELECT source, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY source ORDER BY cnt DESC LIMIT 10").all(since);
  res.json({ bySeverity, bySource, since });
});

module.exports = router;
