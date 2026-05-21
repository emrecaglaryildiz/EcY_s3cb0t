// chat.js — LLM Sohbet Sayfası
import { api } from "./api.js";
import { escHtml, fmtTime } from "./app.js";

let _history = [];   // {role, content} — LLM context için

// ── Markdown renderer ─────────────────────────────────────────────
if (typeof marked !== "undefined") {
  // Custom renderer: code blocks → hljs highlighted
  const renderer = new marked.Renderer();
  renderer.code = function({ text, lang }) {
    const language = lang && typeof hljs !== "undefined" && hljs.getLanguage(lang) ? lang : null;
    try {
      const highlighted = language
        ? hljs.highlight(text, { language }).value
        : (typeof hljs !== "undefined" ? hljs.highlightAuto(text).value : escHtml(text));
      const cls = language ? ` class="language-${language}"` : "";
      return `<pre><code class="hljs${cls}">${highlighted}</code></pre>`;
    } catch {
      return `<pre><code class="hljs">${escHtml(text)}</code></pre>`;
    }
  };
  marked.use({ renderer, gfm: true, breaks: true, pedantic: false });
}

function renderMarkdown(content) {
  if (typeof marked === "undefined") return escHtml(content);
  const raw = marked.parse(content);
  if (typeof DOMPurify === "undefined") return raw;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p","br","strong","em","b","i","u","s","del",
      "h1","h2","h3","h4","h5","h6",
      "ul","ol","li","blockquote","hr",
      "pre","code","table","thead","tbody","tr","th","td",
      "a","span","div",
    ],
    ALLOWED_ATTR: ["href","class","target","rel"],
    FORCE_BODY: false,
  });
}

export async function initChat(el) {
  el.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sidebar">
        <div class="chat-sidebar-title">Sohbet</div>
        <div id="chat-provider-info" class="chat-provider-info">
          <span class="spinner" style="width:12px;height:12px"></span>
        </div>
        <div class="chat-actions">
          <button class="btn btn-ghost btn-sm btn-block" id="btn-clear-history">Geçmişi Temizle</button>
        </div>
        <div class="chat-tip">
          <p>Güvenlik analizleri, log sorguları ve altyapı konularında soru sorabilirsiniz.</p>
          <p>Telegram'a göndermek için mesajın altındaki düğmeyi kullanın.</p>
        </div>
      </div>

      <div class="chat-main">
        <div class="chat-messages" id="chat-messages">
          <div class="chat-empty" id="chat-empty">
            <span style="font-size:32px">⬟</span>
            <p>Güvenlik asistanınıza soru sorun</p>
          </div>
        </div>

        <div class="chat-input-bar">
          <textarea id="chat-input" class="chat-input" rows="1"
            placeholder="Mesajınızı yazın… (Shift+Enter yeni satır, Enter gönder)"></textarea>
          <button class="btn btn-primary" id="btn-send" title="Gönder">
            <span id="send-icon">▶</span>
            <span id="send-spinner" class="spinner hidden" style="width:14px;height:14px"></span>
          </button>
        </div>
      </div>
    </div>
  `;

  await loadProviderInfo(el);
  await loadHistory(el);
  bindEvents(el);
}

async function loadProviderInfo(el) {
  try {
    const cfg = await api.getSettings();
    const prov = cfg.llm_provider || "ollama";
    const model = cfg.llm_model || "?";
    const icons = { ollama: "🦙", claude: "◈", openai: "⚡" };
    el.querySelector("#chat-provider-info").innerHTML = `
      <span style="font-size:16px">${icons[prov] || "🤖"}</span>
      <span><strong>${prov}</strong> / ${escHtml(model)}</span>
    `;
  } catch {
    el.querySelector("#chat-provider-info").innerHTML = `<span style="color:var(--text-2)">LLM ayarları yüklenemedi</span>`;
  }
}

async function loadHistory(el) {
  try {
    const { rows } = await api.chatHistory(100);
    _history = rows.map(r => ({ role: r.role, content: r.content }));
    rows.forEach(r => appendBubble(el, r.role, r.content, r.created_at, false));
    scrollToBottom(el);
    if (rows.length > 0) el.querySelector("#chat-empty")?.remove();
  } catch { /* ilk açılışta boş */ }
}

function appendBubble(el, role, content, ts, scroll = true) {
  const wrap = el.querySelector("#chat-messages");
  const empty = wrap.querySelector("#chat-empty");
  if (empty) empty.remove();

  const div = document.createElement("div");
  div.className = `chat-bubble ${role}`;

  const bodyHtml = role === "assistant"
    ? `<div class="chat-bubble-content md">${renderMarkdown(content)}</div>`
    : `<div class="chat-bubble-content">${escHtml(content)}</div>`;

  const timeStr = ts ? fmtTime(ts) : "";
  const tgBtn   = role === "assistant"
    ? `<button class="btn btn-ghost btn-xs tg-send-btn" data-content="${escHtml(content)}" title="Telegram'a gönder">✈ Telegram</button>`
    : "";

  div.innerHTML = `
    ${bodyHtml}
    <div class="chat-bubble-meta">
      <span class="chat-bubble-time">${escHtml(timeStr)}</span>
      ${tgBtn}
    </div>
  `;

  div.querySelector(".tg-send-btn")?.addEventListener("click", async e => {
    const btn = e.currentTarget;
    const msg = btn.dataset.content;
    btn.disabled = true; btn.textContent = "Gönderiliyor…";
    try {
      await api.chatSendTelegram(msg);
      btn.textContent = "✅ Kuyruğa alındı";
    } catch (err) {
      btn.textContent = "❌ Hata";
      btn.disabled = false;
    }
  });

  wrap.appendChild(div);

  // Highlight any code blocks not already processed by the renderer
  if (role === "assistant" && typeof hljs !== "undefined") {
    div.querySelectorAll("pre code:not(.hljs)").forEach(block => {
      hljs.highlightElement(block);
    });
  }

  if (scroll) scrollToBottom(el);
}

function addTypingIndicator(el) {
  const wrap = el.querySelector("#chat-messages");
  const div  = document.createElement("div");
  div.id = "typing-indicator";
  div.className = "chat-bubble assistant typing";
  div.innerHTML = `<div class="chat-bubble-content"><span class="dots"><span></span><span></span><span></span></span></div>`;
  wrap.appendChild(div);
  scrollToBottom(el);
}

function removeTypingIndicator(el) {
  el.querySelector("#typing-indicator")?.remove();
}

function scrollToBottom(el) {
  const wrap = el.querySelector("#chat-messages");
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

async function sendMessage(el) {
  const inp  = el.querySelector("#chat-input");
  const text = inp.value.trim();
  if (!text) return;

  inp.value  = "";
  inp.style.height = "auto";

  const sendBtn     = el.querySelector("#btn-send");
  const sendIcon    = el.querySelector("#send-icon");
  const sendSpinner = el.querySelector("#send-spinner");
  sendBtn.disabled  = true;
  sendIcon.classList.add("hidden");
  sendSpinner.classList.remove("hidden");

  appendBubble(el, "user", text, new Date().toISOString());
  _history.push({ role: "user", content: text });
  addTypingIndicator(el);

  try {
    const { answer, provider, model } = await api.chatMessage(text, _history.slice(-20));
    removeTypingIndicator(el);
    _history.push({ role: "assistant", content: answer });
    appendBubble(el, "assistant", answer, new Date().toISOString());
  } catch (err) {
    removeTypingIndicator(el);
    appendBubble(el, "assistant",
      `❌ **Hata:** ${err.message}\n\nAyarlar sayfasından LLM yapılandırmasını kontrol edin.`,
      new Date().toISOString()
    );
  } finally {
    sendBtn.disabled = false;
    sendIcon.classList.remove("hidden");
    sendSpinner.classList.add("hidden");
    inp.focus();
  }
}

function bindEvents(el) {
  const inp = el.querySelector("#chat-input");

  inp.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(el);
    }
  });

  inp.addEventListener("input", () => {
    inp.style.height = "auto";
    inp.style.height = Math.min(inp.scrollHeight, 160) + "px";
  });

  el.querySelector("#btn-send").addEventListener("click", () => sendMessage(el));

  el.querySelector("#btn-clear-history").addEventListener("click", async () => {
    if (!confirm("Sohbet geçmişi silinsin mi?")) return;
    await api.chatClearHistory();
    _history = [];
    const wrap = el.querySelector("#chat-messages");
    wrap.innerHTML = `<div class="chat-empty" id="chat-empty">
      <span style="font-size:32px">⬟</span>
      <p>Güvenlik asistanınıza soru sorun</p>
    </div>`;
  });
}
