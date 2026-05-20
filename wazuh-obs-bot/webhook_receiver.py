"""
webhook_receiver.py
Herhangi bir sistemin HTTP POST ile sinyal gönderebileceği basit webhook sunucusu.
Flask ile ayrı bir thread'de çalışır; bot.py tarafından import edilir.

Endpoint:
  POST /webhook          — JSON payload gönder
  POST /webhook/<source> — kaynak adı ile gönder (örn. /webhook/grafana)
  GET  /webhook/health   — sunucu sağlık kontrolü

Alınan webhook'lar son MAX_WEBHOOKS kadarı bellekte tutulur.
bot.py collect_all() sırasında get_pending_webhooks() ile alınır.
"""

import os
import json
import logging
import threading
from collections import deque
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("ecy-s3cb0t.webhook")

WEBHOOK_PORT   = int(os.getenv("WEBHOOK_PORT", "8080"))
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")   # boşsa auth yok
MAX_WEBHOOKS   = int(os.getenv("WEBHOOK_MAX_STORE", "200"))

# ── In-memory deque ────────────────────────────────────────────────────────────
_store: deque = deque(maxlen=MAX_WEBHOOKS)
_store_lock   = threading.Lock()

app = Flask(__name__)
log.setLevel(logging.WARNING)          # Flask kendi loglarını sustur


# ── Yardımcı ──────────────────────────────────────────────────────────────────

def _auth_ok() -> bool:
    """Bearer token veya X-Webhook-Secret başlığını kontrol eder."""
    if not WEBHOOK_SECRET:
        return True
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:] == WEBHOOK_SECRET
    return request.headers.get("X-Webhook-Secret", "") == WEBHOOK_SECRET


def _parse_severity(payload: dict, source: str) -> str:
    """Farklı formatlardaki severity/status alanını normalize eder."""
    # Grafana
    if "state" in payload:
        s = payload["state"].lower()
        if s in ("alerting", "firing", "critical"):  return "critical"
        if s in ("pending", "warning"):               return "warning"
        return "info"
    # Alertmanager webhook
    alerts = payload.get("alerts", [])
    if alerts:
        sevs = [a.get("labels", {}).get("severity", "").lower() for a in alerts]
        if any(s in ("critical", "error") for s in sevs): return "critical"
        if any(s == "warning" for s in sevs):              return "warning"
        return "info"
    # Generic
    sev = str(payload.get("severity", payload.get("level", payload.get("priority", "info")))).lower()
    if sev in ("critical", "error", "fatal", "high", "disaster"): return "critical"
    if sev in ("warning", "warn", "medium", "average"):           return "warning"
    return "info"


def _extract_title(payload: dict, source: str) -> str:
    for key in ("title", "message", "summary", "name", "alertname"):
        if key in payload and payload[key]:
            return str(payload[key])[:200]
    # Alertmanager: ilk alert adı
    alerts = payload.get("alerts", [])
    if alerts:
        return alerts[0].get("labels", {}).get("alertname", "Webhook Alarmı")
    return f"{source} webhook"


# ── UI sinyali push ───────────────────────────────────────────────────────────

def _push_to_ui(entry: dict):
    """Webhook'u Node.js UI'ye gönderir — sinyal listesinde görünmesi ve SSE için."""
    try:
        import requests as _req
        web_ui    = os.getenv("WEB_UI_API", "http://localhost:3000")
        bot_secret = os.getenv("BOT_SECRET", "")
        headers   = {"X-Bot-Secret": bot_secret} if bot_secret else {}
        _req.post(
            f"{web_ui}/api/signals",
            json={
                "source":   entry["source"],
                "severity": entry["severity"],
                "title":    entry["title"],
                "body":     entry.get("title"),
                "raw":      entry.get("raw"),
            },
            headers=headers,
            timeout=3,
        )
    except Exception:
        pass


# ── Flask rotaları ─────────────────────────────────────────────────────────────

@app.route("/webhook", methods=["POST"])
@app.route("/webhook/<source>", methods=["POST"])
def receive_webhook(source: str = "generic"):
    if not _auth_ok():
        return jsonify({"error": "Unauthorized"}), 401

    try:
        payload = request.get_json(force=True, silent=True) or {}
    except Exception:
        payload = {}

    entry = {
        "id":        f"{source}-{datetime.now(timezone.utc).timestamp():.0f}",
        "source":    source,
        "received":  datetime.now(timezone.utc).isoformat(),
        "severity":  _parse_severity(payload, source),
        "title":     _extract_title(payload, source),
        "raw":       payload,
        "consumed":  False,
    }

    with _store_lock:
        _store.append(entry)

    # UI API'sine arka planda gönder — webhook yanıtını bloke etmeden
    threading.Thread(target=_push_to_ui, args=(entry,), daemon=True).start()

    log.info("Webhook alındı: source=%s severity=%s title=%s",
             source, entry["severity"], entry["title"])
    return jsonify({"ok": True, "id": entry["id"]}), 200


@app.route("/webhook/health", methods=["GET"])
def health():
    with _store_lock:
        pending = sum(1 for e in _store if not e["consumed"])
    return jsonify({"ok": True, "pending": pending, "stored": len(_store)}), 200


# ── Bot tarafından kullanılan API ──────────────────────────────────────────────

def get_pending_webhooks(mark_consumed: bool = True) -> list[dict]:
    """
    Henüz işlenmemiş webhook'ları döner.
    mark_consumed=True ise bunları işlenmiş olarak işaretler
    (aynı alarmın bir sonraki raporda tekrar çıkmaması için).
    """
    with _store_lock:
        pending = [e for e in _store if not e["consumed"]]
        if mark_consumed:
            for e in pending:
                e["consumed"] = True
    return pending


def get_summary() -> dict:
    """collect_all() tarafından çağrılır; bekleyen webhook özeti döner."""
    pending = get_pending_webhooks(mark_consumed=True)

    critical = [e for e in pending if e["severity"] == "critical"]
    warning  = [e for e in pending if e["severity"] == "warning"]
    info     = [e for e in pending if e["severity"] == "info"]

    sources: dict[str, int] = {}
    for e in pending:
        sources[e["source"]] = sources.get(e["source"], 0) + 1

    return {
        "total":          len(pending),
        "critical_count": len(critical),
        "warning_count":  len(warning),
        "info_count":     len(info),
        "by_source":      sources,
        "critical_events": [{"title": e["title"], "source": e["source"],
                              "received": e["received"]} for e in critical[:10]],
        "warning_events":  [{"title": e["title"], "source": e["source"],
                              "received": e["received"]} for e in warning[:10]],
    }


# ── Daemon başlatıcı ───────────────────────────────────────────────────────────

_server_thread: threading.Thread | None = None


def start_webhook_server():
    """Flask sunucusunu daemon thread olarak başlatır. Birden fazla kez çağrılabilir."""
    global _server_thread
    if _server_thread and _server_thread.is_alive():
        return

    def _run():
        # Werkzeug development server — production için gunicorn kullanılabilir
        import logging as _l
        _l.getLogger("werkzeug").setLevel(_l.ERROR)
        app.run(host="0.0.0.0", port=WEBHOOK_PORT, threaded=True,
                use_reloader=False, debug=False)

    _server_thread = threading.Thread(target=_run, name="webhook-server", daemon=True)
    _server_thread.start()
    log.info("Webhook sunucusu başlatıldı — port %d", WEBHOOK_PORT)
