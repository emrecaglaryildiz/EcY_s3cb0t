// sources.js — Bağlı veri kaynakları ve bildirim kanalları
import { api } from "./api.js";
import { showModal, escHtml, relTime, fmtTime, sevIcon } from "./app.js";

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

const SEV_COLOR = {
  critical: "var(--critical)",
  warning:  "var(--warning)",
  info:     "var(--info)",
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
    const configured = status[key] === false;
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
    const sigs = sigBySource[key] || 0;

    return `<div class="source-card ${cls}" data-key="${key}" style="cursor:pointer">
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
      <div class="source-card-footer">Son 50 sinyali gör →</div>
    </div>`;
  }).join("");

  grid.addEventListener("click", e => {
    const card = e.target.closest(".source-card[data-key]");
    if (!card) return;
    openSignalPanel(card.dataset.key);
  });
}

async function openSignalPanel(key) {
  const meta = SOURCE_META[key];
  const title = `${meta.icon} ${meta.name} — Son Sinyaller`;

  // Yükleniyor durumu
  showModal(title, `<div class="loading" style="padding:40px 0"><span class="spinner"></span> Yükleniyor…</div>`);

  try {
    const data = await api.getSignals({ source: key, limit: 50 });
    const rows = data.rows || [];

    if (!rows.length) {
      document.getElementById("modal-body").innerHTML = `
        <div class="empty-state" style="padding:60px 0">
          <div class="empty-icon">📭</div>
          <div class="empty-text">Bu kaynak için henüz sinyal kaydı yok</div>
        </div>`;
      return;
    }

    document.getElementById("modal-body").innerHTML = `
      <div style="margin-bottom:12px;font-size:12px;color:var(--text-2)">
        ${rows.length} sinyal — en yeni üstte
      </div>
      <table class="data-table signal-modal-table">
        <thead>
          <tr>
            <th style="width:36px"></th>
            <th>Başlık</th>
            <th style="width:130px">Zaman</th>
            <th style="width:70px">Durum</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(s => signalRow(s)).join("")}
        </tbody>
      </table>`;
  } catch (e) {
    document.getElementById("modal-body").innerHTML =
      `<div style="color:var(--critical);padding:20px">Yüklenemedi: ${escHtml(e.message)}</div>`;
  }
}

function signalRow(s) {
  const color = SEV_COLOR[s.severity] || "var(--text-2)";
  const bodyPreview = s.body && s.body !== s.title
    ? `<div style="font-size:11px;color:var(--text-3);margin-top:3px;white-space:pre-wrap;max-height:48px;overflow:hidden">${escHtml(s.body.slice(0, 200))}</div>`
    : "";
  const ackBadge = s.ack
    ? `<span style="font-size:10px;color:var(--success);font-weight:600">ACK</span>`
    : "";
  return `<tr>
    <td><span class="sev-dot ${s.severity}" title="${escHtml(s.severity)}"></span></td>
    <td>
      <div style="font-weight:500;color:var(--text-0)">${escHtml(s.title)}</div>
      ${bodyPreview}
    </td>
    <td style="font-size:11px;color:var(--text-2);white-space:nowrap">
      <div title="${escHtml(s.created_at)}">${relTime(s.created_at)}</div>
      <div style="color:var(--text-3)">${fmtTime(s.created_at)}</div>
    </td>
    <td>${ackBadge}</td>
  </tr>`;
}
