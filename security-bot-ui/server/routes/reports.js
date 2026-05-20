"use strict";
const express = require("express");
const db      = require("../db");
const bus     = require("../emitter");
const { requireSession, requireBotAuth } = require("../middleware");
const router  = express.Router();

// Rapor kaydet (bot tarafından kullanılır)
router.post("/", requireBotAuth, (req, res) => {
  const { reportType, content, wazuhAlerts, wazuhAgents,
          obsDevicesUp, obsDevicesDown, obsAlerts, status } = req.body || {};
  if (!content) return res.status(400).json({ error: "content gerekli" });

  const now    = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO reports (report_type, content, wazuh_alerts, wazuh_agents,
      obs_devices_up, obs_devices_down, obs_alerts, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reportType || "auto", content,
    wazuhAlerts || 0, wazuhAgents || 0,
    obsDevicesUp || 0, obsDevicesDown || 0,
    obsAlerts || 0, status || "success"
  );

  // SSE ile bağlı istemcilere bildir
  bus.emit("report", { id: result.lastInsertRowid, report_type: reportType || "auto", created_at: now });

  res.json({ ok: true, id: result.lastInsertRowid });
});

// Rapor listesi (oturum gerektirir)
router.get("/", requireSession, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || "50"), 200);
  const offset = parseInt(req.query.offset || "0");
  const rows   = db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  const total  = db.prepare("SELECT COUNT(*) as cnt FROM reports").get().cnt;
  res.json({ total, rows });
});

// Son rapor (oturum gerektirir)
router.get("/latest", requireSession, (req, res) => {
  const row = db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 1").get();
  res.json(row || null);
});

module.exports = router;
