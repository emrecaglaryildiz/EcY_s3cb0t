"use strict";
const express = require("express");
const db      = require("../db");
const router  = express.Router();

// Bot heartbeat
router.post("/heartbeat", (req, res) => {
  db.prepare(
    "UPDATE bot_status SET last_seen = datetime('now'), status = 'online' WHERE id = 1"
  ).run();
  res.json({ ok: true });
});

// Bot durumunu sorgula
router.get("/status", (req, res) => {
  const row = db.prepare("SELECT * FROM bot_status WHERE id = 1").get();
  if (!row) return res.json({ status: "unknown" });

  // Son 90 saniyede heartbeat gelmediyse offline say
  const lastSeen = row.last_seen ? new Date(row.last_seen + "Z") : null;
  const online   = lastSeen && (Date.now() - lastSeen.getTime()) < 90_000;
  res.json({ status: online ? "online" : "offline", last_seen: row.last_seen });
});

// Telegram mesajlarını kaydet
router.post("/telegram/messages", (req, res) => {
  const { direction, chatId, messageType, content, status, triggerSource } = req.body || {};
  if (!content) return res.status(400).json({ error: "content gerekli" });

  db.prepare(`
    INSERT INTO telegram_messages (direction, chat_id, message_type, content, status, trigger_source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    direction || "out", chatId || null,
    messageType || "report", content,
    status || "sent", triggerSource || "auto"
  );
  res.json({ ok: true });
});

// Telegram mesaj geçmişi
router.get("/telegram/messages", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50"), 200);
  const rows  = db.prepare(
    "SELECT * FROM telegram_messages ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  res.json({ rows });
});

module.exports = router;
