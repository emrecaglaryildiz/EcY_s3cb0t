"use strict";
const express        = require("express");
const net            = require("net");
const https          = require("node:https");
const http           = require("node:http");
const db             = require("../db");
const { requireSession } = require("../middleware");
const router         = express.Router();

// fetch() rejects self-signed certs; use Node's https/http directly
function rawReq(url, { method = "GET", headers = {}, body, verifySSL = true } = {}, ms = 12000) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    let   req;
    const timer = setTimeout(() => req?.destroy(new Error("Bağlantı zaman aşımı")), ms);
    req = lib.request({
      hostname:           u.hostname,
      port:               u.port || (u.protocol === "https:" ? 443 : 80),
      path:               u.pathname + (u.search || ""),
      method, headers,
      rejectUnauthorized: verifySSL,
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        clearTimeout(timer);
        resolve({
          status: res.statusCode,
          ok:     res.statusCode >= 200 && res.statusCode < 400,
          json:   () => { try { return JSON.parse(data); } catch { throw new Error("JSON parse hatası"); } },
          text:   () => data,
        });
      });
    });
    req.on("error", e => { clearTimeout(timer); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

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
  const s       = cfg("wazuh");
  const backend = s.wazuh_backend || "elasticsearch";
  const verifySSL = (s.wazuh_verify_ssl || "0") === "1";

  if (backend === "elasticsearch") {
    const host = (s.wazuh_es_host || s.wazuh_host || "").replace(/\/$/, "");
    const user = s.wazuh_es_user || s.wazuh_user || "";
    const pass = s.wazuh_es_pass || s.wazuh_pass || "";
    if (!host) throw new Error("Elasticsearch host tanımlı değil (wazuh_es_host)");
    const creds = Buffer.from(`${user}:${pass}`).toString("base64");
    const r = await rawReq(`${host}/_cluster/health`, {
      headers: { Authorization: `Basic ${creds}` },
      verifySSL,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const d = r.json(); msg = d.error?.reason || d.error?.type || msg; } catch {}
      throw new Error(`ES bağlantısı başarısız: ${msg}`);
    }
    const data = r.json();
    // Count indices as a sanity check
    const idxRes = await rawReq(`${host}/wazuh-alerts-*/_count`, {
      headers: { Authorization: `Basic ${creds}` },
      verifySSL,
    }).catch(() => null);
    const docCount = idxRes?.ok ? (idxRes.json()?.count ?? "?") : "erişilemiyor";
    return {
      ok: true,
      preview: [
        `Elasticsearch bağlandı ✓`,
        `Host: ${host}`,
        `Cluster: ${data.cluster_name || "?"} — ${data.status || "?"}`,
        `Node: ${data.number_of_nodes ?? "?"}`,
        `wazuh-alerts-* belge sayısı: ${docCount}`,
      ].join("\n"),
    };
  }

  // REST API fallback
  const host = (s.wazuh_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Wazuh REST host tanımlı değil");
  const creds = Buffer.from(`${s.wazuh_user || "wazuh"}:${s.wazuh_pass || ""}`).toString("base64");
  const r = await rawReq(`${host}/security/user/authenticate`, {
    headers: { Authorization: `Basic ${creds}` },
    verifySSL,
  });
  if (!r.ok) throw new Error(`Wazuh REST auth başarısız: HTTP ${r.status}`);
  const data = r.json();
  if (!data?.data?.token) throw new Error("Token alınamadı");
  return { ok: true, preview: `Wazuh REST bağlantısı başarılı\nHost: ${host}\nToken alındı` };
}

async function testObservium() {
  const s       = cfg("obs");
  const host    = (s.obs_host || "").replace(/\/$/, "");
  const user    = s.obs_user || "admin";
  const pass    = s.obs_pass || "";
  const backend = s.obs_backend || "selenium";
  if (!host) throw new Error("Observium host tanımlı değil");

  // Erişilebilirlik kontrolü (her iki backend için)
  const homeRes  = await ft(`${host}/`, {}, 10000);
  if (!homeRes.ok && homeRes.status !== 302 && homeRes.status !== 301)
    throw new Error(`Sunucuya ulaşılamıyor: HTTP ${homeRes.status}`);
  const homeHtml = await homeRes.text().catch(() => "");
  const hasLoginForm = /name=["']username["']|name=["']password["']/i.test(homeHtml);

  // Selenium backend: sadece bağlantı doğrulaması (auth bota bırakılır)
  if (backend === "selenium") {
    return {
      ok: true,
      preview: [
        `Observium sunucusuna ulaşıldı ✓`,
        `Host: ${host}`,
        hasLoginForm ? `Giriş sayfası bulundu (form hazır)` : `Sayfa erişilebilir`,
        ``,
        `Backend: Selenium — kimlik doğrulaması bot konteyneri tarafından yapılır.`,
        `Gerçek bağlantı için "Rapor Üret" butonunu deneyin.`,
      ].join("\n"),
    };
  }

  // requests backend: gerçek login dene
  const hidden = {};
  for (const m of homeHtml.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)) {
    const nm = m[0].match(/name=["']([^"']+)["']/);
    const vm = m[0].match(/value=["']([^"']*)["']/);
    if (nm) hidden[nm[1]] = vm ? vm[1] : "";
  }
  const body = new URLSearchParams({ username: user, password: pass, ...hidden });
  const loginRes  = await ft(`${host}/login/`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, 12000);
  const loginText = await loginRes.text().catch(() => "");
  if (/incorrect|wrong.*password|invalid.*credential/i.test(loginText))
    throw new Error("Kullanıcı adı veya şifre hatalı");
  if (/\/login\//i.test(loginRes.url || "") && !/dashboard/i.test(loginText))
    throw new Error("Giriş başarısız — kimlik bilgilerini kontrol edin");
  const devMatch = loginText.match(/(\d+)\s*(?:devices?|cihaz)/i);
  return {
    ok: true,
    preview: [`Observium giriş başarılı ✓`, `Host: ${host}`, `Kullanıcı: ${user}`,
              devMatch ? `Cihaz: ${devMatch[1]}` : ""].filter(Boolean).join("\n"),
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

function flag(v) { return String(v).trim().toLowerCase() === "1" || v === true; }

async function testGraylog() {
  const s    = cfg("graylog");
  const host = (s.graylog_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Graylog host tanımlı değil");
  const creds = Buffer.from(`${s.graylog_user || "admin"}:${s.graylog_pass || ""}`).toString("base64");
  const r = await rawReq(`${host}/api/system`, {
    headers:   { Authorization: `Basic ${creds}`, Accept: "application/json" },
    verifySSL: flag(s.graylog_verify_ssl),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = r.json();
  return {
    ok: true,
    preview: `Graylog bağlandı ✓\nHost: ${host}\nSürüm: ${data.version || "?"}\nDurum: ${data.lb_status || "?"}`,
  };
}

async function testFortinet() {
  const s    = cfg("fortinet");
  const host = (s.fortinet_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Fortinet host tanımlı değil");
  const headers = { Accept: "application/json" };
  if (s.fortinet_auth === "token" && s.fortinet_api_token) {
    headers.Authorization = `Bearer ${s.fortinet_api_token}`;
  }
  const r = await rawReq(`${host}/api/v2/monitor/system/status`, {
    headers,
    verifySSL: flag(s.fortinet_verify_ssl),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? " — API token geçersiz olabilir" : ""}`);
  const data    = r.json();
  const results = data.results || data;
  return {
    ok: true,
    preview: `FortiGate bağlandı ✓\nHost: ${host}\nHostname: ${results?.hostname || "?"}\nSürüm: ${results?.version || "?"}`,
  };
}

async function testPrometheus() {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('prometheus_host','alertmanager_host','prometheus_verify_ssl')"
  ).all();
  const s    = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const host = (s.prometheus_host || s.alertmanager_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Prometheus veya Alertmanager host tanımlı değil");
  const isProm = !!s.prometheus_host;
  const path   = isProm ? "/api/v1/query?query=up" : "/api/v2/alerts";
  const r = await rawReq(`${host}${path}`, { verifySSL: flag(s.prometheus_verify_ssl) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = r.json();
  const info = isProm
    ? `Aktif hedef sayısı: ${data?.data?.result?.length || 0}`
    : `Aktif alarm sayısı: ${Array.isArray(data) ? data.length : 0}`;
  return { ok: true, preview: `${isProm ? "Prometheus" : "Alertmanager"} bağlandı ✓\nHost: ${host}\n${info}` };
}

async function testZabbix() {
  const s    = cfg("zabbix");
  const host = (s.zabbix_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Zabbix host tanımlı değil");
  const verifySSL = flag(s.zabbix_verify_ssl);
  const r = await rawReq(`${host}/api_jsonrpc.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "apiinfo.version", params: [], id: 1 }),
    verifySSL,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = r.json();
  const ver  = data.result || "?";

  let authNote = "";
  if (s.zabbix_api_token || (s.zabbix_user && s.zabbix_pass)) {
    const params = s.zabbix_api_token ? { token: s.zabbix_api_token }
                                       : { user: s.zabbix_user, password: s.zabbix_pass };
    const r2 = await rawReq(`${host}/api_jsonrpc.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "user.login", params, id: 2 }),
      verifySSL,
    });
    const d2 = r2.json();
    authNote = d2.error ? `\nAuth hatası: ${d2.error.data}` : "\nKimlik doğrulama başarılı ✓";
  }
  return { ok: true, preview: `Zabbix bağlandı ✓\nHost: ${host}\nAPI sürüm: ${ver}${authNote}` };
}

async function testElastic() {
  const s    = cfg("elastic");
  const host = (s.elastic_host || "").replace(/\/$/, "");
  if (!host) throw new Error("Elasticsearch host tanımlı değil");
  const headers = { Accept: "application/json" };
  if (s.elastic_user) {
    headers.Authorization = `Basic ${Buffer.from(`${s.elastic_user}:${s.elastic_pass || ""}`).toString("base64")}`;
  }
  const r = await rawReq(`${host}/_cluster/health`, {
    headers, verifySSL: flag(s.elastic_verify_ssl),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = r.json();
  return {
    ok: true,
    preview: `Elasticsearch bağlandı ✓\nHost: ${host}\nKlüster: ${data.cluster_name || "?"}\nDurum: ${data.status || "?"}`,
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
