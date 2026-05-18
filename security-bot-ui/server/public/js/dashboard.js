// dashboard.js — Ana dashboard sayfası
import { api }                             from "./api.js";
import { relTime, fmtTime, escHtml, toast } from "./app.js";

let trendChart      = null;
let refreshTimer    = null;

export async function initDashboard(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Güvenlik durumu genel bakış</div>
      </div>
      <button class="btn btn-trigger" id="btn-trigger">⚡ Rapor Üret</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card" id="sc-bot">
        <div class="stat-label">Bot Durumu</div>
        <div class="stat-value" id="sv-bot">—</div>
        <div class="stat-sub"  id="ss-bot">Son heartbeat</div>
      </div>
      <div class="stat-card critical">
        <div class="stat-label">Kritik (24s)</div>
        <div class="stat-value" id="sv-crit">—</div>
        <div class="stat-sub">kritik sinyal</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">Uyarı (24s)</div>
        <div class="stat-value" id="sv-warn">—</div>
        <div class="stat-sub">uyarı sinyali</div>
      </div>
      <div class="stat-card info">
        <div class="stat-label">Raporlar (24s)</div>
        <div class="stat-value" id="sv-rpts">—</div>
        <div class="stat-sub">analiz raporu</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-header">
          <span class="card-title">⚡ Canlı Sinyal Akışı</span>
          <span class="tag" style="color:var(--success)">● Canlı</span>
        </div>
        <div class="card-body">
          <div class="signal-feed" id="signal-feed">
            <div class="loading"><span class="spinner"></span> Yükleniyor…</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">📊 7 Günlük Trend</span>
        </div>
        <div class="card-body">
          <div class="chart-container">
            <canvas id="trend-chart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">📋 Son Rapor</span>
        <a href="#reports" class="btn btn-ghost btn-sm">Tümünü Gör →</a>
      </div>
      <div class="card-body-pad" id="last-report-box">
        <div class="loading"><span class="spinner"></span> Yükleniyor…</div>
      </div>
    </div>
  `;

  // Trigger butonu
  el.querySelector("#btn-trigger").addEventListener("click", async () => {
    const btn = el.querySelector("#btn-trigger");
    btn.disabled    = true;
    btn.textContent = "⏳ Gönderildi…";
    try {
      await api.triggerReport();
      toast("Rapor isteği gönderildi — bot en geç 60s içinde çalıştıracak", "success");
    } catch (e) {
      toast(`Hata: ${e.message}`, "critical");
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = "⚡ Rapor Üret"; }, 8000);
    }
  });

  await loadDashboard(el);

  // SSE dinleyicileri
  const onSignal = e => prependSignal(el, e.detail);
  const onReport = () => loadLastReport(el);
  window.addEventListener("sse:signal", onSignal);
  window.addEventListener("sse:report", onReport);

  // Zaman damgası yenileme
  refreshTimer = setInterval(() => refreshTimestamps(el), 60_000);

  return () => {
    window.removeEventListener("sse:signal", onSignal);
    window.removeEventListener("sse:report", onReport);
    clearInterval(refreshTimer);
    if (trendChart) { trendChart.destroy(); trendChart = null; }
  };
}

async function loadDashboard(el) {
  try {
    const [dash, signals] = await Promise.all([
      api.dashboard(),
      api.getSignals({ limit: 20 }),
    ]);

    // İstatistik kartları
    const sc = dash.signal_counts || {};
    el.querySelector("#sv-crit").textContent = sc.critical || 0;
    el.querySelector("#sv-warn").textContent = sc.warning  || 0;
    el.querySelector("#sv-rpts").textContent = dash.report_count_24h || 0;

    const bs     = dash.bot_status;
    const online = bs?.last_seen && (Date.now() - new Date(bs.last_seen + "Z").getTime()) < 90_000;
    const botVal = el.querySelector("#sv-bot");
    botVal.textContent   = online ? "Online" : "Offline";
    botVal.style.color   = online ? "var(--success)" : "var(--critical)";
    el.querySelector("#ss-bot").textContent = bs?.last_seen ? `${relTime(bs.last_seen)} görüldü` : "Henüz görülmedi";

    renderFeed(el, signals.rows || []);
    loadTrendChart(el);
    loadLastReport(el);
  } catch (e) {
    console.error("Dashboard yükleme hatası:", e);
  }
}

function renderFeed(el, signals) {
  const feed = el.querySelector("#signal-feed");
  if (!signals.length) {
    feed.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">Sinyal yok</div></div>`;
    return;
  }
  feed.innerHTML = signals.map(s => signalRow(s)).join("");
}

function signalRow(s) {
  return `<div class="signal-item">
    <span class="sev-dot ${s.severity}"></span>
    <span class="signal-source">${escHtml(s.source)}</span>
    <span class="signal-title">${escHtml(s.title)}</span>
    <span class="signal-time" data-ts="${s.created_at}">${relTime(s.created_at)}</span>
  </div>`;
}

function prependSignal(el, s) {
  const feed = el.querySelector("#signal-feed");
  if (!feed) return;
  feed.querySelector(".empty-state")?.remove();

  const row = document.createElement("div");
  row.innerHTML = signalRow(s);
  const item = row.firstElementChild;
  item.classList.add("new-signal");
  feed.insertBefore(item, feed.firstChild);
  while (feed.children.length > 20) feed.lastChild.remove();
}

function refreshTimestamps(el) {
  el.querySelectorAll("[data-ts]").forEach(span => {
    span.textContent = relTime(span.dataset.ts);
  });
}

async function loadLastReport(el) {
  const box = el.querySelector("#last-report-box");
  if (!box) return;
  try {
    const r = await api.latestReport();
    if (!r) { box.innerHTML = `<div class="empty-state"><div class="empty-text">Henüz rapor yok</div></div>`; return; }
    const preview = r.content.slice(0, 700) + (r.content.length > 700 ? "…" : "");
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span class="tag">${r.report_type}</span>
        <span style="font-size:11px;color:var(--text-2)">${fmtTime(r.created_at)}</span>
      </div>
      <div class="report-content">${escHtml(preview)}</div>
    `;
  } catch { /* ignore */ }
}

async function loadTrendChart(el) {
  const ctx = el.querySelector("#trend-chart");
  if (!ctx || !window.Chart) return;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }

  // Son 7 günü tek sorguyla al
  const since7 = days[0] + "T00:00:00";
  try {
    const data = await api.getSignals({ since: since7, limit: 1000 });
    const rows = data.rows || [];

    const critical = days.map(d => rows.filter(r => r.created_at?.startsWith(d) && r.severity === "critical").length);
    const warning  = days.map(d => rows.filter(r => r.created_at?.startsWith(d) && r.severity === "warning").length);
    const info     = days.map(d => rows.filter(r => r.created_at?.startsWith(d) && r.severity === "info").length);

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels:   days.map(d => d.slice(5)),
        datasets: [
          { label: "Kritik", data: critical, backgroundColor: "rgba(248,81,73,.75)",  borderRadius: 3 },
          { label: "Uyarı",  data: warning,  backgroundColor: "rgba(210,153,34,.75)", borderRadius: 3 },
          { label: "Bilgi",  data: info,     backgroundColor: "rgba(56,139,253,.5)",  borderRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8b949e", font: { size: 11 } } } },
        scales: {
          x: { stacked: true, grid: { color: "#21262d" }, ticks: { color: "#8b949e" } },
          y: { stacked: true, grid: { color: "#21262d" }, ticks: { color: "#8b949e", stepSize: 1 } },
        },
      },
    });
  } catch { /* ignore */ }
}
