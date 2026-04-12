.PHONY: help up down build logs restart clean status

## ─── Yardım ────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  EcY_S3CB0T — Docker Komutları"
	@echo ""
	@echo "  make setup    → .env dosyasını oluştur (ilk kurulum)"
	@echo "  make up       → Servisleri başlat (arka planda)"
	@echo "  make down     → Servisleri durdur"
	@echo "  make build    → Image'ları yeniden derle"
	@echo "  make restart  → Yeniden başlat"
	@echo "  make logs     → Canlı log takibi"
	@echo "  make logs-ui  → Sadece UI logları"
	@echo "  make logs-bot → Sadece Bot logları"
	@echo "  make status   → Servis durumu"
	@echo "  make clean    → Container + volume sil (VERİ KAYBI!)"
	@echo ""

## ─── İlk Kurulum ────────────────────────────────────────────────────────────
setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✅ .env dosyası oluşturuldu. Lütfen değerleri doldurun: nano .env"; \
	else \
		echo "⚠️  .env zaten mevcut, dokunulmadı."; \
	fi

## ─── Çalıştırma ─────────────────────────────────────────────────────────────
up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --no-cache

restart:
	docker compose restart

## ─── Loglar ─────────────────────────────────────────────────────────────────
logs:
	docker compose logs -f

logs-ui:
	docker compose logs -f ui

logs-bot:
	docker compose logs -f bot

## ─── Durum ───────────────────────────────────────────────────────────────────
status:
	docker compose ps

## ─── Temizlik (Dikkatli!) ────────────────────────────────────────────────────
clean:
	@echo "⚠️  Bu işlem container ve veritabanı volume'unu SİLER!"
	@read -p "Devam etmek istiyor musunuz? (evet yazın): " confirm && [ "$$confirm" = "evet" ]
	docker compose down -v --remove-orphans
