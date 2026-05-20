"use strict";
const express = require("express");
const db      = require("../db");
const { requireSession, requireBotAuth } = require("../middleware");
const router  = express.Router();

const ALLOWED_KEYS = ["llm_provider", "llm_base_url", "llm_api_key", "llm_model", "llm_timeout", "llm_system_prompt"];

// GET /api/settings — UI için (API key maskeli, oturum gerektirir)
router.get("/", requireSession, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj  = Object.fromEntries(rows.map(r => [r.key, r.value]));
  obj.llm_api_key_set = obj.llm_api_key !== "";
  obj.llm_api_key     = "";
  res.json(obj);
});

// PATCH /api/settings — UI'dan güncelle
router.patch("/", requireSession, (req, res) => {
  const updates = req.body || {};
  const upsert  = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  db.transaction(() => {
    for (const key of ALLOWED_KEYS) {
      if (!(key in updates)) continue;
      if (key === "llm_api_key" && updates[key] === "") continue;
      upsert.run(key, String(updates[key] ?? ""));
    }
  })();
  res.json({ ok: true });
});

// GET /api/settings/llm — bot için tam config (bot auth gerektirir)
router.get("/llm", requireBotAuth, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'llm_%'").all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

module.exports = router;
