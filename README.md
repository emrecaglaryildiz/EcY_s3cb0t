# EcY_S3CB0T

Wazuh, Observium, Graylog, Fortinet, Prometheus/Alertmanager, Zabbix, ElasticSearch ve
Generic Webhook gibi çoklu güvenlik/izleme sistemlerini tek merkezde birleştiren,
LLM destekli otonom güvenlik botu.

Analiz sonuçlarını **Telegram**, **e-posta (SMTP)**, **Slack** ve **Microsoft Teams**
üzerinden iletir; tüm geçmişi web arayüzünden izlemenizi sağlar.

```
┌──────────────────────────────────────────────────────────────────┐
│                      Veri Kaynakları                             │
│  Wazuh · Observium · Graylog · Fortinet · Prometheus/Alertmanager│
│  Zabbix · ElasticSearch/OpenSearch · Generic Webhook             │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│  wazuh-obs-bot  (Python)     │────▶│  security-bot-ui  (Node.js)  │
│  • Paralel veri toplama      │     │  • Dark theme SPA arayüzü    │
│  • LLM analizi               │     │  • Canlı sinyal akışı (SSE)  │
│  • Telegram gönderimi        │     │  • 7 günlük trend grafiği    │
│  • SMTP / Slack / Teams      │     │  • Rapor görüntüleyici       │
│  • Webhook alıcısı (:8080)   │     │  • Kaynak durum kartları     │
└──────────────────────────────┘     └──────────────────────────────┘
```

---

## Ön Gereksinimler

Sistemde aşağıdakilerin kurulu olması gerekir:

| Gereksinim | Minimum Sürüm | Kontrol |
| :--- | :---: | :--- |
| Docker Engine | 24.x | `docker --version` |
| Docker Compose | 2.x (V2) | `docker compose version` |

> Docker Desktop kuruluysa her ikisi de hazır gelir.
> Sunucuda yalnızca Docker Engine varsa: `sudo apt install docker-compose-plugin`

---

## Desteklenen Veri Kaynakları

| Kaynak | Zorunlu | Boş = Devre Dışı | Açıklama |
| :--- | :---: | :---: | :--- |
| Wazuh SIEM | ✅ | — | Güvenlik alarmları, ajan izleme |
| Observium | ✅ | — | Ağ cihazı ve port izleme (Community) |
| Graylog | — | ✅ | Log yönetimi ve mesaj sorguları |
| Fortinet FortiGate | — | ✅ | Güvenlik duvarı, VPN, politika istatistikleri |
| Prometheus | — | ✅ | Firing metrik alarmları |
| Alertmanager | — | ✅ | Prometheus uyarı yöneticisi |
| Zabbix | — | ✅ | Altyapı izleme ve problem listesi |
| ElasticSearch / OpenSearch | — | ✅ | Log analizi, cluster sağlığı |
| Generic Webhook | — | — | HTTP POST alıcısı — her zaman açık |

## Desteklenen Bildirim Kanalları

| Kanal | Boş = Devre Dışı | Açıklama |
| :--- | :---: | :--- |
| Telegram | — | Her zaman zorunlu — bot zaten Telegram üzerinden çalışır |
| SMTP E-posta | ✅ | Kritik raporları e-posta ile iletir |
| Slack | ✅ | Incoming Webhook ile kanal bildirimi |
| Microsoft Teams | ✅ | Incoming Webhook / MessageCard bildirimi |

---

## Kurulum Adımları

### Adım 1 — Telegram Botu Oluşturun

Eğer henüz bir Telegram botunuz yoksa:

1. Telegram'da **@BotFather**'a mesaj atın
2. `/newbot` komutunu gönderin
3. Bot adı ve kullanıcı adı girin
4. BotFather size bir **token** verecek → `TELEGRAM_TOKEN` değişkenine yazın

### Adım 2 — Telegram Chat ID'yi Bulun

Botun mesaj atacağı chat veya grubun ID'sini öğrenmek için:

```bash
# 1. Botu Telegram'da başlatın veya gruba ekleyin ve bir mesaj gönderin
# 2. Aşağıdaki URL'yi tarayıcıda açın (TOKEN'ı kendi tokenınızla değiştirin)
https://api.telegram.org/bot<TOKEN>/getUpdates

# 3. Dönen JSON içinde şunu arayın:
#    "chat": { "id": -1001234567890, ... }
#    Bu sayı TELEGRAM_CHAT_ID değerinizdir.
#    Grup ID'leri genellikle negatiftir (-100...).
```

### Adım 3 — SESSION_SECRET Üretin

Web arayüzü oturum şifrelemesi için rastgele bir anahtar gereklidir:

```bash
openssl rand -hex 32
# Örnek çıktı: a3f8c2e1d4b5a6f7e8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
```

Bu değeri `.env` dosyasındaki `SESSION_SECRET=` satırına yapıştırın.

### Adım 4 — `.env` Dosyasını Oluşturun

```bash
cp .env.example .env
nano .env   # veya: vim .env / code .env
```

**Mutlaka doldurulması gereken değerler:**

```env
# ── Web Arayüzü ───────────────────────────────────────────────
SESSION_SECRET=buraya-openssl-ile-uretilen-degeri-yapistirin

# ── Telegram ──────────────────────────────────────────────────
TELEGRAM_TOKEN=1234567890:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=-1001234567890   # Negatif = grup, pozitif = özel chat

# ── Wazuh (Zorunlu) ───────────────────────────────────────────
WAZUH_HOST=https://wazuh-sunucu:55000
WAZUH_USER=wazuh
WAZUH_PASS=sifreniz
WAZUH_VERIFY_SSL=0   # Kendi imzalı sertifika varsa 0 bırakın

# ── Observium (Zorunlu) ───────────────────────────────────────
OBSERVIUM_HOST=http://observium-sunucu
OBSERVIUM_USER=admin
OBSERVIUM_PASS=sifreniz
```

**İsteğe bağlı — boş bırakırsanız otomatik devre dışı olur:**

```env
GRAYLOG_HOST=http://graylog:9000
FORTINET_HOST=https://10.0.0.1
PROMETHEUS_HOST=http://prometheus:9090
ZABBIX_HOST=http://zabbix-web
ELASTIC_HOST=http://elastic:9200
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
TEAMS_WEBHOOK_URL=https://xxx.webhook.office.com/...
SMTP_HOST=mail.sirket.com
```

### Adım 5 — LLM Sağlayıcısı Seçin

`.env` dosyasında `LLM_PROVIDER` değerini ayarlayın:

**Ollama (yerel, varsayılan — ücretsiz):**
```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:3b
```
> Host makinede `ollama serve` çalışıyor olmalı ve model indirilmiş olmalı:
> ```bash
> ollama pull qwen2.5:3b    # hafif (~2GB)
> ollama pull gemma4:e4b    # önerilen (~5GB)
> ```

**Anthropic Claude API:**
```env
LLM_PROVIDER=claude
CLAUDE_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-haiku-4-5-20251001
```

**OpenAI veya uyumlu API:**
```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### Adım 6 — Başlatın

```bash
make build   # Docker image'larını derle — ilk seferinde ~3-5 dakika sürer
make up      # Arka planda başlat
make status  # Servislerin durumunu kontrol et
```

Her iki servis de **healthy** olunca sistem hazırdır.

Tarayıcıda açın: `http://SUNUCU_IP:3000`
İlk giriş: **admin** / **admin** → Giriş yaptıktan sonra şifrenizi değiştirin.

---

## Web Arayüzü

| Sayfa | İçerik |
| :--- | :--- |
| **Dashboard** | Bot durumu, kritik/uyarı sayaçları, canlı sinyal akışı, 7 günlük trend grafiği, son rapor özeti, "Rapor Üret" butonu |
| **Sinyaller** | Tüm alarm geçmişi, filtreler (kritik/uyarı/bilgi + kaynak), ham JSON görünümü |
| **Raporlar** | LLM analiz raporları listesi, Markdown görüntüleyici |
| **Kaynaklar** | Her entegrasyonun aktif/devre dışı durum kartları |

**"Rapor Üret" butonu:** Telegram komutuna gerek kalmadan web arayüzünden rapor tetikler.
Bot bir sonraki heartbeat'te (en geç 60 saniye) raporu üretip hem Telegram'a gönderir
hem de arayüze yansıtır.

---

## Proje Yapısı

```
EcY_S3CB0T/
├── docker-compose.yml           ← Tüm servisleri yönetir
├── .env.example                 ← Ortam değişkeni şablonu
├── Makefile                     ← Kısayol komutları
│
├── security-bot-ui/             ← Node.js Web Arayüzü
│   ├── Dockerfile
│   ├── package.json
│   └── server/
│       ├── index.js             ← Express + statik dosya sunumu (:3000)
│       ├── db.js                ← SQLite WAL — şema ve seed
│       ├── emitter.js           ← SSE event bus
│       └── routes/
│           ├── auth.js          ← /api/auth/*
│           ├── reports.js       ← /api/reports/*
│           ├── signals.js       ← /api/signals/*
│           ├── bot.js           ← /api/bot/* (heartbeat, trigger, sources)
│           ├── events.js        ← /api/events  (SSE stream)
│           └── webhook.js       ← /api/webhook/* (UI geçmişi)
│
└── wazuh-obs-bot/               ← Python Botu
    ├── Dockerfile
    ├── requirements.txt
    ├── bot.py                   ← Ana modül, Telegram komutları, zamanlayıcı
    ├── wazuh_collector.py
    ├── observium_collector.py
    ├── graylog_collector.py
    ├── fortinet_collector.py
    ├── prometheus_collector.py
    ├── zabbix_collector.py
    ├── elastic_collector.py     ← ElasticSearch / OpenSearch
    ├── webhook_receiver.py      ← Flask HTTP alıcısı (:8080)
    ├── llm_analyzer.py          ← Ollama / Claude / OpenAI
    ├── smtp_notifier.py
    ├── slack_notifier.py
    └── teams_notifier.py
```

---

## Servis Bilgileri

| Servis | Port | Açıklama |
| :--- | :---: | :--- |
| `ui` | `3000` | Web arayüzü (tarayıcıdan erişilir) |
| `bot` | `8080` | Generic Webhook HTTP alıcısı |

Servisler birbirleriye Docker internal ağı üzerinden `http://ui:3000` adresiyle iletişim kurar.

---

## Bildirim Kanalları — Yapılandırma

### SMTP E-posta

```env
SMTP_HOST=mail.sirket.com
SMTP_PORT=587              # 587=STARTTLS | 465=SSL | 25=düz
SMTP_USER=bot@sirket.com
SMTP_PASS=sifre
SMTP_FROM=bot@sirket.com   # Boş bırakılırsa SMTP_USER kullanılır
SMTP_TO=a@sirket.com,b@sirket.com
SMTP_TLS=1
SMTP_ON_CRITICAL_ONLY=1    # 1=sadece kritik içerikte gönder
```

### Slack

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
SLACK_CHANNEL=#guvenlik     # Opsiyonel kanal override
SLACK_ON_CRITICAL_ONLY=1
```

> Slack uygulaması oluşturmak için: **Slack API → Your Apps → Incoming Webhooks**

### Microsoft Teams

```env
TEAMS_WEBHOOK_URL=https://sirket.webhook.office.com/webhookb2/...
TEAMS_ON_CRITICAL_ONLY=1
```

> Teams'de Incoming Webhook eklemek için: **Kanal → Bağlayıcılar → Incoming Webhook**

---

## Generic Webhook Alıcısı

Bot `8080` portunda bir HTTP alıcısı çalıştırır. Grafana, özel araçlar veya herhangi bir
sistem buraya `POST` gönderebilir:

```bash
# Anonim (WEBHOOK_SECRET boşsa)
curl -X POST http://SUNUCU_IP:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{"title":"Disk dolu","severity":"critical","message":"/ partition %95"}'

# Kaynak etiketiyle + Bearer auth
curl -X POST http://SUNUCU_IP:8080/webhook/grafana \
  -H "Authorization: Bearer WEBHOOK_SECRET_DEGERI" \
  -H "Content-Type: application/json" \
  -d '{"state":"alerting","ruleName":"CPU Yüksek"}'

# Sağlık kontrolü
curl http://SUNUCU_IP:8080/webhook/health
# Yanıt: {"pending": 0}
```

Gelen webhook sinyalleri bir sonraki LLM analiz döngüsüne dahil edilir.

---

## Telegram Komutları

| Komut | Açıklama |
| :--- | :--- |
| `/durum` | Anlık tam güvenlik raporu üret ve gönder |
| `/wazuh_sondurum` | Wazuh alarm ve ajan özeti |
| `/observium_sondurum` | Ağ cihazı ve port özeti |
| `/graylog_sondurum` | Log istatistikleri ve event özeti |
| `/fortinet_sondurum` | FortiGate sistem, VPN ve oturum özeti |
| `/prometheus_sondurum` | Firing alarm özeti |
| `/zabbix_sondurum` | Aktif problem listesi |
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
# Genel durum
make status          # Her iki servis de "healthy" görünmeli
make logs            # Tüm logları canlı izle
make logs-bot        # Sadece bot logları
make logs-ui         # Sadece UI logları


# Bot başlamıyor / sürekli yeniden başlıyor
make logs-bot
# Bakılacaklar:
#   "TELEGRAM_TOKEN tanımlı değil"  → .env'de TELEGRAM_TOKEN boş
#   "TELEGRAM_CHAT_ID eksik"        → .env'de TELEGRAM_CHAT_ID boş veya 0
#   "Connection refused" (Wazuh)    → WAZUH_HOST erişilemiyor


# UI açılmıyor
make logs-ui
# Bakılacaklar:
#   "MODULE_NOT_FOUND"  → npm install başarısız, make build tekrar dene
#   "EADDRINUSE 3000"   → Port 3000 başka uygulama tarafından kullanılıyor
#                         docker-compose.yml'de UI_PORT=3001 yapın


# Web arayüzüne giriş yapılamıyor
# Varsayılan: admin / admin
# Şifreyi sıfırlamak için:
docker compose exec ui node -e "
const db = require('better-sqlite3')('/app/data/data.db');
const bcrypt = require('bcryptjs');
db.prepare(\"UPDATE users SET password=? WHERE username='admin'\")
  .run(bcrypt.hashSync('yeni-sifre', 10));
console.log('Şifre güncellendi.');
"


# Telegram'a mesaj gitmiyor
# TELEGRAM_CHAT_ID'yi bulmak için:
# 1. Botu başlatın veya gruba ekleyip bir mesaj yazın
# 2. Tarayıcıda açın:
#    https://api.telegram.org/bot<TOKEN>/getUpdates
# 3. JSON içindeki "chat": {"id": ...} değerini alın


# Ollama model bulunamıyor
ollama list                   # Yüklü modelleri gör
ollama pull qwen2.5:3b        # Model indir
make restart                  # Botu yeniden başlat


# LLM sağlayıcısı değiştirme
# .env içinde: LLM_PROVIDER=claude   (veya openai / ollama)
make restart


# Webhook gelmiyor
curl http://SUNUCU_IP:8080/webhook/health  # {"pending":0} beklenir
# Güvenlik duvarı 8080 portunu kapatıyor olabilir


# Tüm veriyi sıfırla (dikkat: geri dönüşü yok)
make clean
```

---

## Güncelleme

```bash
git pull
make build   # Yeni image'ları derle
make up      # Yeniden başlat (veriler korunur)
```
