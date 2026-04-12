#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# install.sh — Wazuh + Observium Telegram Bot kurulum scripti
# Kullanım: chmod +x install.sh && ./install.sh
# ─────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_USER="$USER"

echo "══════════════════════════════════════════"
echo "  Wazuh + Observium Bot — Kurulum"
echo "══════════════════════════════════════════"

# ── 1. Ollama kurulumu ────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
    echo "[1/5] Ollama kuruluyor..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "[1/5] Ollama zaten kurulu — atlanıyor."
fi

# ── 2. Modeli indir ───────────────────────────────────────────
MODEL_NAME="${OLLAMA_MODEL:-qwen2.5:3b}"
echo "[2/5] Ollama modeli çekiliyor: $MODEL_NAME"
ollama pull "$MODEL_NAME"

# ── 3. Python sanal ortamı ────────────────────────────────────
echo "[3/5] Python sanal ortamı oluşturuluyor..."
cd "$SCRIPT_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "      Bağımlılıklar yüklendi."

# ── 4. .env dosyası ───────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "[4/5] .env dosyası oluşturuluyor (.env.example kopyalandı)..."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo ""
    echo "  ⚠️  LÜTFEN .env dosyasını düzenleyip gerçek değerleri girin:"
    echo "      nano $SCRIPT_DIR/.env"
    echo ""
else
    echo "[4/5] .env dosyası mevcut — atlanıyor."
fi

# ── 5. Systemd servisi ────────────────────────────────────────
echo "[5/5] Systemd servisi oluşturuluyor..."

VENV_PYTHON="$SCRIPT_DIR/venv/bin/python"

sudo tee /etc/systemd/system/security-bot.service > /dev/null << EOF
[Unit]
Description=Wazuh + Observium Security Telegram Bot
After=network.target ollama.service

[Service]
Type=simple
User=${BOT_USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${VENV_PYTHON} ${SCRIPT_DIR}/bot.py
Restart=on-failure
RestartSec=15
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable security-bot

echo ""
echo "══════════════════════════════════════════"
echo "  Kurulum tamamlandı!"
echo ""
echo "  Servis başlatmak için:"
echo "    sudo systemctl start security-bot"
echo ""
echo "  Log izlemek için:"
echo "    journalctl -u security-bot -f"
echo ""
echo "  Manuel test için:"
echo "    source venv/bin/activate && python bot.py"
echo "══════════════════════════════════════════"
