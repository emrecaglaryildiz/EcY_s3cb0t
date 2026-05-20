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
    const [srcData, statData, botData] = await Promise.all([
      api.sources().catch(() => ({ sources: {} })),
      api.signalStats().catch(() => ({ bySource: [] })),
      api.botStatus().catch(() => ({ status: "unknown" })),
    ]);

    const botOnline   = botData.status === "online";
    const status      = srcData.sources || {};
    const hasStatus   = Object.keys(status).length > 0;
    const sigBySource = Object.fromEntries((statData.bySource || []).map(s => [s.source?.toLowerCase(), s.cnt]));

    const dataSources  = Object.entries(SOURCE_META).filter(([, m]) => m.group === "data").map(([k]) => k);
    const notifSources = Object.entries(SOURCE_META).filter(([, m]) => m.group === "notif").map(([k]) => k);

    const botBanner = !botOnline
      ? `<div class="alert alert-warning" style="margin-bottom:16px">
           ⚠️ <strong>Bot bağlı değil</strong> — kaynak durumları bot heartbeat alındığında güncellenecek.
           Bot konteyneri çalışıyorsa <code>make logs-bot</code> ile kontrol edin.
         </div>`
      : "";

    container.innerHTML = `
      ${botBanner}
      <div style="margin-bottom:24px">
        <div class="section-label">Veri Kaynakları</div>
        <div class="sources-grid" id="grid-data"></div>
      </div>
      <div>
        <div class="section-label">Bildirim Kanalları</div>
        <div class="sources-grid" id="grid-notif"></div>
      </div>
    `;

    renderCards(container.querySelector("#grid-data"),  dataSources,  status, sigBySource, botOnline);
    renderCards(container.querySelector("#grid-notif"), notifSources, status, sigBySource, botOnline);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--critical);padding:20px">Yüklenemedi: ${e.message}</div>`;
  }
}

function renderCards(grid, keys, status, sigBySource, botOnline) {
  grid.innerHTML = keys.map(key => {
    const meta    = SOURCE_META[key];
    const active  = status[key] === true;
    const configured = status[key] === false;  // bot bildirdi ama devre dışı
    const unknown = status[key] === undefined;

    let cls, badge, label;
    if (active) {
      cls = "active"; badge = "active"; label = "Aktif";
    } else if (!botOnline && unknown) {
      cls = "inactive"; badge = "pending"; label = "Bot Offline";
    } else if (configured) {
      cls = "inactive"; badge = "disabled"; label = "Devre Dışı";
    } else {
      cls = "inactive"; badge = "disabled"; label = "Bilinmiyor";
    }
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
