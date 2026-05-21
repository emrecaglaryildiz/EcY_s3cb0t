// app.js — SPA yönlendirme, kimlik doğrulama, SSE ve paylaşılan yardımcılar
import { api, connectSSE } from "./api.js";
import { initDashboard }   from "./dashboard.js";
import { initSignals }     from "./signals.js";
import { initReports }     from "./reports.js";
import { initSources }     from "./sources.js";
import { initChat }        from "./chat.js";
import { initSettings }    from "./settings.js";
import { initTelegram }    from "./telegram.js";

// ── Sayfa haritası ──────────────────────────────────────────────────────────
const PAGES = {
  dashboard: initDashboard,
  signals:   initSignals,
  reports:   initReports,
  sources:   initSources,
  chat:      initChat,
  telegram:  initTelegram,
  settings:  initSettings,
};

let currentPage  = null;
let cleanupFn    = null;
let sse          = null;
let newCritical  = 0;

// ── Toast bildirimleri ──────────────────────────────────────────────────────
export function toast(msg, type = "info") {
  const tc  = document.getElementById("toast-container");
  const el  = document.createElement("div");
  const icon = type === "critical" ? "🔴" : type === "success" ? "✅" : "🔵";
  el.className = `toast ${type}`;
  el.textContent = `${icon}  ${msg}`;
  tc.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ── Global modal ────────────────────────────────────────────────────────────
export function showModal(title, bodyHtml) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  document.getElementById("modal-overlay").classList.remove("hidden");
}

// ── Tarih/saat yardımcıları ──────────────────────────────────────────────────
export function relTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts.endsWith("Z") ? ts : ts + "Z").getTime();
  const s = Math.floor(diff / 1000);
  if (s <    60) return `${s}s önce`;
  if (s <  3600) return `${Math.floor(s / 60)}d önce`;
  if (s < 86400) return `${Math.floor(s / 3600)}s önce`;
  return `${Math.floor(s / 86400)}g önce`;
}

export function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts.endsWith("Z") ? ts : ts + "Z");
  return d.toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function sevIcon(sev) {
  return sev === "critical" ? "🔴" : sev === "warning" ? "🟡" : "🔵";
}

export function escHtml(str) {
  return String(str).replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// ── Bot durumu ───────────────────────────────────────────────────────────────
function updateBotStatus(status) {
  const dot   = document.getElementById("bot-dot");
  const label = document.getElementById("bot-label");
  if (!dot || !label) return;
  dot.className     = `status-dot ${status}`;
  label.textContent = status === "online" ? "Online" : status === "offline" ? "Offline" : "Bot";
}

async function pollBotStatus() {
  try {
    const s = await api.botStatus();
    updateBotStatus(s.status);
  } catch { /* ignore */ }
}

// ── SSE bağlantısı ───────────────────────────────────────────────────────────
function startSSE() {
  if (sse) { sse.close(); sse = null; }
  sse = connectSSE({
    signal: data => {
      if (currentPage !== "signals" && data.severity === "critical") {
        newCritical++;
        const b = document.getElementById("nav-badge-signals");
        if (b) { b.textContent = newCritical; b.classList.remove("hidden"); }
        toast(`Kritik sinyal: ${data.title}`, "critical");
      }
      window.dispatchEvent(new CustomEvent("sse:signal", { detail: data }));
    },
    report: data => {
      window.dispatchEvent(new CustomEvent("sse:report", { detail: data }));
      if (currentPage === "dashboard") toast("Yeni rapor hazır!", "success");
    },
    heartbeat: data => {
      updateBotStatus(data.status || "online");
    },
  });
}

// ── Yönlendirme ──────────────────────────────────────────────────────────────
function navigate(page) {
  if (!PAGES[page]) page = "dashboard";
  if (currentPage === page) return;

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  document.getElementById(`page-${page}`).classList.add("active");
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add("active");

  if (typeof cleanupFn === "function") cleanupFn();
  cleanupFn    = null;
  currentPage  = page;

  if (page === "signals") {
    newCritical = 0;
    const b = document.getElementById("nav-badge-signals");
    if (b) b.classList.add("hidden");
  }

  const result = PAGES[page](document.getElementById(`page-${page}`));
  if (result?.then) result.then(fn => { cleanupFn = fn || null; });
  else cleanupFn = result || null;
}

// ── Kimlik doğrulama ─────────────────────────────────────────────────────────
async function tryLogin(username, password) {
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  try {
    await api.login(username, password);
    showApp();
  } catch (err) {
    errEl.textContent = err.message || "Giriş başarısız";
    errEl.classList.remove("hidden");
  }
}

function showApp() {
  document.getElementById("login-overlay").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  startSSE();
  pollBotStatus();
  setInterval(pollBotStatus, 30_000);
  navigate(location.hash.slice(1) || "dashboard");
}

// ── Başlatma ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Modal kapat
  document.getElementById("modal-close").addEventListener("click", () =>
    document.getElementById("modal-overlay").classList.add("hidden")
  );
  document.getElementById("modal-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("modal-overlay"))
      document.getElementById("modal-overlay").classList.add("hidden");
  });

  // Login formu
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    await tryLogin(
      document.getElementById("inp-username").value.trim(),
      document.getElementById("inp-password").value
    );
  });

  // Çıkış
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await api.logout().catch(() => {});
    location.reload();
  });

  // Hash navigasyonu
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "dashboard"));

  // Nav tıklama
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", e => {
      e.preventDefault();
      location.hash = item.dataset.page;
    });
  });

  // Oturum kontrolü
  api.me().then(showApp).catch(() => {
    document.getElementById("login-overlay").classList.remove("hidden");
  });
});
