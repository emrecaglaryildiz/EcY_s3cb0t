# EcY_S3CB0T — Güvenlik İzleme ve Telegram Botu

Wazuh SIEM, Observium ağ izleme, Graylog log yönetimi ve Fortinet FortiGate güvenlik duvarından veri çekip LLM ile yorumlayan, sonuçları Telegram'a gönderen akıllı güvenlik botu. Yönetim için tam özellikli bir web arayüzü içerir.

## Mimari

```
Wazuh API           ──┐
Observium (CE)      ──┤
Graylog REST API    ──┼──► bot.py ──► LLM (Ollama veya OpenAI API) ──► Telegram
FortiGate REST API  ──┘

Web UI (Express + React)
 ├── Dashboard      → Bot durumu, son raporlar
 ├── Raporlar       → Tüm analiz raporları + Sohbet (LLM chat)
 ├── Ayarlar        → Tüm bağlantı ve LLM ayarları (web üzerinden)
 ├── Telegram       → Gönderilen mesajlar + bot'a mesaj gönderme
 ├── Graylog        → Log dashboard + alarmlar + bağlantı ayarları
 └── Fortinet       → FortiGate dashboard (NIC, IPSec, politikalar, kaynaklar) + bağlantı ayarları
```

## Gereksinimler

| Bileşen | Minimum |
|---|---|
| Python | 3.11+ |
| Node.js | 18+ |
| RAM (LLM için) | 4 GB (qwen2.5:3b) |
| Ollama | Son sürüm (Ollama kullanılacaksa) |
| Wazuh | 4.x (API v2) |
| Observium | Community Edition 24.x (web scraping) |
| Graylog | 4.x+ (REST API) |
| FortiGate | 7.x (FortiOS REST API v2) |

## Hızlı Kurulum

```bash
chmod +x setup.sh
sudo ./setup.sh
```

Script otomatik olarak şunları yapar:
1. Sistem bağımlılıklarını kurar (Python, Node.js, curl, git)
2. Ollama kurar + model indirir (LLM_PROVIDER=ollama ise)
3. Python sanal ortamı ve bağımlılıklarını yükler
4. Web UI npm bağımlılıklarını kurar ve derler
5. `.env` yoksa `.env.example`'dan oluşturur
6. SQLite veritabanını başlatır
7. İki systemd servisi oluşturur ve başlatır:
   - `ecy-s3cb0t-bot.service` → Python Telegram botu
   - `ecy-s3cb0t-ui.service` → Web yönetim paneli

## Manuel Kurulum

```bash
# 1. Python ortamı
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Ollama kullanılacaksa model indir
ollama pull qwen2.5:3b    # 4 GB RAM için
# ollama pull llama3.2:8b # 8 GB RAM için

# 3. .env ayarla
cp .env.example .env
nano .env    # Değerleri düzenle

# 4. Bot'u çalıştır
python bot.py

# ─── Web Arayüzü ───────────────────────────────────────────────────────────
# 5. Bağımlılıkları yükle
npm install

# 6. Geliştirme sunucusu
npm run dev

# 7. Production build
npm run build
NODE_ENV=production node dist/index.cjs
```

## Konfigürasyon (.env)

### Telegram
| Değişken | Açıklama |
|---|---|
| `TELEGRAM_TOKEN` | BotFather'dan alınan token |
| `TELEGRAM_CHAT_ID` | @userinfobot ile öğrenilen ID |

### Wazuh
| Değişken | Açıklama |
|---|---|
| `WAZUH_HOST` | `https://IP:55000` |
| `WAZUH_USER` | Wazuh API kullanıcısı |
| `WAZUH_PASS` | Wazuh API şifresi |
| `WAZUH_ALERT_LEVEL` | Minimum alert seviyesi (1-15, varsayılan: 7) |

### Observium (Community Edition)
| Değişken | Açıklama |
|---|---|
| `OBSERVIUM_HOST` | `http://IP` |
| `OBSERVIUM_USER` | Observium kullanıcısı |
| `OBSERVIUM_PASS` | Observium şifresi |

> **Not:** Observium CE'nin REST API'si yoktur. Bot, kullanıcı adı/şifre ile web arayüzüne giriş yaparak dashboard sayfasını analiz eder (BeautifulSoup).

### Graylog
| Değişken | Açıklama |
|---|---|
| `GRAYLOG_HOST` | `http://IP:9000` |
| `GRAYLOG_USER` | Graylog kullanıcısı |
| `GRAYLOG_PASS` | Graylog şifresi |
| `GRAYLOG_RANGE_SECONDS` | Log sorgu aralığı saniye cinsinden (varsayılan: 3600) |

### Fortinet FortiGate
| Değişken | Açıklama |
|---|---|
| `FORTINET_HOST` | FortiGate yönetim adresi — `https://IP` veya `https://IP:8443` |
| `FORTINET_AUTH` | Kimlik doğrulama yöntemi: `token` (API token) veya `session` (kullanıcı adı/şifre) |
| `FORTINET_API_TOKEN` | API token (`FORTINET_AUTH=token` ise) — read-only kullanıcı için oluşturun |
| `FORTINET_USER` | FortiGate kullanıcı adı (`FORTINET_AUTH=session` ise) |
| `FORTINET_PASS` | FortiGate şifresi (`FORTINET_AUTH=session` ise) |
| `FORTINET_VDOM` | Sanal alan adı (varsayılan: `root`) |

> **Not:** Fortinet için read-only yetkili bir kullanıcı/token kullanın. **System → Administrators → Create New → REST API Admin** menüsünden API token oluşturabilirsiniz. Token yöntemi önerilir.

### LLM Sağlayıcı
| Değişken | Açıklama |
|---|---|
| `LLM_PROVIDER` | `ollama` veya `openai` (hangisi aktifse diğeri devre dışı) |
| `OLLAMA_HOST` | Ollama API adresi (varsayılan: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama model adı (örn: `qwen2.5:3b`) |
| `OPENAI_BASE_URL` | OpenAI uyumlu API adresi (örn: `https://your-llm-api.example.com/v1`) |
| `OPENAI_API_KEY` | API anahtarı |
| `OPENAI_MODEL` | Model adı (örn: `qwen/qwen3.5-35b-a3b`, `gpt-4o`) |

### Zamanlayıcı
| Değişken | Açıklama |
|---|---|
| `CHECK_INTERVAL_MINUTES` | Otomatik rapor gönderme sıklığı (dakika) |

## Telegram Komutları

Komutlar bot'a özel mesaj olarak veya botun ekli olduğu grup içinden kullanılabilir. Grup üyeleri bu komutlarla anlık durum sorgulayabilir.

| Komut | Açıklama |
|---|---|
| `/durum` | Tam LLM analiz raporu (tüm sistemler: Wazuh + Observium + Graylog + Fortinet) |
| `/wazuh_sondurum` | Sadece Wazuh güvenlik alert özeti |
| `/observium_sondurum` | Sadece Observium ağ durumu |
| `/graylog_sondurum` | Sadece Graylog log yönetimi durumu |
| `/forti_sondurum` | Sadece Fortinet FortiGate güvenlik durumu |
| `/yardim` | Komut listesi ve açıklamaları |

> **BotFather Menüsü:** Bot, başlatıldığında BotFather'a komut listesini otomatik kaydeder. Telegram'da `/` yazıldığında komutlar otomatik tamamlanarak görünür.

## Web Arayüzü

Tarayıcıdan `http://localhost:5000` adresine gidilerek erişilir.

### Giriş Bilgileri
- Varsayılan kullanıcı: `admin` / Şifre: `98123`
- Şifre web arayüzünden **Ayarlar → Hesap Güvenliği** altından değiştirilebilir

### Sayfalar

| Sayfa | Açıklama |
|---|---|
| **Dashboard** | Bot çalışma durumu, son rapor özeti, hızlı aksiyon butonları |
| **Raporlar → Raporlar** | Tüm analiz raporlarının listesi ve detayları |
| **Raporlar → Sohbet** | Aktif LLM ile gerçek zamanlı sohbet |
| **Ayarlar** | Telegram, Wazuh, Observium, Graylog, Fortinet ve LLM ayarları; test butonları |
| **Telegram** | Telegrama gönderilen mesaj geçmişi + web üzerinden mesaj gönderme |
| **Graylog** | Log dashboard (KPI, seviye dağılımı, alarmlar, top kaynaklar) + bağlantı ayarları |
| **Fortinet** | FortiGate dashboard (NIC tablosu, IPSec tünelleri, politika hit sayıları, CPU/RAM/Disk, oturum istatistikleri, routing tablosu) + bağlantı ayarları |

### Ayarlar Sayfası Özellikleri
- Her bağlantı için ayrı **Test Butonu** (Wazuh, Observium, Graylog, Fortinet, Ollama, OpenAI)
- LLM sağlayıcı seçimi: Ollama aktifken OpenAI alanları devre dışı kalır ve tersine
- Fortinet'te kimlik yöntemi toggle: API Token / Kullanıcı+Şifre
- Şifre alanları için göster/gizle toggle
- Demo veriler: gerçek bağlantı sağlanana kadar örnek veri gösterilir

## Model Seçimi

### Ollama (Yerel)
| Model | RAM | Hız | Kalite |
|---|---|---|---|
| `qwen2.5:3b` | ~2 GB | Çok hızlı | İyi |
| `gemma3:4b` | ~3 GB | Hızlı | İyi |
| `llama3.2:8b` | ~5 GB | Orta | Çok iyi |
| `mistral:7b` | ~5 GB | Orta | Çok iyi |

### OpenAI Uyumlu API
| Model | Notlar |
|---|---|
| `qwen/qwen3.5-35b-a3b` | Önerilen — `OPENAI_BASE_URL` ile kendi API endpoint'inize yönlendirin |
| `gpt-4o` | OpenAI resmi API (`https://api.openai.com/v1`) |
| Diğer uyumlu modeller | `OPENAI_BASE_URL` ile herhangi bir OpenAI uyumlu endpoint kullanılabilir |

## Servis Yönetimi

```bash
# Bot servisi
sudo systemctl start  ecy-s3cb0t-bot
sudo systemctl stop   ecy-s3cb0t-bot
sudo systemctl status ecy-s3cb0t-bot
journalctl -u ecy-s3cb0t-bot -f

# Web UI servisi
sudo systemctl start  ecy-s3cb0t-ui
sudo systemctl stop   ecy-s3cb0t-ui
sudo systemctl status ecy-s3cb0t-ui
journalctl -u ecy-s3cb0t-ui -f

# İkisini birden
sudo systemctl stop  ecy-s3cb0t-bot ecy-s3cb0t-ui
sudo systemctl start ecy-s3cb0t-bot ecy-s3cb0t-ui
```

## Dosya Yapısı

```
wazuh-obs-bot/               # Python bot
├── bot.py                   # Ana bot — Telegram komutları + zamanlayıcı
├── wazuh_collector.py       # Wazuh REST API modülü (JWT auth)
├── observium_collector.py   # Observium CE web scraper (BeautifulSoup)
├── graylog_collector.py     # Graylog REST API modülü (Basic Auth)
├── fortinet_collector.py    # FortiGate REST API modülü (Token + Session auth, FortiOS 7.x)
├── llm_analyzer.py          # LLM entegrasyonu (Ollama + OpenAI uyumlu)
├── requirements.txt         # Python bağımlılıkları
├── setup.sh                 # Tam otomatik kurulum scripti
├── .env.example             # Konfigürasyon şablonu
└── README.md                # Bu dosya

security-bot-ui/             # Web arayüzü
├── client/src/
│   ├── pages/
│   │   ├── dashboard.tsx    # Ana panel
│   │   ├── settings.tsx     # Ayarlar (tüm bağlantılar + LLM)
│   │   ├── reports.tsx      # Raporlar listesi
│   │   ├── chat.tsx         # LLM sohbet
│   │   ├── telegram.tsx     # Telegram mesaj geçmişi + gönderme
│   │   ├── graylog.tsx      # Graylog dashboard + ayarlar
│   │   └── fortinet.tsx     # FortiGate dashboard + ayarlar
│   └── components/
│       └── app-layout.tsx   # Sidebar navigasyon
├── server/
│   ├── routes.ts            # API endpoint'leri
│   └── storage.ts           # SQLite/Drizzle ORM
└── shared/
    └── schema.ts            # Veri modelleri
```

## Graylog API Notları

- Basic Auth kullanılır — admin veya API erişim yetkili kullanıcı gerekir
- Varsayılan port: `9000` (HTTPS arkasında `443`)
- Kullanılan endpoint'ler:
  - `GET /api/system` — sürüm ve işlem durumu
  - `GET /api/system/cluster/nodes` — node sayısı
  - `GET /api/system/throughput` — anlık mesaj/sn
  - `GET /api/system/indices/index_sets/stats` — indeks istatistikleri
  - `GET /api/system/notifications` — sistem bildirimleri
  - `POST /api/events/search` — tetiklenen alarmlar
  - `GET /api/search/universal/relative` — log istatistikleri
  - `GET /api/search/universal/relative/terms` — kaynak başına log sayısı

## Fortinet FortiGate API Notları

- FortiOS 7.x REST API v2 kullanılır
- İki kimlik yöntemi desteklenir:
  - **Token:** `Authorization: Bearer <token>` header'ı ile — önerilen yöntem
  - **Session:** `POST /logincheck` ile oturum + CSRF token
- VDOM desteği: tüm isteklere `?vdom=<vdom>` parametresi eklenir
- Kullanılan endpoint'ler:
  - `GET /api/v2/monitor/system/status` — FortiGate sürüm ve seri numarası
  - `GET /api/v2/monitor/system/resource` — CPU, RAM, Disk kullanımı
  - `GET /api/v2/monitor/system/interface` — NIC listesi (link, hız, TX/RX)
  - `GET /api/v2/monitor/vpn/ipsec` — IPSec tünel durumları ve trafik
  - `GET /api/v2/cmdb/firewall/policy` — Güvenlik duvarı politikaları
  - `GET /api/v2/monitor/firewall/session-top` — Aktif oturum istatistikleri
  - `GET /api/v2/monitor/router/ipv4` — Routing tablosu
- Read-only API token için: **System → Administrators → Create New → REST API Admin**
