"use strict";
const express        = require("express");
const net            = require("net");
const db             = require("../db");
const { requireSession } = require("../middleware");
const router         = express.Router();

function cfg(prefix) {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key LIKE ? OR key LIKE ?"
  ).all(`${prefix}_%`, prefix === "prometheus" ? "alertmanager_%" : `${prefix}_NOMATCH`);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function ft(url, opts = {}, ms = 10000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Test handler'ları ─────────────────────────────────────────────────────────

async function testLLM() {
  const s        = cfg("llm");
  const provider = s.llm_provider || "ollama";
  const base     = (s.llm_base_url || "http://host.docker.internal:11434").replace(/\/$/, "");
  const apiKey   = s.llm_api_key || "";

  if (provider === "ollama") {
    const r = await ft(`${base}/api/tags`);
    if (!r.ok) throw new Error(`HTTP ${r.status} — URL doğru mu? (${base})`);
    const data   = await r.json();
    const models = (data.models || []).map(m => m.name);
    return {
      ok: true,
      preview: `Ollama bağlandı\nURL: ${base}\nMevcut modeller: ${models.join(", ") || "(henüz yok)"}`,
      data: { models },
    };
  }

  if (provider === "openai") {
    const r = await ft(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error?.message || `HTTP ${r.status}`); }
    const data   = await r.json();
    const models = (data.data || []).slice(0, 5).map(m => m.id);
    return { ok: true, preview: `OpenAI bağlandı\nModeller (ilk 5): ${models.join(", ")}` };
  }

  if (provider === "claude") {
    const r = await ft("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error?.message || `HTTP ${r.status}`); }
    const data   = await r.json();
    const models = (data.data || []).slice(0, 5).map(m => m.id);
    return { ok: true, preview: `Claude API bağlandı\nModeller: ${models.join(", ")}` };
  }

  throw new Error(`Desteklenmeyen provider: ${provider}`);
}

async function testWazuh() {
  const s    = cfg("wazuh");
  const host = (s.wazuh_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Wazuh host tanımlı değil");
  const creds = Buffer.from(`${s.wazuh_user || "wazuh"}:${s.wazuh_pass || ""}`).toString("base64");
  const r     = await ft(`${host}/security/user/authenticate`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!r.ok) throw new Error(`Wazuh auth başarısız: HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.data?.token) throw new Error("Token alınamadı");
  return { ok: true, preview: `Wazuh bağlantısı başarılı\nHost: ${host}\nToken alındı (geçerli kimlik bilgileri)` };
}

async function testObservium() {
  const s    = cfg("obs");
  const host = (s.obs_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Observium host tanımlı değil");
  const r = await ft(`${host}/`);
  return {
    ok: true,
    preview: `Observium'a ulaşıldı\nHost: ${host}\nHTTP ${r.status} — giriş sayfası erişilebilir`,
  };
}

async function testTelegram() {
  const s     = cfg("telegram");
  const token = s.telegram_token;
  if (!token) throw new Error("Telegram token tanımlı değil");
  const r    = await ft(`https://api.telegram.org/bot${token}/getMe`);
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.description || `HTTP ${r.status}`);
  const bot = data.result;
  return {
    ok: true,
    preview: `Telegram bağlantısı başarılı\nBot: @${bot.username}\nAdı: ${bot.first_name}\nID: ${bot.id}`,
  };
}

async function testGraylog() {
  const s    = cfg("graylog");
  const host = (s.graylog_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Graylog host tanımlı değil");
  const creds = Buffer.from(`${s.graylog_user || "admin"}:${s.graylog_pass || ""}`).toString("base64");
  const r     = await ft(`${host}/api/system`, {
    headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return {
    ok: true,
    preview: `Graylog bağlandı\nHost: ${host}\nSürüm: ${data.version || "?"}\nDurum: ${data.lb_status || "?"}`,
  };
}

async function testFortinet() {
  const s    = cfg("fortinet");
  const host = (s.fortinet_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Fortinet host tanımlı değil");
  const headers = {};
  if (s.fortinet_auth === "token" && s.fortinet_api_token) {
    headers.Authorization = `Bearer ${s.fortinet_api_token}`;
  }
  const r = await ft(`${host}/api/v2/monitor/system/status`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data    = await r.json();
  const results = data.results || data;
  return {
    ok: true,
    preview: `FortiGate bağlandı\nHost: ${host}\nHostname: ${results?.hostname || "?"}\nSürüm: ${results?.version || "?"}`,
  };
}

async function testPrometheus() {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('prometheus_host','alertmanager_host')"
  ).all();
  const s    = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const host = (s.prometheus_host || s.alertmanager_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Prometheus veya Alertmanager host tanımlı değil");
  const r    = await ft(`${host}/api/v1/query?query=up`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data  = await r.json();
  const count = data?.data?.result?.length || 0;
  return { ok: true, preview: `Prometheus bağlandı\nHost: ${host}\nAktif hedef sayısı: ${count}` };
}

async function testZabbix() {
  const s    = cfg("zabbix");
  const host = (s.zabbix_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Zabbix host tanımlı değil");
  // API version sorgusu (her zaman çalışır)
  const r    = await ft(`${host}/api_jsonrpc.php`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", method: "apiinfo.version", params: [], id: 1 }),
  });
  const data = await r.json();
  const ver  = data.result || "?";
  // Token varsa kimlik doğrulama dene
  let authNote = "";
  if (s.zabbix_api_token || (s.zabbix_user && s.zabbix_pass)) {
    const params = s.zabbix_api_token
      ? { token: s.zabbix_api_token }
      : { user: s.zabbix_user, password: s.zabbix_pass };
    const r2   = await ft(`${host}/api_jsonrpc.php`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", method: "user.login", params, id: 2 }),
    });
    const d2 = await r2.json();
    authNote = d2.error ? `\nAuth hatası: ${d2.error.data}` : "\nKimlik doğrulama başarılı";
  }
  return { ok: true, preview: `Zabbix bağlandı\nHost: ${host}\nAPI sürüm: ${ver}${authNote}` };
}

async function testElastic() {
  const s    = cfg("elastic");
  const host = (s.elastic_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Elasticsearch host tanımlı değil");
  const headers = {};
  if (s.elastic_user) {
    headers.Authorization = `Basic ${Buffer.from(`${s.elastic_user}:${s.elastic_pass || ""}`).toString("base64")}`;
  }
  const r    = await ft(`${host}/_cluster/health`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return {
    ok: true,
    preview: `Elasticsearch bağlandı\nHost: ${host}\nKlüster: ${data.cluster_name || "?"}\nDurum: ${data.status || "?"}`,
  };
}

async function testSMTP() {
  const s    = cfg("smtp");
  const host = s.smtp_host;
  if (!host) throw new Error("SMTP host tanımlı değil");
  const port = parseInt(s.smtp_port || "587");
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(port, host);
    sock.setTimeout(8000);
    sock.on("connect", () => {
      sock.destroy();
      resolve({ ok: true, preview: `SMTP bağlantısı başarılı\nHost: ${host}:${port}\nPort açık ve erişilebilir` });
    });
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`Zaman aşımı — ${host}:${port} yanıt vermedi`)); });
    sock.on("error",   e  => reject(new Error(e.message)));
  });
}

async function testSlack() {
  const s   = cfg("slack");
  const url = s.slack_webhook_url;
  if (!url) throw new Error("Slack Webhook URL tanımlı değil");
  if (!url.startsWith("https://hooks.slack.com/")) throw new Error("Geçersiz Slack Webhook URL formatı");
  return { ok: true, preview: `Slack Webhook URL formatı geçerli\n${url.slice(0, 50)}...` };
}

async function testTeams() {
  const s   = cfg("teams");
  const url = s.teams_webhook_url;
  if (!url) throw new Error("Teams Webhook URL tanımlı değil");
  if (!url.includes("webhook.office.com") && !url.includes("logic.azure.com")) {
    throw new Error("Geçersiz Teams Webhook URL formatı");
  }
  return { ok: true, preview: `Teams Webhook URL formatı geçerli\n${url.slice(0, 50)}...` };
}

const HANDLERS = {
  llm: testLLM, wazuh: testWazuh, observium: testObservium,
  telegram: testTelegram, graylog: testGraylog, fortinet: testFortinet,
  prometheus: testPrometheus, zabbix: testZabbix, elastic: testElastic,
  smtp: testSMTP, slack: testSlack, teams: testTeams,
};

// POST /api/test/:source
router.post("/:source", requireSession, async (req, res) => {
  const fn = HANDLERS[req.params.source];
  if (!fn) return res.status(404).json({ ok: false, error: "Bilinmeyen kaynak" });
  try {
    res.json(await fn());
  } catch (err) {
    res.json({ ok: false, error: err.name === "AbortError" ? "Bağlantı zaman aşımı (10s)" : err.message });
  }
});

module.exports = router;
