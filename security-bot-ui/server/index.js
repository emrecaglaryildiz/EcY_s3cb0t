"use strict";
const express        = require("express");
const session        = require("express-session");
const helmet         = require("helmet");
const morgan         = require("morgan");
const path           = require("path");

const db             = require("./db");                 // DB başlatma (schema + seed)
const authRoutes     = require("./routes/auth");
const reportsRoutes  = require("./routes/reports");
const signalsRoutes  = require("./routes/signals");
const botRoutes      = require("./routes/bot");
const webhookRoutes  = require("./routes/webhook");

const app  = express();
const PORT = parseInt(process.env.PORT || "3000");

// ── Güvenlik & logging ────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("combined"));
app.use(express.json({ limit: "2mb" }));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || "change-me-in-production",
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.FORCE_SECURE_COOKIES === "true",
    httpOnly: true,
    maxAge:   8 * 3600 * 1000,   // 8 saat
  },
}));

// ── API rotaları ──────────────────────────────────────────────────────────────
app.use("/api/auth",              authRoutes);
app.use("/api/reports",           reportsRoutes);
app.use("/api/signals",           signalsRoutes);
app.use("/api/bot",               botRoutes);
app.use("/api/telegram/messages", (req, res, next) => {
  // Bot raporlama kolaylığı için /api/telegram/messages POST'u bot router'a yönlendir
  req.url = "/telegram/messages";
  botRoutes(req, res, next);
});
app.use("/api/webhook",           webhookRoutes);

// ── Dashboard (basit JSON özet) ───────────────────────────────────────────────
app.get("/api/dashboard", (req, res) => {
  const last24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const reportCount  = db.prepare("SELECT COUNT(*) as cnt FROM reports WHERE created_at >= ?").get(last24h).cnt;
  const signalCounts = db.prepare(
    "SELECT severity, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY severity"
  ).all(last24h);
  const botStatus    = db.prepare("SELECT * FROM bot_status WHERE id = 1").get();
  const lastReport   = db.prepare("SELECT created_at, report_type FROM reports ORDER BY created_at DESC LIMIT 1").get();

  res.json({
    report_count_24h: reportCount,
    signal_counts:    Object.fromEntries(signalCounts.map(r => [r.severity, r.cnt])),
    bot_status:       botStatus,
    last_report:      lastReport || null,
  });
});

// ── Sağlık kontrolü ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ── Hata işleyici ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Sunucu hatası" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`EcY_S3CB0T UI — port ${PORT}`);
});
