#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  EcY_S3CB0T — Tam Kurulum ve Başlatma Scripti
#  Kullanım: chmod +x setup.sh && sudo ./setup.sh
#
#  Ne yapar?
#   1. Sistem bağımlılıklarını kurar (Python 3, Node.js 20, curl, git...)
#   2. Ollama kurar + model indirir (LLM_PROVIDER=ollama ise)
#   3. Python sanal ortamı + pip bağımlılıklarını kurar
#   4. Web UI bağımlılıklarını kurar (npm install)
#   5. Web UI'yi production için derler (npm run build)
#   6. .env / .env.example yoksa oluşturur
#   7. SQLite veritabanını başlatır (Drizzle migration)
#   8. İki ayrı systemd servisi oluşturur:
#       - ecy-s3cb0t-bot.service   → Python Telegram botu
#       - ecy-s3cb0t-ui.service    → Web yönetim paneli (port 3000)
#   9. Her iki servisi etkinleştirir ve başlatır
#  10. Durum özetini gösterir
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Renkler ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✔ ${1}${RESET}"; }
info() { echo -e "${CYAN}  ▸ ${1}${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ ${1}${RESET}"; }
err()  { echo -e "${RED}  ✘ ${1}${RESET}"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}[${1}/${TOTAL_STEPS}] ${2}${RESET}"; }

TOTAL_STEPS=9

# ── Dizin tespiti ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$SCRIPT_DIR"
UI_DIR="$(dirname "$SCRIPT_DIR")/security-bot-ui"

# Eğer script wazuh-obs-bot/ içinde değilse, mevcut dizini dene
if [ ! -f "$BOT_DIR/bot.py" ]; then
    BOT_DIR="$SCRIPT_DIR"
fi
if [ ! -f "$UI_DIR/package.json" ]; then
    UI_DIR="$SCRIPT_DIR/../security-bot-ui"
fi

BOT_USER="${SUDO_USER:-$USER}"
BOT_HOME=$(eval echo "~$BOT_USER")

# ── Root kontrolü ─────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    echo ""
    warn "Bu script sudo yetkisi gerektirir (systemd servisleri için)."
    warn "Yeniden çalıştırın: sudo ./setup.sh"
    echo ""
    # sudo olmadan da devam seçeneği
    read -r -p "  Yine de devam et (systemd adımı atlanır)? [y/N] " NOSUDO
    NOSUDO="${NOSUDO,,}"
    SKIP_SYSTEMD=true
else
    SKIP_SYSTEMD=false
fi

# ── Başlık ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║          EcY_S3CB0T — Tam Kurulum Scripti           ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
info "Bot dizini  : $BOT_DIR"
info "UI dizini   : $UI_DIR"
info "Kullanıcı   : $BOT_USER"
echo ""

# ── LLM sağlayıcı tespiti ─────────────────────────────────────────────────────
LLM_PROVIDER="ollama"
if [ -f "$BOT_DIR/.env" ]; then
    LLM_PROVIDER=$(grep -E '^LLM_PROVIDER=' "$BOT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo "ollama")
fi
OLLAMA_MODEL_NAME=$(grep -E '^OLLAMA_MODEL=' "$BOT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo "qwen2.5:3b")
OLLAMA_MODEL_NAME="${OLLAMA_MODEL_NAME:-qwen2.5:3b}"

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 1 — Sistem bağımlılıkları
# ══════════════════════════════════════════════════════════════════════════════
step 1 "Sistem bağımlılıkları kontrol ediliyor"

install_if_missing() {
    local pkg="$1"
    local cmd="${2:-$1}"
    if ! command -v "$cmd" &>/dev/null; then
        info "$pkg kuruluyor..."
        if command -v apt-get &>/dev/null; then
            apt-get install -y -q "$pkg"
        elif command -v dnf &>/dev/null; then
            dnf install -y -q "$pkg"
        elif command -v yum &>/dev/null; then
            yum install -y -q "$pkg"
        else
            warn "$pkg bulunamadı, elle kurmanız gerekebilir."
            return 1
        fi
        ok "$pkg kuruldu"
    else
        ok "$pkg mevcut ($(command -v "$cmd"))"
    fi
}

# Python
if ! command -v python3 &>/dev/null; then
    info "Python 3 kuruluyor..."
    if command -v apt-get &>/dev/null; then
        apt-get update -q
        apt-get install -y -q python3 python3-pip python3-venv
    fi
    ok "Python 3 kuruldu"
else
    PYVER=$(python3 --version 2>&1)
    ok "Python mevcut: $PYVER"
fi

# pip
if ! python3 -m pip --version &>/dev/null; then
    info "pip kuruluyor..."
    if command -v apt-get &>/dev/null; then
        apt-get install -y -q python3-pip
    else
        python3 -m ensurepip --upgrade || true
    fi
fi

# python3-venv
if ! python3 -m venv --help &>/dev/null 2>&1; then
    info "python3-venv kuruluyor..."
    apt-get install -y -q python3-venv 2>/dev/null || true
fi

# curl
install_if_missing curl curl

# git
install_if_missing git git

# Node.js 20
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version)')" < "v18" ]]; then
    info "Node.js 20 LTS kuruluyor..."
    if command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
        apt-get install -y -q nodejs
    elif command -v dnf &>/dev/null; then
        dnf module install -y nodejs:20
    else
        warn "Node.js otomatik kurulamadı. https://nodejs.org adresinden elle kurun."
    fi
    ok "Node.js kuruldu: $(node --version)"
else
    ok "Node.js mevcut: $(node --version)"
fi

# npm
if ! command -v npm &>/dev/null; then
    err "npm bulunamadı. Node.js kurulumunu kontrol edin."
fi

ok "npm mevcut: $(npm --version)"

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 2 — Ollama (sadece LLM_PROVIDER=ollama ise)
# ══════════════════════════════════════════════════════════════════════════════
step 2 "LLM kurulumu ($LLM_PROVIDER)"

if [ "$LLM_PROVIDER" = "ollama" ]; then
    if ! command -v ollama &>/dev/null; then
        info "Ollama kuruluyor..."
        curl -fsSL https://ollama.com/install.sh | sh
        ok "Ollama kuruldu"
    else
        ok "Ollama mevcut: $(ollama --version 2>/dev/null || echo 'kurulu')"
    fi

    # Ollama servisini başlat
    if systemctl is-active --quiet ollama 2>/dev/null; then
        ok "Ollama servisi çalışıyor"
    else
        info "Ollama servisi başlatılıyor..."
        systemctl start ollama 2>/dev/null || ollama serve &>/dev/null &
        sleep 3
    fi

    # Model indir
    info "Ollama modeli indiriliyor: $OLLAMA_MODEL_NAME"
    info "(Bu işlem modele göre 1-5 GB indirebilir, lütfen bekleyin...)"
    if su -c "ollama pull '$OLLAMA_MODEL_NAME'" "$BOT_USER" 2>/dev/null || ollama pull "$OLLAMA_MODEL_NAME"; then
        ok "Model hazır: $OLLAMA_MODEL_NAME"
    else
        warn "Model indirilemedi. Bot başladığında tekrar denenecek."
    fi
else
    ok "OpenAI API modu seçili — Ollama atlanıyor"
    info "OPENAI_BASE_URL ve OPENAI_API_KEY değerlerinin .env'de dolu olduğundan emin olun."
fi

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 3 — Python ortamı ve bağımlılıkları
# ══════════════════════════════════════════════════════════════════════════════
step 3 "Python sanal ortamı ve bağımlılıklar"

cd "$BOT_DIR"

if [ ! -d "$BOT_DIR/venv" ]; then
    info "Sanal ortam oluşturuluyor..."
    python3 -m venv "$BOT_DIR/venv"
    ok "Sanal ortam oluşturuldu: $BOT_DIR/venv"
else
    ok "Sanal ortam mevcut"
fi

info "Python bağımlılıkları yükleniyor..."
"$BOT_DIR/venv/bin/pip" install --upgrade pip -q
"$BOT_DIR/venv/bin/pip" install -r "$BOT_DIR/requirements.txt" -q
ok "Python bağımlılıkları yüklendi"

# Sözdizimi kontrolü
for f in bot.py wazuh_collector.py observium_collector.py graylog_collector.py fortinet_collector.py llm_analyzer.py; do
    if [ -f "$BOT_DIR/$f" ]; then
        "$BOT_DIR/venv/bin/python" -m py_compile "$BOT_DIR/$f"
        ok "$f — sözdizimi OK"
    fi
done

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 4 — .env dosyası
# ══════════════════════════════════════════════════════════════════════════════
step 4 ".env yapılandırma dosyası"

if [ ! -f "$BOT_DIR/.env" ]; then
    if [ -f "$BOT_DIR/.env.example" ]; then
        cp "$BOT_DIR/.env.example" "$BOT_DIR/.env"
        chown "$BOT_USER:$BOT_USER" "$BOT_DIR/.env" 2>/dev/null || true
        ok ".env dosyası oluşturuldu (.env.example kopyası)"
    else
        # .env.example yoksa minimal şablon oluştur
        cat > "$BOT_DIR/.env" << 'ENVEOF'
# ── Telegram ──────────────────────────────────────────────
TELEGRAM_TOKEN=
TELEGRAM_CHAT_ID=

# ── Wazuh ─────────────────────────────────────────────────
WAZUH_HOST=https://10.0.0.5:55000
WAZUH_USER=wazuh
WAZUH_PASS=
WAZUH_ALERT_LEVEL=7

# ── Observium CE ──────────────────────────────────────────
OBSERVIUM_HOST=http://10.0.0.6
OBSERVIUM_USER=admin
OBSERVIUM_PASS=

# ── Graylog ───────────────────────────────────────────────
GRAYLOG_HOST=http://10.0.0.7:9000
GRAYLOG_USER=admin
GRAYLOG_PASS=
GRAYLOG_RANGE_SECONDS=3600

# ── Fortinet FortiGate ────────────────────────────────────
FORTINET_HOST=https://10.0.0.1
FORTINET_AUTH=token
FORTINET_API_TOKEN=
FORTINET_USER=admin
FORTINET_PASS=
FORTINET_VDOM=root

# ── LLM Sağlayıcı (ollama veya openai) ───────────────────
LLM_PROVIDER=ollama

# Ollama (LLM_PROVIDER=ollama ise)
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b

# OpenAI uyumlu API (LLM_PROVIDER=openai ise)
OPENAI_BASE_URL=https://your-llm-api.example.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=qwen/qwen3.5-35b-a3b

# ── Zamanlayıcı ───────────────────────────────────────────
CHECK_INTERVAL_MINUTES=30

# ── Web UI ────────────────────────────────────────────────
UI_PORT=3000
ENVEOF
        chown "$BOT_USER:$BOT_USER" "$BOT_DIR/.env" 2>/dev/null || true
        ok ".env şablonu oluşturuldu"
    fi
    echo ""
    warn "┌────────────────────────────────────────────────────────┐"
    warn "│  .env dosyasını düzenleyip gerçek değerleri girin!     │"
    warn "│  nano $BOT_DIR/.env  │"
    warn "└────────────────────────────────────────────────────────┘"
    echo ""
    # Kurulum sona erse de, sonraki adımlar devam eder
else
    ok ".env dosyası mevcut — korunuyor"
fi

# UI portu .env'den veya varsayılan
UI_PORT=$(grep -E '^UI_PORT=' "$BOT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "3000")
UI_PORT="${UI_PORT:-3000}"

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 5 — Web UI npm bağımlılıkları
# ══════════════════════════════════════════════════════════════════════════════
step 5 "Web UI — npm bağımlılıkları"

if [ ! -d "$UI_DIR" ]; then
    warn "Web UI dizini bulunamadı: $UI_DIR"
    warn "Sadece Python botu kurulacak."
    SKIP_UI=true
else
    SKIP_UI=false
    cd "$UI_DIR"

    if [ ! -d "$UI_DIR/node_modules" ]; then
        info "npm bağımlılıkları yükleniyor (bu 1-2 dakika sürebilir)..."
        npm install --silent
        ok "npm bağımlılıkları yüklendi"
    else
        info "node_modules mevcut, güncelleme kontrol ediliyor..."
        npm install --silent 2>/dev/null || true
        ok "npm bağımlılıkları güncel"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 6 — Web UI production build
# ══════════════════════════════════════════════════════════════════════════════
step 6 "Web UI — production derleme"

if [ "$SKIP_UI" = false ]; then
    cd "$UI_DIR"
    info "npm run build çalıştırılıyor..."
    npm run build 2>&1 | grep -E "(✓|✘|error|Error|built|Done)" | head -10 || npm run build
    ok "Web UI derlendi: $UI_DIR/dist"
else
    warn "Web UI dizini yok — derleme atlandı"
fi

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 7 — Veritabanı başlatma
# ══════════════════════════════════════════════════════════════════════════════
step 7 "SQLite veritabanı başlatma"

if [ "$SKIP_UI" = false ]; then
    DB_FILE="$UI_DIR/data.db"
    if [ -f "$DB_FILE" ]; then
        ok "Veritabanı mevcut: $DB_FILE"
    else
        info "Veritabanı ilk kez Node.js server başlatıldığında oluşturulacak."
        ok "Veritabanı hazır (otomatik oluşturulacak)"
    fi
    chown "$BOT_USER:$BOT_USER" "$DB_FILE" 2>/dev/null || true
else
    warn "Web UI yok — veritabanı atlandı"
fi

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 8 — Systemd servisleri
# ══════════════════════════════════════════════════════════════════════════════
step 8 "Systemd servisleri oluşturuluyor"

VENV_PYTHON="$BOT_DIR/venv/bin/python"

if [ "${SKIP_SYSTEMD:-false}" = true ]; then
    warn "sudo yetkisi yok — systemd servisleri atlandı"
else

    # ── 8a. Python Bot Servisi ─────────────────────────────────────────────────
    info "ecy-s3cb0t-bot.service oluşturuluyor..."
    tee /etc/systemd/system/ecy-s3cb0t-bot.service > /dev/null << EOF
[Unit]
Description=EcY_S3CB0T — Telegram Güvenlik Botu
Documentation=https://github.com/ecy/secbot
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
User=${BOT_USER}
WorkingDirectory=${BOT_DIR}
ExecStart=${VENV_PYTHON} ${BOT_DIR}/bot.py
Restart=on-failure
RestartSec=20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ecy-s3cb0t-bot
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-${BOT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF
    ok "ecy-s3cb0t-bot.service oluşturuldu"

    # ── 8b. Web UI Servisi ─────────────────────────────────────────────────────
    if [ "$SKIP_UI" = false ]; then
        NODE_BIN=$(command -v node)
        info "ecy-s3cb0t-ui.service oluşturuluyor (port $UI_PORT)..."
        tee /etc/systemd/system/ecy-s3cb0t-ui.service > /dev/null << EOF
[Unit]
Description=EcY_S3CB0T — Web Yönetim Paneli
Documentation=https://github.com/ecy/secbot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${BOT_USER}
WorkingDirectory=${UI_DIR}
ExecStart=${NODE_BIN} ${UI_DIR}/dist/index.cjs
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ecy-s3cb0t-ui
Environment=NODE_ENV=production
Environment=PORT=${UI_PORT}
EnvironmentFile=-${BOT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF
        ok "ecy-s3cb0t-ui.service oluşturuldu (port $UI_PORT)"
    fi

    # Daemon yenile
    systemctl daemon-reload
    ok "systemd daemon reload edildi"
fi

# ══════════════════════════════════════════════════════════════════════════════
# ADIM 9 — Servisleri etkinleştir ve başlat
# ══════════════════════════════════════════════════════════════════════════════
step 9 "Servisler etkinleştiriliyor ve başlatılıyor"

if [ "${SKIP_SYSTEMD:-false}" = true ]; then
    warn "Systemd yok — servisleri elle başlatabilirsiniz (aşağıya bakın)"
else
    # Bot servisi
    systemctl enable ecy-s3cb0t-bot 2>/dev/null
    if systemctl is-active --quiet ecy-s3cb0t-bot; then
        info "Bot servisi yeniden başlatılıyor..."
        systemctl restart ecy-s3cb0t-bot
    else
        info "Bot servisi başlatılıyor..."
        systemctl start ecy-s3cb0t-bot
    fi
    sleep 2
    if systemctl is-active --quiet ecy-s3cb0t-bot; then
        ok "ecy-s3cb0t-bot → ÇALIŞIYOR"
    else
        warn "ecy-s3cb0t-bot başlamadı. .env değerlerini kontrol edin."
        warn "Log: journalctl -u ecy-s3cb0t-bot -n 20 --no-pager"
    fi

    # Web UI servisi
    if [ "$SKIP_UI" = false ]; then
        systemctl enable ecy-s3cb0t-ui 2>/dev/null
        if systemctl is-active --quiet ecy-s3cb0t-ui; then
            info "Web UI servisi yeniden başlatılıyor..."
            systemctl restart ecy-s3cb0t-ui
        else
            info "Web UI servisi başlatılıyor..."
            systemctl start ecy-s3cb0t-ui
        fi
        sleep 2
        if systemctl is-active --quiet ecy-s3cb0t-ui; then
            ok "ecy-s3cb0t-ui  → ÇALIŞIYOR"
        else
            warn "ecy-s3cb0t-ui başlamadı."
            warn "Log: journalctl -u ecy-s3cb0t-ui -n 20 --no-pager"
        fi
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Özet
# ══════════════════════════════════════════════════════════════════════════════

# Sunucu IP'si
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║              Kurulum Tamamlandı!                    ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""

if [ "$SKIP_UI" = false ]; then
    echo -e "  ${BOLD}Web Arayüzü:${RESET}  http://${SERVER_IP}:${UI_PORT}"
fi
echo -e "  ${BOLD}LLM Modu:${RESET}     $LLM_PROVIDER"
echo ""
echo -e "${BOLD}  Servis Komutları:${RESET}"
echo "  ┌─────────────────────────────────────────────────────"
echo "  │  Bot servisi"
echo "  │    sudo systemctl status  ecy-s3cb0t-bot"
echo "  │    sudo systemctl restart ecy-s3cb0t-bot"
echo "  │    journalctl -u ecy-s3cb0t-bot -f"
echo "  │"
if [ "$SKIP_UI" = false ]; then
    echo "  │  Web UI servisi"
    echo "  │    sudo systemctl status  ecy-s3cb0t-ui"
    echo "  │    sudo systemctl restart ecy-s3cb0t-ui"
    echo "  │    journalctl -u ecy-s3cb0t-ui -f"
    echo "  │"
fi
echo "  │  İkisini birden durdur / başlat"
echo "  │    sudo systemctl stop    ecy-s3cb0t-bot ecy-s3cb0t-ui"
echo "  │    sudo systemctl start   ecy-s3cb0t-bot ecy-s3cb0t-ui"
echo "  └─────────────────────────────────────────────────────"
echo ""

if grep -qE '^TELEGRAM_TOKEN=$' "$BOT_DIR/.env" 2>/dev/null; then
    echo -e "${YELLOW}  ⚠  .env dosyasındaki boş değerleri doldurmayı unutmayın:${RESET}"
    echo "     nano $BOT_DIR/.env"
    echo ""
fi

echo -e "  ${BOLD}Manuel çalıştırma (test için):${RESET}"
echo "    source $BOT_DIR/venv/bin/activate && python $BOT_DIR/bot.py"
if [ "$SKIP_UI" = false ]; then
    echo "    cd $UI_DIR && NODE_ENV=production node dist/index.cjs"
fi
echo ""
