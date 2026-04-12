# EcY_S3CB0T

Wazuh SIEM, Observium, Graylog ve Fortinet izleme sistemlerini tek panelden yöneten,
Telegram ile otonom güvenlik raporu gönderen yapay zeka destekli güvenlik botu.

```
┌─────────────────────┐     ┌──────────────────────────┐
│  wazuh-obs-bot      │────▶│  security-bot-ui         │
│  (Python Bot)       │     │  (Node.js Web Arayüzü)   │
│  Veri toplama       │     │  Dashboard, Sohbet,       │
│  LLM analiz         │     │  Raporlar, Ayarlar        │
│  Telegram gönderim  │     │  SQLite veritabanı        │
└─────────────────────┘     └──────────────────────────┘
```

---

## Hızlı Başlangıç (Docker)

### 1. `.env` dosyasını oluştur

```bash
make setup
# veya:
cp .env.example .env
```

`.env` dosyasını açıp **en az** şu değerleri doldurun:

```env
SESSION_SECRET=openssl-rand-hex-32-ile-uretilen-deger
TELEGRAM_TOKEN=botfather-dan-alinan-token
TELEGRAM_CHAT_ID=telegram-chat-id-niz
WAZUH_HOST=https://wazuh-sunucu:55000
WAZUH_USER=wazuh
WAZUH_PASS=sifre
OBSERVIUM_HOST=http://observium-sunucu
OBSERVIUM_USER=admin
OBSERVIUM_PASS=sifre
```

### 2. Başlat

```bash
make build   # Image'ları derle (ilk seferinde ~2-3 dakika)
make up      # Arka planda çalıştır
```

Tarayıcıda `http://SUNUCU_IP:3000` adresini açın.
İlk açılışta varsayılan kullanıcı **admin / admin** ile girin, ardından şifreyi değiştirin.

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

# Yeni kodu deploy et:
git pull && make build && make up
```

---

## Proje Yapısı

```
EcY_S3CB0T/
├── docker-compose.yml      ← Tüm servisleri yönetir
├── .env.example            ← Ortam değişkeni şablonu
├── Makefile                ← Kısayol komutları
│
├── security-bot-ui/        ← Node.js + React Web Arayüzü
│   ├── Dockerfile
│   ├── server/             ← Express API + SQLite
│   └── client/             ← React + Vite Frontend
│
└── wazuh-obs-bot/          ← Python Telegram Botu
    ├── Dockerfile
    ├── bot.py              ← Ana giriş noktası
    ├── *_collector.py      ← Veri toplayıcılar
    └── llm_analyzer.py     ← LLM entegrasyonu
```

---

## Servis Bilgileri

| Servis | Port | Açıklama |
| :--- | :--- | :--- |
| `ui` | `3000` | Web arayüzü (tarayıcıdan erişilir) |
| `bot` | — | Python botu (port yok, Telegram polling) |

Servisler birbirleriyle Docker internal network üzerinde `http://ui:3000` adresinden iletişim kurar.

---

## Ollama (Yerel LLM)

Bot, LLM analizini host makinede çalışan Ollama'ya yönlendirir.
Container içinden `host.docker.internal:11434` adresi otomatik ayarlıdır.

```bash
# Host makinede Ollama'yı başlat
ollama serve

# Model yükle
ollama pull gemma4:e4b     # önerilen (8B)
ollama pull qwen2.5:3b     # hafif (3B)
```

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
make logs-bot   # "Web UI rapor push hatası" mesajlarına bak
make status     # ui servisi healthy mi?

# UI açılmıyor mu?
make logs-ui    # Port veya build hatası ara

# Ollama model yok hatası
ollama list     # Yüklü modelleri listele
ollama pull qwen2.5:3b
```

Detaylı bilgi için her projenin kendi `README.md` dosyasına bakın:
- [`security-bot-ui/README.md`](./security-bot-ui/README.md)
- [`wazuh-obs-bot/README.md`](./wazuh-obs-bot/README.md)
