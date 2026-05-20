// telegram.js — Telegram Mesajları sayfası
import { api }              from "./api.js";
import { toast, fmtTime, escHtml } from "./app.js";

export async function initTelegram(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Telegram Mesajları</h2>
      <button class="btn btn-secondary" id="btn-tg-refresh">Yenile</button>
    </div>

    <div class="settings-section" style="margin-bottom:20px;">
      <div class="settings-section-title">
        <span class="settings-icon">✈</span> Mesaj Gönder
      </div>
      <form id="tg-send-form" class="settings-form" novalidate>
        <div class="form-row">
          <label class="form-label" for="tg-send-content">Mesaj</label>
          <textarea class="prompt-textarea" id="tg-send-content"
            placeholder="Telegram'a göndermek istediğiniz mesajı yazın..." rows="4"></textarea>
        </div>
        <div class="settings-actions">
          <button type="submit" class="btn btn-primary" id="btn-tg-send">Gönder</button>
          <span id="tg-send-status" class="save-status hidden"></span>
        </div>
      </form>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">
        <span class="settings-icon">◈</span> Mesaj Geçmişi
      </div>
      <div id="tg-messages-wrap">
        <div class="loading">Yükleniyor…</div>
      </div>
    </div>
  `;

  async function loadMessages() {
    const wrap = container.querySelector("#tg-messages-wrap");
    try {
      const data = await api.getTelegramMessages(50);
      const rows = data.rows || [];
      if (!rows.length) {
        wrap.innerHTML = `<p class="text-muted" style="padding:16px;">Henüz mesaj yok.</p>`;
        return;
      }
      wrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:40px;">Yön</th>
              <th style="width:100px;">Tür</th>
              <th>İçerik</th>
              <th style="width:140px;">Zaman</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const dirIcon = r.direction === "out" ? "→" : "←";
              const preview = r.content ? r.content.slice(0, 100) : "";
              const hasMore = r.content && r.content.length > 100;
              const fullId  = `tg-full-${r.id}`;
              return `<tr>
                <td style="text-align:center;font-size:16px;">${escHtml(dirIcon)}</td>
                <td><span class="badge">${escHtml(r.message_type || "")}</span></td>
                <td>
                  <span id="preview-${r.id}">${escHtml(preview)}${hasMore ? "…" : ""}</span>
                  ${hasMore ? `<div id="${fullId}" style="display:none;white-space:pre-wrap;">${escHtml(r.content)}</div>
                    <button class="btn btn-ghost btn-sm" style="margin-top:4px;"
                      data-expand="${r.id}" data-full="${fullId}">Genişlet</button>` : ""}
                </td>
                <td style="font-size:12px;color:var(--text-3);">${fmtTime(r.created_at)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      `;

      // Expand buttons
      wrap.querySelectorAll("[data-expand]").forEach(btn => {
        btn.addEventListener("click", () => {
          const id      = btn.dataset.expand;
          const fullDiv = document.getElementById(btn.dataset.full);
          const prevEl  = document.getElementById(`preview-${id}`);
          if (fullDiv.style.display === "none") {
            fullDiv.style.display = "block";
            if (prevEl) prevEl.style.display = "none";
            btn.textContent = "Daralt";
          } else {
            fullDiv.style.display = "none";
            if (prevEl) prevEl.style.display = "";
            btn.textContent = "Genişlet";
          }
        });
      });
    } catch (err) {
      wrap.innerHTML = `<p class="alert alert-error">Yüklenemedi: ${escHtml(err.message)}</p>`;
    }
  }

  // Initial load
  await loadMessages();

  // Auto-refresh every 30 seconds
  const timer = setInterval(loadMessages, 30_000);

  // Refresh button
  container.querySelector("#btn-tg-refresh").addEventListener("click", loadMessages);

  // Send form
  container.querySelector("#tg-send-form").addEventListener("submit", async e => {
    e.preventDefault();
    const contentEl = container.querySelector("#tg-send-content");
    const stat      = container.querySelector("#tg-send-status");
    const btn       = container.querySelector("#btn-tg-send");
    const content   = contentEl.value.trim();
    if (!content) return;
    btn.disabled = true;
    stat.classList.add("hidden");
    try {
      await api.chatSendTelegram(content);
      contentEl.value = "";
      stat.textContent = "✓ Gönderildi";
      stat.classList.remove("hidden", "error");
      toast("Telegram mesajı gönderildi", "success");
      setTimeout(() => stat.classList.add("hidden"), 3000);
      await loadMessages();
    } catch (err) {
      stat.textContent = `Hata: ${escHtml(err.message)}`;
      stat.classList.remove("hidden");
      stat.classList.add("error");
    } finally {
      btn.disabled = false;
    }
  });

  // Cleanup: clear interval when page is left
  return () => clearInterval(timer);
}
