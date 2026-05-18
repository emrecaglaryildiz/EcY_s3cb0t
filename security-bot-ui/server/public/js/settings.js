// settings.js — LLM yapılandırma sayfası
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

        <div class="settings-actions">
          <button type="submit" class="btn btn-primary" id="btn-save">Kaydet</button>
          <span id="save-status" class="save-status hidden">✓ Kaydedildi</span>
        </div>

      </form>
    </div>

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
  `;

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
  const saveStatus = container.querySelector("#save-status");

  function applyProviderUI(prov) {
    const p = PROVIDERS[prov] || PROVIDERS.ollama;
    urlRow.classList.toggle("hidden", !p.showUrl);
    keyRow.classList.toggle("hidden", !p.showKey);
    urlLabel.textContent   = p.urlLabel;
    urlHint.textContent    = p.urlHint;
    modelHint.textContent  = p.modelHint;
  }

  providerEl.addEventListener("change", () => applyProviderUI(providerEl.value));

  // Mevcut ayarları yükle
  try {
    const s = await api.getSettings();
    providerEl.value  = s.llm_provider || "ollama";
    urlEl.value       = s.llm_base_url || "";
    modelEl.value     = s.llm_model    || "";
    timeoutEl.value   = s.llm_timeout  || "60";
    if (s.llm_api_key_set) {
      container.querySelector("#key-hint").textContent = "API key kayıtlı. Değiştirmek için yeni değer girin.";
    }
    applyProviderUI(providerEl.value);
  } catch {
    applyProviderUI("ollama");
  }

  // API key göster/gizle
  container.querySelector("#btn-show-key").addEventListener("click", () => {
    keyEl.type = keyEl.type === "password" ? "text" : "password";
  });

  // LLM form submit
  container.querySelector("#llm-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = container.querySelector("#btn-save");
    btn.disabled = true;
    saveStatus.classList.add("hidden");
    try {
      await api.saveSettings({
        llm_provider: providerEl.value,
        llm_base_url: urlEl.value.trim(),
        llm_model:    modelEl.value.trim(),
        llm_api_key:  keyEl.value,
        llm_timeout:  timeoutEl.value,
      });
      saveStatus.textContent = "✓ Kaydedildi";
      saveStatus.classList.remove("hidden", "error");
      keyEl.value = "";
      toast("LLM ayarları kaydedildi", "success");
      setTimeout(() => saveStatus.classList.add("hidden"), 3000);
    } catch (err) {
      saveStatus.textContent = `Hata: ${err.message}`;
      saveStatus.classList.remove("hidden");
      saveStatus.classList.add("error");
    } finally {
      btn.disabled = false;
    }
  });

  // Şifre formu
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
