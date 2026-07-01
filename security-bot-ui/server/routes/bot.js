"use strict";
const express = require("express");
const db      = require("../db");
const bus     = require("../emitter");
const { requireSession, requireBotAuth } = require("../middleware");
const router  = express.Router();

// Bot heartbeat — kaynak durumu ile birlikte (bot auth)
router.post("/heartbeat", requireBotAuth, (req, res) => {
  const { source_status } = req.body || {};

  db.prepare(`
    UPDATE bot_status
    SET last_seen = datetime('now'), status = 'online', source_status = ?
    WHERE id = 1
  `).run(source_status ? JSON.stringify(source_status) : null);

  // pending_trigger ve pending_alert atomik oku + sıfırla
  const row     = db.prepare("SELECT pending_trigger, pending_alert, pending_telegram FROM bot_status WHERE id = 1").get();
  const trigger = row?.pending_trigger === 1;
  let   alert    = null;
  let   telegramMsg = null;
  if (trigger) db.prepare("UPDATE bot_status SET pending_trigger = 0 WHERE id = 1").run();
  if (row?.pending_alert) {
    try { alert = JSON.parse(row.pending_alert); } catch {}
    db.prepare("UPDATE bot_status SET pending_alert = NULL WHERE id = 1").run();
  }
  if (row?.pending_telegram) {
    // Yeni format: {"id":123,"content":"..."} — eski format: düz string
    let pending = null;
    try {
      const parsed = JSON.parse(row.pending_telegram);
      if (parsed && typeof parsed === "object" && "content" in parsed) pending = parsed;
    } catch {}
    if (!pending) pending = { id: null, content: row.pending_telegram };
    telegramMsg = pending;
    db.prepare("UPDATE bot_status SET pending_telegram = NULL WHERE id = 1").run();
  }

  bus.emit("heartbeat", { status: "online" });
  res.json({ ok: true, trigger, alert, telegram_message: telegramMsg });
});

// Bot durumu (oturum gerektirir)
router.get("/status", requireSession, (req, res) => {
  const row = db.prepare("SELECT * FROM bot_status WHERE id = 1").get();
  if (!row) return res.json({ status: "unknown" });
  const lastSeen = row.last_seen ? new Date(row.last_seen + "Z") : null;
  const online   = lastSeen && (Date.now() - lastSeen.getTime()) < 90_000;
  res.json({ status: online ? "online" : "offline", last_seen: row.last_seen });
});

// UI'dan rapor tetikle (oturum gerektirir)
router.post("/trigger", requireSession, (req, res) => {
  db.prepare("UPDATE bot_status SET pending_trigger = 1 WHERE id = 1").run();
  res.json({ ok: true, message: "Trigger ayarlandı — bot bir sonraki heartbeat'te çalıştıracak" });
});

// Kaynak durumları (oturum gerektirir)
router.get("/sources", requireSession, (req, res) => {
  const row = db.prepare("SELECT source_status FROM bot_status WHERE id = 1").get();
  let sources = {};
  try { sources = JSON.parse(row?.source_status || "{}"); } catch {}
  res.json({ sources });
});

// Telegram mesaj kaydet (bot auth)
// updateId verilmişse mevcut 'queued' satırı UPDATE eder (UI→bot senkronu), yoksa yeni INSERT
router.post("/telegram/messages", requireBotAuth, (req, res) => {
  const { direction, chatId, messageType, content, status, triggerSource, updateId } = req.body || {};
  if (!content) return res.status(400).json({ error: "content gerekli" });

  if (updateId) {
    const info = db.prepare(`
      UPDATE telegram_messages
         SET status = ?, chat_id = COALESCE(?, chat_id)
       WHERE id = ?
    `).run(status || "sent", chatId || null, parseInt(updateId));
    if (info.changes > 0) return res.json({ ok: true, updated: updateId });
    // Fallback: id bulunamadıysa INSERT olarak devam et
  }

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

// Telegram mesaj geçmişi (oturum gerektirir)
router.get("/telegram/messages", requireSession, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50"), 200);
  const rows  = db.prepare("SELECT * FROM telegram_messages ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json({ rows });
});

module.exports = router;
