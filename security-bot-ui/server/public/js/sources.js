// sources.js — Bağlı veri kaynakları ve bildirim kanalları
import { api } from "./api.js";

const SOURCE_META = {
  // Veri kaynakları
  wazuh:        { icon: "🛡️",  name: "Wazuh SIEM",         desc: "Güvenlik alarmları ve ajan izleme",           group: "data" },
  observium:    { icon: "📡",  name: "Observium",            desc: "Ağ cihazı ve port izleme (Community)",        group: "data" },
  graylog:      { icon: "📋",  name: "Graylog",              desc: "Log yönetimi ve mesaj sorguları",             group: "data" },
  fortinet:     { icon: "🔥",  name: "Fortinet FortiGate",   desc: "Güvenlik duvarı, VPN ve politika istatistikleri", group: "data" },
  prometheus:   { icon: "📊",  name: "Prometheus",           desc: "Metrik alarmları (firing alerts)",            group: "data" },
  alertmanager: { icon: "🔔",  name: "Alertmanager",         desc: "Prometheus uyarı yöneticisi",                 group: "data" },
  zabbix:       { icon: "📈",  name: "Zabbix",               desc: "Altyapı izleme ve problem listesi",           group: "data" },
  elastic:      { icon: "🔍",  name: "ElasticSearch / OpenSearch", desc: "Log analizi, cluster sağlığı ve olay sorgusu", group: "data" },
  webhook:      { icon: "🔗",  name: "Generic Webhook",       desc: "HTTP POST alıcısı — Grafana, özel araçlar",  group: "data" },
  // Bildirim kanalları
  telegram:     { icon: "✈️",  name: "Telegram",              desc: "Bot mesajları ve komutlar",                  group: "notif" },
  smtp:         { icon: "📧",  name: "SMTP E-posta",           desc: "Kritik alarm e-postaları (STARTTLS/SSL)",    group: "notif" },
  slack:        { icon: "💬",  name: "Slack",                  desc: "Incoming Webhook bildirimleri",              group: "notif" },
  teams:        { icon: "🟦",  name: "Microsoft Teams",        desc: "Incoming Webhook / MessageCard bildirimleri",group: "notif" },
};

export async function initSources(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Kaynaklar</div>
        <div class="page-subtitle">Bağlı veri kaynakları ve bildirim kanalları</div>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-refresh">↺ Yenile</button>
    </div>
    <div id="sources-container">
      <div class="loading"><span class="spinner"></span> Yükleniyor…</div>
    </div>
  `;

  el.querySelector("#btn-refresh").addEventListener("click", () => loadSources(el));
  await loadSources(el);
}

async function loadSources(el) {
  const container = el.querySelector("#sources-container");
  try {
    const [srcData, statData] = await Promise.all([
      api.sources().catch(() => ({ sources: {} })),
      api.signalStats().catch(() => ({ bySource: [] })),
    ]);

    const status   = srcData.sources || {};
    const sigBySource = Object.fromEntries((statData.bySource || []).map(s => [s.source?.toLowerCase(), s.cnt]));

    const dataSources  = Object.entries(SOURCE_META).filter(([, m]) => m.group === "data").map(([k]) => k);
    const notifSources = Object.entries(SOURCE_META).filter(([, m]) => m.group === "notif").map(([k]) => k);

    container.innerHTML = `
      <div style="margin-bottom:24px">
        <div class="section-label">Veri Kaynakları</div>
        <div class="sources-grid" id="grid-data"></div>
      </div>
      <div>
        <div class="section-label">Bildirim Kanalları</div>
        <div class="sources-grid" id="grid-notif"></div>
      </div>
    `;

    renderCards(container.querySelector("#grid-data"),  dataSources,  status, sigBySource);
    renderCards(container.querySelector("#grid-notif"), notifSources, status, sigBySource);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--critical);padding:20px">Yüklenemedi: ${e.message}</div>`;
  }
}

function renderCards(grid, keys, status, sigBySource) {
  grid.innerHTML = keys.map(key => {
    const meta    = SOURCE_META[key];
    const active  = status[key] === true;
    const unknown = status[key] === undefined;
    const cls     = active ? "active" : "inactive";
    const badge   = active ? "active" : "disabled";
    const label   = active ? "Aktif" : unknown ? "Bilinmiyor" : "Devre Dışı";
    const sigs    = sigBySource[key] || 0;

    return `<div class="source-card ${cls}">
      <div class="source-card-header">
        <div class="source-name">
          <span class="source-icon">${meta.icon}</span>
          ${meta.name}
        </div>
        <span class="source-status-badge ${badge}">${label}</span>
      </div>
      <div class="source-desc">${meta.desc}</div>
      ${sigs > 0 ? `
        <div class="source-stats">
          <div class="source-stat">
            <div class="source-stat-value">${sigs}</div>
            <div class="source-stat-label">Sinyal (24s)</div>
          </div>
        </div>` : ""}
    </div>`;
  }).join("");
}
