// settings.js — Card-grid landing + detail panel for ALL configuration categories
import { api }   from "./api.js";
import { toast } from "./app.js";

// ─── Kategori tanımları ────────────────────────────────────────────────────────
// Her kategori için form alanları (key/label/type) bildirilir.
const CATEGORIES = [
  {
    id: "llm", icon: "AI", title: "LLM",
    desc: "Yapay zeka modeli ve sistem promptu",
    keys: [
      { key: "llm_provider", label: "Provider", type: "select", options: [
        ["ollama", "Ollama (Yerel)"],
        ["claude", "Anthropic Claude"],
        ["openai", "OpenAI-Compatible"],
      ]},
      { key: "llm_base_url", label: "Base URL", type: "url",
        placeholder: "http://host.docker.internal:11434" },
      { key: "llm_api_key", label: "API Key", type: "password", masked: true },
      { key: "llm_model", label: "Model", type: "text",
        placeholder: "qwen2.5:3b / claude-haiku-4-5 / gpt-4o-mini" },
      { key: "llm_timeout", label: "Zaman aşımı (sn)", type: "number" },
      { key: "llm_system_prompt", label: "Sistem promptu (opsiyonel)", type: "textarea",
        placeholder: "Boş bırakırsanız varsayılan Türkçe güvenlik analizi promptu kullanılır." },
    ],
  },
  {
    id: "wazuh", icon: "WZ", title: "Wazuh",
    desc: "SIEM uyarıları (Elasticsearch / OpenSearch)",
    keys: [
      { key: "wazuh_es_host", label: "Elasticsearch Host", type: "url",
        placeholder: "https://172.31.0.6:9200" },
      { key: "wazuh_es_user", label: "ES Kullanıcı", type: "text" },
      { key: "wazuh_es_pass", label: "ES Şifre", type: "password", masked: true },
      { key: "wazuh_alert_level", label: "Alert seviyesi (1-15)", type: "number" },
      { key: "wazuh_verify_ssl", label: "SSL doğrula", type: "checkbox" },
    ],
  },
  {
    id: "observium", icon: "OB", title: "Observium",
    desc: "Ağ cihazları ve port izleme (Selenium ile)",
    keys: [
      { key: "obs_host", label: "Host", type: "url",
        placeholder: "http://172.31.0.201" },
      { key: "obs_user", label: "Kullanıcı", type: "text" },
      { key: "obs_pass", label: "Şifre", type: "password", masked: true },
    ],
  },
  {
    id: "telegram", icon: "TG", title: "Telegram",
    desc: "Bot tokenı ve hedef sohbet",
    keys: [
      { key: "telegram_token", label: "Bot Token", type: "password", masked: true },
      { key: "telegram_chat_id", label: "Chat ID", type: "text" },
    ],
  },
  {
    id: "smtp", icon: "@", title: "E-posta (SMTP)",
    desc: "SMTP üzerinden e-posta bildirimi",
    keys: [
      { key: "smtp_host", label: "SMTP Host", type: "text",
        placeholder: "smtp.sirket.com" },
      { key: "smtp_port", label: "Port", type: "number",
        placeholder: "587 (STARTTLS) / 465 (SSL) / 25" },
      { key: "smtp_user", label: "Kullanıcı", type: "text" },
      { key: "smtp_pass", label: "Şifre", type: "password", masked: true },
      { key: "smtp_from", label: "Gönderen", type: "text",
        placeholder: "no-reply@sirket.com (boş = kullanıcı)" },
      { key: "smtp_to", label: "Alıcılar (virgül ile)", type: "text",
        placeholder: "soc@sirket.com, sysadmin@sirket.com" },
      { key: "smtp_tls", label: "STARTTLS kullan", type: "checkbox" },
      { key: "smtp_on_critical_only", label: "Sadece kritikte gönder", type: "checkbox" },
    ],
  },
  {
    id: "slack", icon: "SL", title: "Slack",
    desc: "Slack webhook bildirimleri",
    keys: [
      { key: "slack_webhook_url", label: "Webhook URL", type: "password", masked: true },
      { key: "slack_channel", label: "Kanal (opsiyonel)", type: "text",
        placeholder: "#security veya @kullanici" },
      { key: "slack_on_critical_only", label: "Sadece kritikte gönder", type: "checkbox" },
    ],
  },
  {
    id: "teams", icon: "TM", title: "MS Teams",
    desc: "Microsoft Teams webhook bildirimleri",
    keys: [
      { key: "teams_webhook_url", label: "Webhook URL", type: "password", masked: true },
      { key: "teams_on_critical_only", label: "Sadece kritikte gönder", type: "checkbox" },
    ],
  },
  {
    id: "graylog", icon: "GL", title: "Graylog",
    desc: "Graylog log toplama",
    keys: [
      { key: "graylog_host", label: "Host", type: "url",
        placeholder: "http://graylog:9000" },
      { key: "graylog_user", label: "Kullanıcı", type: "text" },
      { key: "graylog_pass", label: "Şifre", type: "password", masked: true },
      { key: "graylog_range_seconds", label: "Sorgu aralığı (sn)", type: "number" },
      { key: "graylog_verify_ssl", label: "SSL doğrula", type: "checkbox" },
    ],
  },
  {
    id: "fortinet", icon: "FG", title: "Fortinet",
    desc: "FortiGate REST API",
    keys: [
      { key: "fortinet_host", label: "Host", type: "url",
        placeholder: "https://10.0.0.1" },
      { key: "fortinet_auth", label: "Auth yöntemi", type: "select", options: [
        ["token",       "API Token"],
        ["credentials", "Kullanıcı + Şifre"],
      ]},
      { key: "fortinet_api_token", label: "API Token", type: "password", masked: true },
      { key: "fortinet_user", label: "Kullanıcı", type: "text" },
      { key: "fortinet_pass", label: "Şifre", type: "password", masked: true },
      { key: "fortinet_vdom", label: "VDOM", type: "text",
        placeholder: "root" },
      { key: "fortinet_verify_ssl", label: "SSL doğrula", type: "checkbox" },
      { key: "fortinet_timeout", label: "Zaman aşımı (sn)", type: "number" },
    ],
  },
  {
    id: "prometheus", icon: "PR", title: "Prometheus",
    desc: "Prometheus ve Alertmanager",
    keys: [
      { key: "prometheus_host", label: "Prometheus Host", type: "url",
        placeholder: "http://prometheus:9090" },
      { key: "alertmanager_host", label: "Alertmanager Host", type: "url",
        placeholder: "http://alertmanager:9093" },
      { key: "prometheus_user", label: "Kullanıcı (opsiyonel)", type: "text" },
      { key: "prometheus_pass", label: "Şifre (opsiyonel)", type: "password", masked: true },
      { key: "prometheus_verify_ssl", label: "SSL doğrula", type: "checkbox" },
      { key: "prometheus_timeout", label: "Zaman aşımı (sn)", type: "number" },
    ],
  },
  {
    id: "zabbix", icon: "ZB", title: "Zabbix",
    desc: "Zabbix izleme",
    keys: [
      { key: "zabbix_host", label: "Host", type: "url",
        placeholder: "https://zabbix.sirket.com" },
      { key: "zabbix_user", label: "Kullanıcı", type: "text" },
      { key: "zabbix_pass", label: "Şifre", type: "password", masked: true },
      { key: "zabbix_api_token", label: "API Token (öncelikli)", type: "password", masked: true },
      { key: "zabbix_verify_ssl", label: "SSL doğrula", type: "checkbox" },
      { key: "zabbix_timeout", label: "Zaman aşımı (sn)", type: "number" },
    ],
  },
  {
    id: "elastic", icon: "ES", title: "Elastic",
    desc: "Elasticsearch / OpenSearch log",
    keys: [
      { key: "elastic_host", label: "Host", type: "url",
        placeholder: "http://elastic:9200" },
      { key: "elastic_user", label: "Kullanıcı", type: "text" },
      { key: "elastic_pass", label: "Şifre", type: "password", masked: true },
      { key: "elastic_index", label: "Index pattern", type: "text",
        placeholder: "* veya logs-*" },
      { key: "elastic_verify_ssl", label: "SSL doğrula", type: "checkbox" },
      { key: "elastic_timeout", label: "Zaman aşımı (sn)", type: "number" },
    ],
  },
  {
    id: "genel", icon: "GN", title: "Genel",
    desc: "Genel uygulama ayarları",
    keys: [
      { key: "check_interval_minutes", label: "Otomatik rapor aralığı (dk, 1-1440)", type: "number" },
      { key: "webhook_max_store", label: "Webhook tampon boyutu", type: "number" },
    ],
  },
  {
    id: "guvenlik", icon: "SC", title: "Güvenlik",
    desc: "Admin şifresini değiştir",
    custom: true,
  },
];

// ─── Yardımcılar ──────────────────────────────────────────────────────────────
function escAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]
  ));
}

function escHtml(s) {
  return escAttr(s);
}

function isConfigured(cat, settings) {
  if (!cat.keys) return false;
  // Bu kategoride en az bir "anahtar" alan dolu mu?
  return cat.keys.some(f => {
    if (f.type === "checkbox") return false;     // checkbox tek başına "yapılandırıldı" sayılmaz
    if (f.masked) return Boolean(settings[`${f.key}_set`]);
    const v = settings[f.key];
    return v && String(v).trim() !== "";
  });
}

// ─── Ana giriş ────────────────────────────────────────────────────────────────
export async function initSettings(root) {
  let settings = {};
  try { settings = await api.getSettings(); }
  catch { settings = {}; }

  let currentCategory = null;   // null = grid görünümü

  // ── Grid view ───────────────────────────────────────────────────────────────
  function renderGrid() {
    const cards = CATEGORIES.map(cat => {
      const configured = !cat.custom && isConfigured(cat, settings);
      const badge = cat.custom
        ? ""
        : `<span class="settings-card-badge ${configured ? "configured" : "empty"}">
             ${configured ? "Aktif" : "Boş"}
           </span>`;
      return `
        <div class="settings-card" data-cat="${cat.id}" role="button" tabindex="0">
          <div class="settings-card-icon">${escHtml(cat.icon)}</div>
          <div class="settings-card-body">
            <div class="settings-card-title">${escHtml(cat.title)}</div>
            <div class="settings-card-desc">${escHtml(cat.desc)}</div>
          </div>
          ${badge}
        </div>
      `;
    }).join("");

    return `
      <div class="page-header">
        <h1 class="page-title">Ayarlar</h1>
        <p class="page-subtitle">
          Tüm yapılandırma buradan yapılır. Bir kategoriyi açmak için kart üzerine tıklayın.
        </p>
      </div>
      <div class="settings-grid">${cards}</div>
    `;
  }

  // ── Field renderer ──────────────────────────────────────────────────────────
  function renderField(f) {
    const rawVal = settings[f.key] ?? "";
    const isMasked = f.masked && Boolean(settings[`${f.key}_set`]);

    if (f.type === "checkbox") {
      const checked = rawVal === "1" || rawVal === 1 || rawVal === true;
      return `
        <div class="form-group form-group-row">
          <label class="checkbox-label">
            <input type="checkbox" name="${escAttr(f.key)}" ${checked ? "checked" : ""}>
            <span>${escHtml(f.label)}</span>
          </label>
        </div>
      `;
    }

    if (f.type === "select") {
      const opts = f.options.map(([v, l]) =>
        `<option value="${escAttr(v)}" ${rawVal === v ? "selected" : ""}>${escHtml(l)}</option>`
      ).join("");
      return `
        <div class="form-group">
          <label>${escHtml(f.label)}</label>
          <select class="form-input" name="${escAttr(f.key)}">${opts}</select>
        </div>
      `;
    }

    if (f.type === "textarea") {
      const ph = isMasked ? "•••••••• (kayıtlı — boş bırak ki değişmesin)" : (f.placeholder || "");
      return `
        <div class="form-group">
          <label>${escHtml(f.label)}</label>
          <textarea class="form-input prompt-textarea" name="${escAttr(f.key)}" rows="6"
                    placeholder="${escAttr(ph)}">${isMasked ? "" : escHtml(rawVal)}</textarea>
        </div>
      `;
    }

    const inputType =
      f.type === "password" ? "password" :
      f.type === "number"   ? "number"   :
      f.type === "url"      ? "url"      :
                              "text";
    const ph = isMasked
      ? "•••••••• (kayıtlı — boş bırak ki değişmesin)"
      : (f.placeholder || "");
    const val = isMasked ? "" : escAttr(rawVal);
    return `
      <div class="form-group">
        <label>${escHtml(f.label)}</label>
        <input class="form-input" type="${inputType}" name="${escAttr(f.key)}"
               value="${val}" placeholder="${escAttr(ph)}" autocomplete="off">
      </div>
    `;
  }

  // ── Detail view ─────────────────────────────────────────────────────────────
  function renderDetail(catId) {
    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return renderGrid();

    if (cat.custom && cat.id === "guvenlik") {
      return `
        <div class="page-header">
          <button class="btn btn-ghost btn-sm" id="back-to-grid">← Geri</button>
          <h1 class="page-title" style="display:inline-block; margin-left:12px">
            ${escHtml(cat.icon)} ${escHtml(cat.title)}
          </h1>
          <p class="page-subtitle">${escHtml(cat.desc)}</p>
        </div>
        <div class="card">
          <div class="card-body-pad">
            <form id="pwd-form" novalidate>
              <div class="form-group">
                <label>Mevcut Şifre</label>
                <input class="form-input" type="password" id="pwd-current"
                       autocomplete="current-password" required>
              </div>
              <div class="form-group">
                <label>Yeni Şifre</label>
                <input class="form-input" type="password" id="pwd-new"
                       autocomplete="new-password" required minlength="6">
              </div>
              <div class="form-group">
                <label>Yeni Şifre (Tekrar)</label>
                <input class="form-input" type="password" id="pwd-confirm"
                       autocomplete="new-password" required minlength="6">
              </div>
              <button type="submit" class="btn btn-primary">Şifreyi Değiştir</button>
            </form>
          </div>
        </div>
      `;
    }

    // LLM için Docker ağ uyarısı
    const llmNote = cat.id === "llm" ? `
      <div class="info-banner" style="margin-bottom:14px">
        <strong>Docker ağ notu:</strong> Ollama host bilgisayarda çalışıyorsa ve
        <code>host.docker.internal</code> adresi çalışmıyorsa, Base URL'yi
        <code>http://172.17.0.1:11434</code> olarak deneyin.<br>
        Docker bridge IP'nizi öğrenmek için: <code>docker network inspect bridge | grep Gateway</code>
      </div>` : "";

    // Genel için rapor zamanlama bilgisi
    const genelNote = cat.id === "genel" ? `
      <div class="info-banner" style="margin-bottom:14px">
        <strong>Raporlar ne zaman gelir?</strong><br>
        Bot başladıktan sonra her <em>Otomatik rapor aralığı</em> dakikada bir analiz yapar ve
        Telegram'a gönderir. Dashboard → "Rapor Tetikle" ile anında da tetikleyebilirsiniz.
      </div>` : "";

    // Test butonu (guvenlik ve genel kategorisi hariç)
    const hasTest = !["guvenlik", "genel"].includes(cat.id);
    const testBtn = hasTest ? `
      <button type="button" id="test-source" class="btn btn-ghost" style="margin-left:auto">
        🔌 Bağlantıyı Test Et
      </button>` : "";

    return `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%">
          <button class="btn btn-ghost btn-sm" id="back-to-grid">← Geri</button>
          <h1 class="page-title" style="display:inline-block">
            ${escHtml(cat.icon)} ${escHtml(cat.title)}
          </h1>
          <p class="page-subtitle" style="width:100%;margin:0">${escHtml(cat.desc)}</p>
        </div>
      </div>
      ${llmNote}${genelNote}
      <div class="card">
        <div class="card-body-pad">
          <form id="settings-form" novalidate>
            ${cat.keys.map(renderField).join("")}
            <div class="settings-actions">
              <button type="submit" class="btn btn-primary">Kaydet</button>
              <span id="settings-save-status" class="save-status hidden">✓ Kaydedildi</span>
              ${testBtn}
            </div>
          </form>
          <div id="test-result" class="test-result hidden"></div>
        </div>
      </div>
    `;
  }

  // ── Olay bağlayıcıları ──────────────────────────────────────────────────────
  function attachGridHandlers() {
    root.querySelectorAll(".settings-card").forEach(card => {
      const open = () => {
        currentCategory = card.dataset.cat;
        render();
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });
  }

  function attachDetailHandlers() {
    root.querySelector("#back-to-grid")?.addEventListener("click", () => {
      currentCategory = null;
      render();
    });

    // Test Et butonu
    root.querySelector("#test-source")?.addEventListener("click", async () => {
      const btn    = root.querySelector("#test-source");
      const result = root.querySelector("#test-result");
      if (!btn || !result) return;
      btn.disabled    = true;
      btn.textContent = "⏳ Test ediliyor...";
      result.className = "test-result";
      result.textContent = "";
      try {
        const data = await api.testSource(currentCategory);
        result.className = `test-result ${data.ok ? "ok" : "fail"}`;
        result.textContent = data.ok ? `✅ ${data.preview}` : `❌ ${data.error}`;
      } catch (err) {
        result.className = "test-result fail";
        result.textContent = `❌ ${err.message}`;
      } finally {
        btn.disabled    = false;
        btn.textContent = "🔌 Bağlantıyı Test Et";
      }
    });

    // Şifre değiştirme (özel form)
    const pwdForm = root.querySelector("#pwd-form");
    if (pwdForm) {
      pwdForm.addEventListener("submit", async e => {
        e.preventDefault();
        const cur  = pwdForm.querySelector("#pwd-current").value;
        const nw   = pwdForm.querySelector("#pwd-new").value;
        const conf = pwdForm.querySelector("#pwd-confirm").value;
        if (nw !== conf) {
          toast("Şifreler eşleşmiyor", "critical");
          return;
        }
        try {
          await api.changePassword(cur, nw);
          toast("Şifre başarıyla güncellendi", "success");
          pwdForm.reset();
        } catch (err) {
          toast("Hata: " + (err.message || "bilinmiyor"), "critical");
        }
      });
      return;
    }

    // Standart kategori formu
    const form = root.querySelector("#settings-form");
    if (!form) return;
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const cat = CATEGORIES.find(c => c.id === currentCategory);
      if (!cat) return;

      const data = {};
      for (const f of cat.keys) {
        const el = form.querySelector(`[name="${CSS.escape(f.key)}"]`);
        if (!el) continue;
        if (f.type === "checkbox") {
          data[f.key] = el.checked ? "1" : "0";
        } else {
          const v = (el.value ?? "").trim();
          // Maskelenmiş alan boş bırakıldıysa hiç göndermeyiz → mevcut değer korunur
          if (f.masked && v === "") continue;
          data[f.key] = v;
        }
      }

      const btn  = form.querySelector("button[type='submit']");
      const stat = root.querySelector("#settings-save-status");
      if (btn) btn.disabled = true;
      stat?.classList.add("hidden");

      try {
        await api.saveSettings(data);
        settings = await api.getSettings();   // taze veriyi al
        if (stat) {
          stat.textContent = "✓ Kaydedildi";
          stat.classList.remove("hidden", "error");
          setTimeout(() => stat.classList.add("hidden"), 2500);
        }
        toast(`${cat.title} ayarları kaydedildi`, "success");
        // Aynı detayı yeniden çiz → maskelenmiş alanların yeni durumu yansısın
        render();
      } catch (err) {
        if (stat) {
          stat.textContent = "Hata: " + (err.message || "bilinmiyor");
          stat.classList.remove("hidden");
          stat.classList.add("error");
        }
        toast("Kayıt başarısız: " + (err.message || "bilinmiyor"), "critical");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ── Render & bağla ──────────────────────────────────────────────────────────
  function render() {
    if (currentCategory) {
      root.innerHTML = renderDetail(currentCategory);
      attachDetailHandlers();
    } else {
      root.innerHTML = renderGrid();
      attachGridHandlers();
    }
  }

  render();
}
