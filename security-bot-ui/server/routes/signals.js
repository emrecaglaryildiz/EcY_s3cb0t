"use strict";
const express = require("express");
const db      = require("../db");
const bus     = require("../emitter");
const { requireSession, requireBotAuth } = require("../middleware");
const router  = express.Router();

// Sinyal kaydet (bot/webhook tarafından kullanılır)
router.post("/", requireBotAuth, (req, res) => {
  const { source, severity, title, body, raw } = req.body || {};
  if (!source || !title) return res.status(400).json({ error: "source ve title gerekli" });

  // Dashboard chip filtresi ile eşleşmesi için lowercase normalize et
  const srcNorm = String(source).trim().toLowerCase() || "webhook";
  const sev    = ["critical", "warning", "info"].includes(severity) ? severity : "info";
  const now    = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO signals (source, severity, title, body, raw) VALUES (?, ?, ?, ?, ?)"
  ).run(srcNorm, sev, title, body || null, raw ? JSON.stringify(raw) : null);

  // SSE ile bağlı istemcilere canlı bildir
  bus.emit("signal", { id: result.lastInsertRowid, source: srcNorm, severity: sev, title, body: body || null, created_at: now });

  res.json({ ok: true, id: result.lastInsertRowid });
});

// Sinyal listesi — filtre + `since` tarih desteği (oturum gerektirir)
router.get("/", requireSession, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || "100"), 500);
  const offset = parseInt(req.query.offset || "0");
  const { severity, source, since, until, ack } = req.query;

  let where  = "WHERE 1=1";
  const params = [];
  if (severity) { where += " AND severity = ?";      params.push(severity); }
  if (source)   { where += " AND source = ?";        params.push(source);   }
  if (since) { where += " AND created_at >= ?"; params.push(since.replace("T", " ")); }
  if (until) { where += " AND created_at <= ?"; params.push(until.replace("T", " ")); }
  if (ack !== undefined) { where += " AND ack = ?";  params.push(parseInt(ack) || 0); }

  const rows  = db.prepare(`SELECT * FROM signals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM signals ${where}`).get(...params).cnt;
  res.json({ total, rows });
});

// Sinyal onayı (acknowledge) — oturum gerektirir
router.patch("/:id/ack", requireSession, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Geçersiz id" });
  db.prepare("UPDATE signals SET ack = 1 WHERE id = ?").run(id);
  res.json({ ok: true });
});

// Kaynaklar listesi (oturum gerektirir)
router.get("/sources", requireSession, (req, res) => {
  const rows = db.prepare("SELECT DISTINCT source FROM signals ORDER BY source").all();
  res.json({ sources: rows.map(r => r.source) });
});

// Özet istatistikler (oturum gerektirir)
router.get("/stats", requireSession, (req, res) => {
  const sinceRaw   = req.query.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since      = sinceRaw.replace("T", " ");
  const bySeverity = db.prepare("SELECT severity, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY severity").all(since);
  const bySource   = db.prepare("SELECT source, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY source ORDER BY cnt DESC LIMIT 10").all(since);
  res.json({ bySeverity, bySource, since });
});

module.exports = router;
