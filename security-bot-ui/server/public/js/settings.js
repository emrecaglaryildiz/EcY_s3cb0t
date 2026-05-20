// settings.js — Tabbed settings page
import { api }   from "./api.js";
import { toast } from "./app.js";

const PROVIDERS = {
  ollama: {
    label:     "Ollama (Yerel LLM)",
    showUrl:   true,
    showKey:   false,
    urlLabel:  "Ollama Sunucu URL",
    urlHint:   "Örn: http://localhost:11434",
    modelHint: "Örn: qwen2.5:3b, llama3.2, mistral",
  },
  claude: {
    label:     "Anthropic Claude",
    showUrl:   false,
    showKey:   true,
    urlLabel:  "",
    urlHint:   "",
    modelHint: "Örn: claude-haiku-4-5-20251001, claude-sonnet-4-6",
  },
  openai: {
    label:     "OpenAI-Compatible (OpenAI, LM Studio, vLLM…)",
    showUrl:   true,
    showKey:   true,
    urlLabel:  "API Base URL",
    urlHint:   "Örn: https://api.openai.com/v1  veya  http://localhost:1234/v1",
    modelHint: "Örn: gpt-4o-mini, local-model",
  },
};

export async function initSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Ayarlar</h2>
    </div>

    <div class="settings-tabs">
      <button class="settings-tab-btn active" data-tab="llm">LLM</button>
      <button class="settings-tab-btn" data-tab="wazuh">Wazuh</button>
      <button class="settings-tab-btn" data-tab="observium">Observium</button>
      <button class="settings-tab-btn" data-tab="telegram">Telegram</button>
      <button class="settings-tab-btn" data-tab="guvenlik">Güvenlik</button>
    </div>

    <!-- ── LLM Tab ─────────────────────────────────────────────────────── -->
    <div class="settings-tab-content active" data-tab-content="llm">
      <div class="settings-section">
        <div class="settings-section-title">
          <span class="settings-icon">◈</span> LLM Yapılandırması
        </div>
        <p class="settings-desc">
          Güvenlik raporları üretmek için kullanılacak yapay zeka modelini seçin.
          Yerel LLM'ler için Ollama veya OpenAI-Compatible tercih edin.
        </p>

        <form id="llm-form" class="settings-form" novalidate>

          <div class="form-row">
            <label class="form-label" for="s-provider">Provider</label>
            <select class="form-select" id="s-provider" name="llm_provider">
              ${Object.entries(PROVIDERS).map(([v, p]) =>
                `<option value="${v}">${p.label}</option>`
              ).join("")}
            </select>
          </div>

          <div class="form-row" id="row-url">
            <label class="form-label" id="url-label" for="s-url">Sunucu URL</label>
            <input class="form-input" type="url" id="s-url" name="llm_base_url" autocomplete="off">
            <span class="form-hint" id="url-hint"></span>
          </div>

          <div class="form-row">
            <label class="form-label" for="s-model">Model Adı</label>
            <input class="form-input" type="text" id="s-model" name="llm_model" autocomplete="off">
            <span class="form-hint" id="model-hint"></span>
          </div>

          <div class="form-row" id="row-key">
            <label class="form-label" for="s-key">API Key</label>
            <div class="api-key-wrap">
              <input class="form-input" type="password" id="s-key" name="llm_api_key"
                     autocomplete="new-password" placeholder="Değiştirmek için girin">
              <button type="button" class="btn-eye" id="btn-show-key" title="Göster/Gizle">◎</button>
            </div>
            <span class="form-hint" id="key-hint">Boş bırakırsanız mevcut değer korunur.</span>
          </div>

          <div class="form-row">
            <label class="form-label" for="s-timeout">Zaman Aşımı (sn)</label>
            <input class="form-input form-input-sm" type="number" id="s-timeout"
                   name="llm_timeout" min="10" max="300" value="60">
            <span class="form-hint">LLM'den yanıt bekleme süresi.</span>
          </div>

          <div class="form-row">
            <label class="form-label" for="s-prompt">Sistem Promptu <span style="color:var(--text-3)">(opsiyonel)</span></label>
            <textarea class="prompt-textarea" id="s-prompt" name="llm_system_prompt"
              placeholder="Boş bırakırsanız varsayılan Türkçe güvenlik analizi promptu kullanılır."></textarea>
            <div class="prompt-chars"><span id="prompt-chars">0</span> karakter</div>
            <span class="form-hint">LLM'e verilecek rol ve talimatları özelleştirin.</span>
          </div>

          <div class="settings-actions">
            <button type="submit" class="btn btn-primary" id="btn-save-llm">Kaydet</button>
            <span id="save-status-llm" class="save-status hidden">✓ Kaydedildi</span>
          </div>

        </form>
      </div>
    </div>

    <!-- ── Wazuh Tab ───────────────────────────────────────────────────── -->
    <div class="settings-tab-content" data-tab-content="wazuh">
      <div class="settings-section">
        <div class="settings-section-title">
          <span class="settings-icon">◈</span> Wazuh Yapılandırması
        </div>
        <form id="wazuh-form" class="settings-form" novalidate>

          <div class="form-row">
            <label class="form-label" for="wazuh-host">Wazuh Host</label>
            <input class="form-input" type="text" id="wazuh-host" name="wazuh_host"
                   placeholder="https://wazuh-server:55000" autocomplete="off">
          </div>

          <div class="form-row">
            <label class="form-label" for="wazuh-user">Kullanıcı Adı</label>
            <input class="form-input" type="text" id="wazuh-user" name="wazuh_user" autocomplete="off">
          </div>

          <div class="form-row">
            <label class="form-label" for="wazuh-pass">Şifre</label>
            <div class="api-key-wrap">
              <input class="form-input" type="password" id="wazuh-pass" name="wazuh_pass"
                     autocomplete="new-password" placeholder="Değiştirmek için girin">
              <button type="button" class="btn-eye" data-target="wazuh-pass" title="Göster/Gizle">◎</button>
            </div>
            <span class="form-hint" id="wazuh-pass-hint">Boş bırakırsanız mevcut değer korunur.</span>
          </div>

          <div class="form-row">
            <label class="form-label" for="wazuh-alert-level">Alert Seviyesi (1-15)</label>
            <input class="form-input form-input-sm" type="number" id="wazuh-alert-level"
                   name="wazuh_alert_level" min="1" max="15" value="7">
            <span class="form-hint">Bu seviyenin üzerindeki alertler raporlanır.</span>
          </div>

          <div class="form-row">
            <label class="form-label" for="wazuh-verify-ssl">SSL Doğrulama</label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="wazuh-verify-ssl" name="wazuh_verify_ssl" value="1">
              <span>SSL sertifikasını doğrula</span>
            </label>
          </div>

          <div class="form-row">
            <label class="form-label" for="wazuh-backend">Backend</label>
            <select class="form-select" id="wazuh-backend" name="wazuh_backend">
              <option value="api">API (Wazuh REST API)</option>
              <option value="elasticsearch">Elasticsearch / OpenSearch</option>
            </select>
          </div>

          <div id="wazuh-es-fields">
            <div class="form-row">
              <label class="form-label" for="wazuh-es-host">Elasticsearch Host</label>
              <input class="form-input" type="text" id="wazuh-es-host" name="wazuh_es_host"
                     placeholder="https://172.31.0.6:9200" autocomplete="off">
            </div>

            <div class="form-row">
              <label class="form-label" for="wazuh-es-user">ES Kullanıcı</label>
              <input class="form-input" type="text" id="wazuh-es-user" name="wazuh_es_user" autocomplete="off">
            </div>

            <div class="form-row">
              <label class="form-label" for="wazuh-es-pass">ES Şifre</label>
              <div class="api-key-wrap">
                <input class="form-input" type="password" id="wazuh-es-pass" name="wazuh_es_pass"
                       autocomplete="new-password" placeholder="Değiştirmek için girin">
                <button type="button" class="btn-eye" data-target="wazuh-es-pass" title="Göster/Gizle">◎</button>
              </div>
              <span class="form-hint" id="wazuh-es-pass-hint">Boş bırakırsanız mevcut değer korunur.</span>
            </div>
          </div>

          <div class="settings-actions">
            <button type="submit" class="btn btn-primary" id="btn-save-wazuh">Kaydet</button>
            <span id="save-status-wazuh" class="save-status hidden">✓ Kaydedildi</span>
          </div>

        </form>
      </div>
    </div>

    <!-- ── Observium Tab ───────────────────────────────────────────────── -->
    <div class="settings-tab-content" data-tab-content="observium">
      <div class="settings-section">
        <div class="settings-section-title">
          <span class="settings-icon">◈</span> Observium Yapılandırması
        </div>
        <form id="obs-form" class="settings-form" novalidate>

          <div class="form-row">
            <label class="form-label" for="obs-host">Observium Host</label>
            <input class="form-input" type="text" id="obs-host" name="obs_host"
                   placeholder="http://observium" autocomplete="off">
          </div>

          <div class="form-row">
            <label class="form-label" for="obs-user">Kullanıcı Adı</label>
            <input class="form-input" type="text" id="obs-user" name="obs_user" autocomplete="off">
          </div>

          <div class="form-row">
            <label class="form-label" for="obs-pass">Şifre</label>
            <div class="api-key-wrap">
              <input class="form-input" type="password" id="obs-pass" name="obs_pass"
                     autocomplete="new-password" placeholder="Değiştirmek için girin">
              <button type="button" class="btn-eye" data-target="obs-pass" title="Göster/Gizle">◎</button>
            </div>
            <span class="form-hint" id="obs-pass-hint">Boş bırakırsanız mevcut değer korunur.</span>
          </div>

          <div class="form-row">
            <label class="form-label" for="obs-backend">Backend</label>
            <select class="form-select" id="obs-backend" name="obs_backend">
              <option value="requests">Requests (HTTP API)</option>
              <option value="selenium">Selenium (Tarayıcı)</option>
            </select>
          </div>

          <div class="settings-actions">
            <button type="submit" class="btn btn-primary" id="btn-save-obs">Kaydet</button>
            <span id="save-status-obs" class="save-status hidden">✓ Kaydedildi</span>
          </div>

        </form>
      </div>
    </div>

    <!-- ── Telegram Tab ────────────────────────────────────────────────── -->
    <div class="settings-tab-content" data-tab-content="telegram">
      <div class="settings-section">
        <div class="settings-section-title">
          <span class="settings-icon">◈</span> Telegram Yapılandırması
        </div>
        <form id="tg-form" class="settings-form" novalidate>

          <div class="form-row">
            <label class="form-label" for="tg-token">Bot Token</label>
            <div class="api-key-wrap">
              <input class="form-input" type="password" id="tg-token" name="telegram_token"
                     autocomplete="new-password" placeholder="Değiştirmek için girin">
              <button type="button" class="btn-eye" data-target="tg-token" title="Göster/Gizle">◎</button>
            </div>
            <span class="form-hint" id="tg-token-hint">Boş bırakırsanız mevcut değer korunur.</span>
          </div>

          <div class="form-row">
            <label class="form-label" for="tg-chat-id">Chat ID</label>
            <input class="form-input" type="text" id="tg-chat-id" name="telegram_chat_id" autocomplete="off">
            <span class="form-hint">Mesajların gönderileceği Telegram chat ID'si.</span>
          </div>

          <div class="settings-actions">
            <button type="submit" class="btn btn-primary" id="btn-save-tg">Kaydet</button>
            <span id="save-status-tg" class="save-status hidden">✓ Kaydedildi</span>
          </div>

        </form>
      </div>
    </div>

    <!-- ── Güvenlik Tab ────────────────────────────────────────────────── -->
    <div class="settings-tab-content" data-tab-content="guvenlik">
      <div class="settings-section">
        <div class="settings-section-title">
          <span class="settings-icon">⬡</span> Şifre Değiştir
        </div>
        <form id="pw-form" class="settings-form" novalidate>
          <div class="form-row">
            <label class="form-label" for="pw-current">Mevcut Şifre</label>
            <input class="form-input" type="password" id="pw-current" autocomplete="current-password">
          </div>
          <div class="form-row">
            <label class="form-label" for="pw-new">Yeni Şifre</label>
            <input class="form-input" type="password" id="pw-new" autocomplete="new-password">
          </div>
          <div class="form-row">
            <label class="form-label" for="pw-confirm">Tekrar</label>
            <input class="form-input" type="password" id="pw-confirm" autocomplete="new-password">
          </div>
          <div class="settings-actions">
            <button type="submit" class="btn btn-primary">Şifreyi Güncelle</button>
            <span id="pw-status" class="save-status hidden"></span>
          </div>
        </form>
      </div>
    </div>
  `;

  // ── Tab switching ──────────────────────────────────────────────────────────
  container.querySelectorAll(".settings-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      container.querySelectorAll(".settings-tab-btn").forEach(b => b.classList.remove("active"));
      container.querySelectorAll(".settings-tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      container.querySelector(`[data-tab-content="${tab}"]`).classList.add("active");
    });
  });

  // ── Eye toggle helper ──────────────────────────────────────────────────────
  container.querySelectorAll(".btn-eye[data-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      const inp = container.querySelector(`#${btn.dataset.target}`);
      if (inp) inp.type = inp.type === "password" ? "text" : "password";
    });
  });

  // ── LLM tab setup ──────────────────────────────────────────────────────────
  const providerEl = container.querySelector("#s-provider");
  const urlRow     = container.querySelector("#row-url");
  const keyRow     = container.querySelector("#row-key");
  const urlLabel   = container.querySelector("#url-label");
  const urlHint    = container.querySelector("#url-hint");
  const modelHint  = container.querySelector("#model-hint");
  const urlEl      = container.querySelector("#s-url");
  const modelEl    = container.querySelector("#s-model");
  const keyEl      = container.querySelector("#s-key");
  const timeoutEl  = container.querySelector("#s-timeout");
  const promptEl   = container.querySelector("#s-prompt");
  const charsEl    = container.querySelector("#prompt-chars");
  const saveStatusLlm = container.querySelector("#save-status-llm");

  promptEl.addEventListener("input", () => { charsEl.textContent = promptEl.value.length; });

  function applyProviderUI(prov) {
    const p = PROVIDERS[prov] || PROVIDERS.ollama;
    urlRow.classList.toggle("hidden", !p.showUrl);
    keyRow.classList.toggle("hidden", !p.showKey);
    urlLabel.textContent  = p.urlLabel;
    urlHint.textContent   = p.urlHint;
    modelHint.textContent = p.modelHint;
  }

  providerEl.addEventListener("change", () => applyProviderUI(providerEl.value));

  // ── Wazuh backend toggle ───────────────────────────────────────────────────
  const wazuhBackendEl = container.querySelector("#wazuh-backend");
  const wazuhEsFields  = container.querySelector("#wazuh-es-fields");

  function applyWazuhBackend(backend) {
    wazuhEsFields.style.display = backend === "elasticsearch" ? "" : "none";
  }

  wazuhBackendEl.addEventListener("change", () => applyWazuhBackend(wazuhBackendEl.value));

  // ── Load current settings ──────────────────────────────────────────────────
  try {
    const s = await api.getSettings();

    // LLM
    providerEl.value  = s.llm_provider    || "ollama";
    urlEl.value       = s.llm_base_url    || "";
    modelEl.value     = s.llm_model       || "";
    timeoutEl.value   = s.llm_timeout     || "60";
    promptEl.value    = s.llm_system_prompt || "";
    charsEl.textContent = promptEl.value.length;
    if (s.llm_api_key_set) {
      container.querySelector("#key-hint").textContent = "API key kayıtlı. Değiştirmek için yeni değer girin.";
    }
    applyProviderUI(providerEl.value);

    // Wazuh
    container.querySelector("#wazuh-host").value        = s.wazuh_host        || "";
    container.querySelector("#wazuh-user").value        = s.wazuh_user        || "";
    container.querySelector("#wazuh-alert-level").value = s.wazuh_alert_level || "7";
    container.querySelector("#wazuh-verify-ssl").checked = s.wazuh_verify_ssl === "1";
    container.querySelector("#wazuh-backend").value     = s.wazuh_backend     || "api";
    container.querySelector("#wazuh-es-host").value     = s.wazuh_es_host     || "";
    container.querySelector("#wazuh-es-user").value     = s.wazuh_es_user     || "";
    if (s.wazuh_pass_set) {
      container.querySelector("#wazuh-pass-hint").textContent = "Şifre kayıtlı. Değiştirmek için yeni değer girin.";
    }
    if (s.wazuh_es_pass_set) {
      container.querySelector("#wazuh-es-pass-hint").textContent = "ES şifre kayıtlı. Değiştirmek için yeni değer girin.";
    }
    applyWazuhBackend(s.wazuh_backend || "api");

    // Observium
    container.querySelector("#obs-host").value    = s.obs_host    || "";
    container.querySelector("#obs-user").value    = s.obs_user    || "";
    container.querySelector("#obs-backend").value = s.obs_backend || "requests";
    if (s.obs_pass_set) {
      container.querySelector("#obs-pass-hint").textContent = "Şifre kayıtlı. Değiştirmek için yeni değer girin.";
    }

    // Telegram
    container.querySelector("#tg-chat-id").value = s.telegram_chat_id || "";
    if (s.telegram_token_set) {
      container.querySelector("#tg-token-hint").textContent = "Token kayıtlı. Değiştirmek için yeni değer girin.";
    }

  } catch {
    applyProviderUI("ollama");
    applyWazuhBackend("api");
  }

  // ── API key göster/gizle (LLM tab) ────────────────────────────────────────
  container.querySelector("#btn-show-key").addEventListener("click", () => {
    keyEl.type = keyEl.type === "password" ? "text" : "password";
  });

  // ── LLM form submit ────────────────────────────────────────────────────────
  container.querySelector("#llm-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = container.querySelector("#btn-save-llm");
    btn.disabled = true;
    saveStatusLlm.classList.add("hidden");
    try {
      await api.saveSettings({
        llm_provider:      providerEl.value,
        llm_base_url:      urlEl.value.trim(),
        llm_model:         modelEl.value.trim(),
        llm_api_key:       keyEl.value,
        llm_timeout:       timeoutEl.value,
        llm_system_prompt: promptEl.value,
      });
      saveStatusLlm.textContent = "✓ Kaydedildi";
      saveStatusLlm.classList.remove("hidden", "error");
      keyEl.value = "";
      toast("LLM ayarları kaydedildi", "success");
      setTimeout(() => saveStatusLlm.classList.add("hidden"), 3000);
    } catch (err) {
      saveStatusLlm.textContent = `Hata: ${err.message}`;
      saveStatusLlm.classList.remove("hidden");
      saveStatusLlm.classList.add("error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── Wazuh form submit ──────────────────────────────────────────────────────
  container.querySelector("#wazuh-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = container.querySelector("#btn-save-wazuh");
    const stat = container.querySelector("#save-status-wazuh");
    btn.disabled = true;
    stat.classList.add("hidden");
    try {
      const verifySslEl = container.querySelector("#wazuh-verify-ssl");
      await api.saveSettings({
        wazuh_host:        container.querySelector("#wazuh-host").value.trim(),
        wazuh_user:        container.querySelector("#wazuh-user").value.trim(),
        wazuh_pass:        container.querySelector("#wazuh-pass").value,
        wazuh_alert_level: container.querySelector("#wazuh-alert-level").value,
        wazuh_verify_ssl:  verifySslEl.checked ? "1" : "0",
        wazuh_backend:     container.querySelector("#wazuh-backend").value,
        wazuh_es_host:     container.querySelector("#wazuh-es-host").value.trim(),
        wazuh_es_user:     container.querySelector("#wazuh-es-user").value.trim(),
        wazuh_es_pass:     container.querySelector("#wazuh-es-pass").value,
      });
      stat.textContent = "✓ Kaydedildi";
      stat.classList.remove("hidden", "error");
      container.querySelector("#wazuh-pass").value    = "";
      container.querySelector("#wazuh-es-pass").value = "";
      toast("Wazuh ayarları kaydedildi", "success");
      setTimeout(() => stat.classList.add("hidden"), 3000);
    } catch (err) {
      stat.textContent = `Hata: ${err.message}`;
      stat.classList.remove("hidden");
      stat.classList.add("error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── Observium form submit ──────────────────────────────────────────────────
  container.querySelector("#obs-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = container.querySelector("#btn-save-obs");
    const stat = container.querySelector("#save-status-obs");
    btn.disabled = true;
    stat.classList.add("hidden");
    try {
      await api.saveSettings({
        obs_host:    container.querySelector("#obs-host").value.trim(),
        obs_user:    container.querySelector("#obs-user").value.trim(),
        obs_pass:    container.querySelector("#obs-pass").value,
        obs_backend: container.querySelector("#obs-backend").value,
      });
      stat.textContent = "✓ Kaydedildi";
      stat.classList.remove("hidden", "error");
      container.querySelector("#obs-pass").value = "";
      toast("Observium ayarları kaydedildi", "success");
      setTimeout(() => stat.classList.add("hidden"), 3000);
    } catch (err) {
      stat.textContent = `Hata: ${err.message}`;
      stat.classList.remove("hidden");
      stat.classList.add("error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── Telegram form submit ───────────────────────────────────────────────────
  container.querySelector("#tg-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = container.querySelector("#btn-save-tg");
    const stat = container.querySelector("#save-status-tg");
    btn.disabled = true;
    stat.classList.add("hidden");
    try {
      await api.saveSettings({
        telegram_token:   container.querySelector("#tg-token").value,
        telegram_chat_id: container.querySelector("#tg-chat-id").value.trim(),
      });
      stat.textContent = "✓ Kaydedildi";
      stat.classList.remove("hidden", "error");
      container.querySelector("#tg-token").value = "";
      toast("Telegram ayarları kaydedildi", "success");
      setTimeout(() => stat.classList.add("hidden"), 3000);
    } catch (err) {
      stat.textContent = `Hata: ${err.message}`;
      stat.classList.remove("hidden");
      stat.classList.add("error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── Password form ──────────────────────────────────────────────────────────
  container.querySelector("#pw-form").addEventListener("submit", async e => {
    e.preventDefault();
    const cur  = container.querySelector("#pw-current").value;
    const nw   = container.querySelector("#pw-new").value;
    const conf = container.querySelector("#pw-confirm").value;
    const stat = container.querySelector("#pw-status");
    stat.classList.add("hidden");
    if (nw !== conf) {
      stat.textContent = "Şifreler eşleşmiyor";
      stat.classList.remove("hidden"); stat.classList.add("error");
      return;
    }
    try {
      await api.changePassword(cur, nw);
      stat.textContent = "✓ Şifre güncellendi";
      stat.classList.remove("hidden", "error");
      container.querySelector("#pw-form").reset();
      toast("Şifre başarıyla güncellendi", "success");
    } catch (err) {
      stat.textContent = err.message || "Hata";
      stat.classList.remove("hidden"); stat.classList.add("error");
    }
  });
}
