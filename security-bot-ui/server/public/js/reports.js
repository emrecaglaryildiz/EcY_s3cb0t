// reports.js — LLM analiz raporu listesi ve görüntüleyici
import { api }                    from "./api.js";
import { fmtTime, escHtml, showModal } from "./app.js";

let currentOffset = 0;
const PAGE_SIZE   = 20;

export async function initReports(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Raporlar</div>
        <div class="page-subtitle">LLM güvenlik analiz raporları</div>
      </div>
      <span id="total-reports" class="tag">Yükleniyor…</span>
    </div>

    <div class="card">
      <div class="card-body">
        <table class="data-table">
          <thead>
            <tr>
              <th>Zaman</th>
              <th>Tür</th>
              <th>Wazuh Alarm</th>
              <th>Cihaz ↑ / ↓</th>
              <th>Durum</th>
              <th style="width:100px"></th>
            </tr>
          </thead>
          <tbody id="reports-tbody">
            <tr><td colspan="6"><div class="loading"><span class="spinner"></span></div></td></tr>
          </tbody>
        </table>
        <div class="pagination" id="pagination"></div>
      </div>
    </div>
  `;

  await loadReports(el);

  const onReport = () => loadReports(el);
  window.addEventListener("sse:report", onReport);
  return () => window.removeEventListener("sse:report", onReport);
}

async function loadReports(el) {
  const tbody = el.querySelector("#reports-tbody");
  try {
    const data = await api.getReports({ limit: PAGE_SIZE, offset: currentOffset });
    el.querySelector("#total-reports").textContent = `${data.total} rapor`;

    if (!data.rows?.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">Rapor bulunamadı</div></div></td></tr>`;
      el.querySelector("#pagination").innerHTML = "";
      return;
    }

    tbody.innerHTML = data.rows.map(r => `
      <tr>
        <td style="font-family:var(--font-mono);font-size:12px;white-space:nowrap">${fmtTime(r.created_at)}</td>
        <td><span class="tag">${escHtml(r.report_type)}</span></td>
        <td style="font-family:var(--font-mono)">${r.wazuh_alerts || 0}</td>
        <td style="font-family:var(--font-mono)">
          <span style="color:var(--success)">${r.obs_devices_up || 0}↑</span> /
          <span style="color:var(--critical)">${r.obs_devices_down || 0}↓</span>
        </td>
        <td><span class="sev-pill ${r.status === "success" ? "info" : "critical"}">${escHtml(r.status)}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm"
            data-content="${escAttr(r.content)}"
            data-time="${escAttr(r.created_at)}">
            Görüntüle
          </button>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("button[data-content]").forEach(btn => {
      btn.addEventListener("click", () => openReport(btn.dataset.content, btn.dataset.time));
    });

    renderPagination(el, data.total);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--critical);padding:20px">Hata: ${e.message}</td></tr>`;
  }
}

function openReport(content, time) {
  let rendered;
  if (window.marked) {
    // marked.js mevcutsa Markdown olarak render et
    rendered = `<div style="font-family:var(--font-ui);line-height:1.7;color:var(--text-1)">${marked.parse(content)}</div>`;
  } else {
    rendered = `<pre class="report-content">${escHtml(content)}</pre>`;
  }
  showModal(`Rapor — ${fmtTime(time)}`, rendered);
}

function renderPagination(el, total) {
  const pag   = el.querySelector("#pagination");
  const pages = Math.ceil(total / PAGE_SIZE);
  const cur   = Math.floor(currentOffset / PAGE_SIZE) + 1;
  if (pages <= 1) { pag.innerHTML = ""; return; }
  pag.innerHTML = `
    <button class="btn btn-sm btn-secondary" id="pg-prev" ${cur <= 1    ? "disabled" : ""}>← Önceki</button>
    <span>${cur} / ${pages}</span>
    <button class="btn btn-sm btn-secondary" id="pg-next" ${cur >= pages ? "disabled" : ""}>Sonraki →</button>
  `;
  pag.querySelector("#pg-prev")?.addEventListener("click", () => { currentOffset = Math.max(0, currentOffset - PAGE_SIZE); loadReports(el); });
  pag.querySelector("#pg-next")?.addEventListener("click", () => { currentOffset += PAGE_SIZE; loadReports(el); });
}

function escAttr(str) { return String(str).replace(/"/g, "&quot;"); }
