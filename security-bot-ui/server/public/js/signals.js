// signals.js — Sinyal geçmişi ve canlı akış
import { api }                                 from "./api.js";
import { relTime, fmtTime, sevIcon, escHtml }  from "./app.js";

let activeFilter = { severity: "", source: "" };
let currentOffset = 0;
const PAGE_SIZE = 50;

export async function initSignals(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Sinyaller</div>
        <div class="page-subtitle">Tüm alarm ve sinyal geçmişi</div>
      </div>
      <span id="total-count" class="tag">Yükleniyor…</span>
    </div>

    <div class="filter-bar">
      <div class="filter-tabs">
        <button class="filter-tab active" data-sev="">Tümü</button>
        <button class="filter-tab critical" data-sev="critical">🔴 Kritik</button>
        <button class="filter-tab warning"  data-sev="warning">🟡 Uyarı</button>
        <button class="filter-tab info"     data-sev="info">🔵 Bilgi</button>
      </div>
      <select class="filter-select" id="source-sel">
        <option value="">Tüm Kaynaklar</option>
      </select>
    </div>

    <div class="card">
      <div class="card-body">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:28px"></th>
              <th>Zaman</th>
              <th>Kaynak</th>
              <th>Önem</th>
              <th>Başlık</th>
            </tr>
          </thead>
          <tbody id="signals-tbody">
            <tr><td colspan="5"><div class="loading"><span class="spinner"></span></div></td></tr>
          </tbody>
        </table>
        <div class="pagination" id="pagination"></div>
      </div>
    </div>
  `;

  // Filtre tab tıklamaları
  el.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      el.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter.severity = tab.dataset.sev;
      currentOffset = 0;
      loadSignals(el);
    });
  });

  // Kaynak filtresi
  el.querySelector("#source-sel").addEventListener("change", e => {
    activeFilter.source = e.target.value;
    currentOffset = 0;
    loadSignals(el);
  });

  await Promise.all([loadSignals(el), populateSources(el)]);

  // SSE canlı güncelleme
  const onSignal = e => prependLive(el, e.detail);
  window.addEventListener("sse:signal", onSignal);
  return () => window.removeEventListener("sse:signal", onSignal);
}

async function populateSources(el) {
  try {
    const data = await api.getSignals({ limit: 500 });
    const sources = [...new Set((data.rows || []).map(r => r.source))].sort();
    const sel = el.querySelector("#source-sel");
    sources.forEach(src => {
      const opt = document.createElement("option");
      opt.value = src; opt.textContent = src;
      sel.appendChild(opt);
    });
  } catch { /* ignore */ }
}

async function loadSignals(el) {
  const tbody = el.querySelector("#signals-tbody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading"><span class="spinner"></span></div></td></tr>`;

  const params = { limit: PAGE_SIZE, offset: currentOffset };
  if (activeFilter.severity) params.severity = activeFilter.severity;
  if (activeFilter.source)   params.source   = activeFilter.source;

  try {
    const data = await api.getSignals(params);
    el.querySelector("#total-count").textContent = `${data.total} sinyal`;

    if (!data.rows?.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">Sinyal yok</div></div></td></tr>`;
      el.querySelector("#pagination").innerHTML = "";
      return;
    }

    tbody.innerHTML = data.rows.map(s => buildRow(s)).join("");
    tbody.querySelectorAll("tr.clickable").forEach(row => {
      row.addEventListener("click", () => toggleExpand(row));
    });

    renderPagination(el, data.total);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--critical);padding:20px">Hata: ${e.message}</td></tr>`;
  }
}

function buildRow(s) {
  return `<tr class="clickable"
    data-body="${escAttr(s.body || "")}"
    data-raw="${escAttr(s.raw  || "")}">
    <td><span class="sev-dot ${s.severity}"></span></td>
    <td style="font-family:var(--font-mono);font-size:12px;white-space:nowrap" title="${s.created_at}">${fmtTime(s.created_at)}</td>
    <td><span class="tag">${escHtml(s.source)}</span></td>
    <td><span class="sev-pill ${s.severity}">${sevIcon(s.severity)} ${s.severity}</span></td>
    <td>${escHtml(s.title)}</td>
  </tr>`;
}

function toggleExpand(row) {
  const next = row.nextElementSibling;
  if (next?.classList?.contains("expand-row")) { next.remove(); return; }

  const body = row.dataset.body || "";
  const raw  = row.dataset.raw  || "";
  let rawFmt = "";
  try { rawFmt = raw ? JSON.stringify(JSON.parse(raw), null, 2) : ""; } catch { rawFmt = raw; }

  const exp = document.createElement("tr");
  exp.className = "expand-row";
  exp.innerHTML = `<td colspan="5"><div class="expand-content">
    ${body ? `<p style="font-size:13px;color:var(--text-1);margin-bottom:8px">${escHtml(body)}</p>` : ""}
    ${rawFmt ? `<pre class="raw-json">${escHtml(rawFmt)}</pre>` : ""}
    ${!body && !rawFmt ? `<p style="color:var(--text-3);font-size:12px">Detay yok</p>` : ""}
  </div></td>`;
  row.after(exp);
}

function prependLive(el, s) {
  if (currentOffset > 0) return;
  const tbody = el.querySelector("#signals-tbody");
  if (!tbody) return;
  tbody.querySelector(".empty-state")?.closest("tr")?.remove();

  const row = document.createElement("tr");
  row.className  = "clickable new-signal";
  row.dataset.body = s.body || "";
  row.dataset.raw  = s.raw  || "";
  row.innerHTML = `
    <td><span class="sev-dot ${s.severity}"></span></td>
    <td style="font-family:var(--font-mono);font-size:12px;white-space:nowrap">${fmtTime(s.created_at || new Date().toISOString())}</td>
    <td><span class="tag">${escHtml(s.source)}</span></td>
    <td><span class="sev-pill ${s.severity}">${sevIcon(s.severity)} ${s.severity}</span></td>
    <td>${escHtml(s.title)}</td>
  `;
  row.addEventListener("click", () => toggleExpand(row));
  tbody.insertBefore(row, tbody.firstChild);
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
  pag.querySelector("#pg-prev")?.addEventListener("click", () => { currentOffset = Math.max(0, currentOffset - PAGE_SIZE); loadSignals(el); });
  pag.querySelector("#pg-next")?.addEventListener("click", () => { currentOffset += PAGE_SIZE; loadSignals(el); });
}

function escAttr(str) { return String(str).replace(/"/g, "&quot;"); }
