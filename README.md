# EcY_S3CB0T

Wazuh, Observium, Graylog, Fortinet, Prometheus/Alertmanager, Zabbix ve Generic Webhook gibi
çoklu güvenlik/izleme sistemlerini tek bir merkezde birleştiren, LLM destekli otonom güvenlik botu.
Analiz sonuçlarını Telegram mesajı ve/veya e-posta olarak iletir; tüm geçmişi web arayüzünden izlemenizi sağlar.

```
┌──────────────────────────────────────────────────────────┐
│               Veri Kaynakları                            │
│  Wazuh · Observium · Graylog · Fortinet                  │
│  Prometheus/Alertmanager · Zabbix · Generic Webhook      │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────┐     ┌──────────────────────────┐
│  wazuh-obs-bot (Python)     │────▶│  security-bot-ui (Node)  │
│  • Paralel veri toplama     │     │  • Express + SQLite       │
│  • LLM analiz               │     │  • Dashboard & Raporlar   │
│  • Telegram gönderimi       │     │  • Sinyal geçmişi         │
│  • SMTP e-posta             │     │  • Bot durumu             │
│  • Webhook alıcısı (:8080)  │     │  • Web (:3000)            │
└─────────────────────────────┘     └──────────────────────────┘
```

---

## Desteklenen Veri Kaynakları

| Kaynak | Zorunlu | Açıklama |
| :--- | :---: | :--- |
| Wazuh SIEM | ✅ | Güvenlik alarmları (seviye filtreli, zaman pencereli) |
| Observium | ✅ | Ağ cihazı durumu ve arayüz metrikleri |
| Graylog | — | Log yönetimi ve sorgu sonuçları |
| Fortinet FortiGate | — | Güvenlik duvarı durumu, oturum, rota ve politika istatistikleri |
| Prometheus | — | Tetiklenmiş metrik alarmları |
| Alertmanager | — | Prometheus'a bağlı aktif uyarılar |
| Zabbix | — | Aktif problemler ve host durumu |
| Generic Webhook | — | Grafana, özel araçlar veya herhangi bir sistem (POST /webhook) |

---

## Hızlı Başlangıç (Docker)

### 1. `.env` dosyasını oluştur

```bash
cp .env.example .env
```

`.env` dosyasını açıp **zorunlu** değerleri doldurun:

```env
SESSION_SECRET=          # openssl rand -hex 32
TELEGRAM_TOKEN=          # BotFather'dan alınan token
TELEGRAM_CHAT_ID=        # Hedef chat veya grup ID'si

WAZUH_HOST=https://wazuh-sunucu:55000
WAZUH_USER=wazuh
WAZUH_PASS=sifre

OBSERVIUM_HOST=http://observium-sunucu
OBSERVIUM_USER=admin
OBSERVIUM_PASS=sifre
```

İsteğe bağlı kaynakları etkinleştirmek için `GRAYLOG_HOST`, `FORTINET_HOST`,
`PROMETHEUS_HOST`, `ZABBIX_HOST` değişkenlerini doldurun (boş bırakılırsa devre dışı).

### 2. Başlat

```bash
make build   # Docker image'larını derle (ilk seferinde ~2-3 dakika)
make up      # Arka planda çalıştır
```

Tarayıcıda `http://SUNUCU_IP:3000` adresini açın.
İlk girişte kullanıcı adı **admin**, şifre **admin** — girişten sonra şifrenizi değiştirin.

### 3. Durum ve loglar

```bash
make status    # Servislerin durumu
make logs      # Tüm loglar (canlı)
make logs-ui   # Sadece Web UI logları
make logs-bot  # Sadece Bot logları
```

### 4. Durdur / güncelle

```bash
make down      # Durdur (veriler korunur)
make restart   # Yeniden başlat

git pull && make build && make up   # Yeni kodu deploy et
```

---

## Proje Yapısı

```
EcY_S3CB0T/
├── docker-compose.yml          ← Tüm servisleri yönetir
├── .env.example                ← Ortam değişkeni şablonu
├── Makefile                    ← Kısayol komutları
│
├── security-bot-ui/            ← Node.js Web Arayüzü
│   ├── Dockerfile
│   ├── package.json
│   └── server/
│       ├── index.js            ← Express giriş noktası (:3000)
│       ├── db.js               ← SQLite (WAL) şema ve seed
│       └── routes/
│           ├── auth.js         ← /api/auth/*
│           ├── reports.js      ← /api/reports/*
│           ├── signals.js      ← /api/signals/*
│           ├── bot.js          ← /api/bot/* (heartbeat, durum, mesajlar)
│           └── webhook.js      ← /api/webhooks/* (UI geçmişi)
│
└── wazuh-obs-bot/              ← Python Telegram Botu
    ├── Dockerfile
    ├── requirements.txt
    ├── bot.py                  ← Ana giriş noktası ve komut yöneticisi
    ├── wazuh_collector.py      ← Wazuh JWT + zaman pencereli sorgular
    ├── observium_collector.py  ← Observium HTML scraping
    ├── graylog_collector.py    ← Graylog REST API
    ├── fortinet_collector.py   ← FortiGate REST API (token/session)
    ├── prometheus_collector.py ← Prometheus + Alertmanager API
    ├── zabbix_collector.py     ← Zabbix JSON-RPC API
    ├── webhook_receiver.py     ← Flask webhook alıcısı (:8080)
    ├── llm_analyzer.py         ← Çoklu LLM sağlayıcı (Ollama/Claude/OpenAI)
    └── smtp_notifier.py        ← SMTP e-posta bildirimleri
```

---

## Servis Bilgileri

| Servis | Port | Açıklama |
| :--- | :---: | :--- |
| `ui` | `3000` | Web arayüzü |
| `bot` | `8080` | Generic Webhook alıcısı (POST /webhook) |

Servisler birbirleriyle Docker internal network üzerinden `http://ui:3000` adresini kullanarak iletişim kurar.

---

## LLM Sağlayıcı Seçimi

`LLM_PROVIDER` değişkeni ile analiz motorunu seçin:

### Ollama (Yerel — varsayılan)

```env
LLM_PROVIDER=ollama
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=qwen2.5:3b
```

```bash
# Host makinede Ollama başlatın ve model yükleyin
ollama serve
ollama pull qwen2.5:3b    # hafif (3B)
ollama pull gemma4:e4b    # önerilen (8B)
```

### Anthropic Claude API

```env
LLM_PROVIDER=claude
CLAUDE_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-haiku-4-5-20251001
```

### OpenAI (veya uyumlu API)

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

---

## SMTP E-posta Bildirimleri

Kritik rapor veya alarm üretildiğinde otomatik e-posta göndermek için:

```env
SMTP_HOST=mail.sirket.com
SMTP_PORT=587             # 587=STARTTLS | 465=SSL | 25=düz
SMTP_USER=bot@sirket.com
SMTP_PASS=sifre
SMTP_TO=guvenliktim@sirket.com,admin@sirket.com
SMTP_ON_CRITICAL_ONLY=1   # 1=yalnızca kritik içerikte gönder
```

`SMTP_HOST` boş bırakılırsa e-posta tamamen devre dışı kalır.

---

## Generic Webhook Alıcısı

Bot, `8080` portunda bir HTTP webhook alıcısı çalıştırır.
Grafana, özel araçlar veya herhangi bir sistem buraya `POST` gönderebilir:

```bash
# Anonim (WEBHOOK_SECRET boşsa)
curl -X POST http://SUNUCU_IP:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{"title":"Disk dolu","severity":"critical","message":"/ partition %95"}'

# Kaynak etiketiyle
curl -X POST http://SUNUCU_IP:8080/webhook/grafana \
  -H "Authorization: Bearer TOKEN" \
  -d '...'
```

Gelen webhook'lar bir sonraki LLM analiz döngüsüne dahil edilir.

---

## Telegram Komutları

| Komut | Açıklama |
| :--- | :--- |
| `/durum` | Anlık güvenlik raporu üret ve gönder |
| `/wazuh_sondurum` | Sadece Wazuh özeti |
| `/observium_sondurum` | Sadece Observium özeti |
| `/graylog_sondurum` | Sadece Graylog özeti |
| `/fortinet_sondurum` | Sadece Fortinet özeti |
| `/prometheus_sondurum` | Sadece Prometheus/Alertmanager özeti |
| `/zabbix_sondurum` | Sadece Zabbix özeti |
| `/webhook_sondurum` | Bekleyen webhook sinyalleri |

---

## Yedekleme

Tüm veriler `db_data` Docker volume'unda saklanır:

```bash
# Yedek al
docker run --rm \
  -v ecy_s3cb0t_db_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/db-backup-$(date +%Y%m%d).tar.gz /data

# Geri yükle
docker run --rm \
  -v ecy_s3cb0t_db_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/db-backup-YYYYMMDD.tar.gz -C /
```

---

## Sorun Giderme

```bash
# Bot UI'ye bağlanamıyor mu?
make logs-bot    # "Web UI rapor push hatası" mesajlarına bak
make status      # ui servisi healthy mi?

# UI açılmıyor mu?
make logs-ui     # Port veya build hatası ara

# Webhook gelmiyor mu?
curl http://SUNUCU_IP:8080/webhook/health   # {"pending": 0} beklenir

# Ollama model bulunamıyor hatası
ollama list
ollama pull qwen2.5:3b

# LLM provider değişikliği
# .env içinde LLM_PROVIDER=claude|openai|ollama ayarlayın
make restart
```
