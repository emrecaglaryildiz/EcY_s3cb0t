"use strict";

const BOT_SECRET = process.env.BOT_SECRET || "";

if (!BOT_SECRET) {
  console.warn("[WARN] BOT_SECRET tanımlı değil — bot API endpoint'leri korumasız (iç ağda güvenli).");
}

// Tarayıcı oturumu gerektirir (browser-facing GET routes)
function requireSession(req, res, next) {
  if (!req.session?.user?.id) return res.status(401).json({ error: "Oturum açılmamış" });
  next();
}

// Bot-to-server iç çağrıları için (POST heartbeat, push reports/signals, vb.)
function requireBotAuth(req, res, next) {
  if (!BOT_SECRET) return next(); // Secret yoksa iç ağdan gelen her şeye izin ver
  const h = req.headers["x-bot-secret"] || "";
  if (h === BOT_SECRET) return next();
  return res.status(401).json({ error: "Bot yetkisi gerekli" });
}

module.exports = { requireSession, requireBotAuth };
