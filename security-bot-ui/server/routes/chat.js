"use strict";
const express = require("express");
const db      = require("../db");
const { requireSession } = require("../middleware");
const router  = express.Router();

const DEFAULT_SYSTEM = "Sen EcY_S3CB0T güvenlik asistanısın. Siber güvenlik, ağ izleme, sistem yönetimi ve log analizi konularında uzman olarak yardımcı olursun. Türkçe yanıt ver. Teknik konularda net ve özlü ol.";

function getLLMConfig() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'llm_%'").all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function callLLM(messages, cfg) {
  const provider   = cfg.llm_provider  || "ollama";
  const model      = cfg.llm_model     || "qwen2.5:3b";
  const sysPrompt  = cfg.llm_system_prompt?.trim() || DEFAULT_SYSTEM;
  const timeoutMs  = Math.min(parseInt(cfg.llm_timeout || "60") * 1000, 120_000);
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider === "ollama") {
      const host = (cfg.llm_base_url || "http://localhost:11434").replace(/\/$/, "");
      const res  = await fetch(`${host}/api/chat`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false,
          messages: [{ role: "system", content: sysPrompt }, ...messages] }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return data.message?.content || "Boş yanıt";
    }

    if (provider === "openai") {
      const baseUrl = (cfg.llm_base_url || "https://api.openai.com/v1").replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json",
                   "Authorization": `Bearer ${cfg.llm_api_key || ""}` },
        body: JSON.stringify({ model,
          messages: [{ role: "system", content: sysPrompt }, ...messages] }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || `HTTP ${res.status}`); }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "Boş yanıt";
    }

    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json",
                   "x-api-key": cfg.llm_api_key || "",
                   "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2048,
          system: sysPrompt, messages }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || `HTTP ${res.status}`); }
      const data = await res.json();
      return data.content?.[0]?.text || "Boş yanıt";
    }

    throw new Error(`Desteklenmeyen provider: ${provider}`);
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/chat/history
router.get("/history", requireSession, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "100"), 500);
  const rows  = db.prepare("SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT ?").all(limit);
  res.json({ rows });
});

// POST /api/chat/message
router.post("/message", requireSession, async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: "message gerekli" });

  const userMsg = message.trim();
  db.prepare("INSERT INTO chat_messages (role, content) VALUES (?, ?)").run("user", userMsg);

  const msgs = [...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
                { role: "user", content: userMsg }];
  try {
    const cfg    = getLLMConfig();
    const answer = await callLLM(msgs, cfg);
    db.prepare("INSERT INTO chat_messages (role, content) VALUES (?, ?)").run("assistant", answer);
    res.json({ ok: true, answer, provider: cfg.llm_provider || "ollama", model: cfg.llm_model || "?" });
  } catch (err) {
    const msg = err.name === "AbortError" ? "LLM zaman aşımı — timeout değerini artırın" : err.message;
    res.status(502).json({ error: msg });
  }
});

// POST /api/chat/send-telegram
router.post("/send-telegram", requireSession, (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: "content gerekli" });
  db.prepare("UPDATE bot_status SET pending_telegram = ? WHERE id = 1").run(content);
  res.json({ ok: true, message: "Mesaj kuyruğa alındı — bot sonraki heartbeat'te gönderecek" });
});

// DELETE /api/chat/history
router.delete("/history", requireSession, (req, res) => {
  db.prepare("DELETE FROM chat_messages").run();
  res.json({ ok: true });
});

module.exports = router;
