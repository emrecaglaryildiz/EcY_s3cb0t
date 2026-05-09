"use strict";
const express = require("express");
const db      = require("../db");
const router  = express.Router();

// Sinyal kaydet (webhook veya bot tarafından)
router.post("/", (req, res) => {
  const { source, severity, title, body, raw } = req.body || {};
  if (!source || !title) return res.status(400).json({ error: "source ve title gerekli" });

  const result = db.prepare(
    "INSERT INTO signals (source, severity, title, body, raw) VALUES (?, ?, ?, ?, ?)"
  ).run(
    source,
    ["critical", "warning", "info"].includes(severity) ? severity : "info",
    title,
    body || null,
    raw ? JSON.stringify(raw) : null
  );
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Sinyal listesi (filtre destekli)
router.get("/", (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit    || "100"), 500);
  const offset   = parseInt(req.query.offset   || "0");
  const severity = req.query.severity || null;
  const source   = req.query.source   || null;

  let where = "WHERE 1=1";
  const params = [];
  if (severity) { where += " AND severity = ?"; params.push(severity); }
  if (source)   { where += " AND source = ?";   params.push(source);   }

  const rows = db.prepare(
    `SELECT * FROM signals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM signals ${where}`).get(...params).cnt;
  res.json({ total, rows });
});

// Özet istatistikler
router.get("/stats", (req, res) => {
  const since = req.query.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const bySeverity = db.prepare(
    "SELECT severity, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY severity"
  ).all(since);
  const bySource = db.prepare(
    "SELECT source, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY source ORDER BY cnt DESC LIMIT 10"
  ).all(since);
  res.json({ bySeverity, bySource, since });
});

module.exports = router;
