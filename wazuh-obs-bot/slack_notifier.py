"""
slack_notifier.py
Slack Incoming Webhook ile bildirim gönderir.

Yapılandırma (.env):
  SLACK_WEBHOOK_URL       — https://hooks.slack.com/... (boş = devre dışı)
  SLACK_CHANNEL           — Kanal override (#kanal veya @kullanici), opsiyonel
  SLACK_ON_CRITICAL_ONLY  — 1 = yalnızca kritik içerikte gönder (varsayılan)
"""

import logging
import os
import re
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("ecy-s3cb0t.slack")

SLACK_WEBHOOK_URL   = os.getenv("SLACK_WEBHOOK_URL", "")
SLACK_CHANNEL       = os.getenv("SLACK_CHANNEL", "")
SLACK_CRITICAL_ONLY = os.getenv("SLACK_ON_CRITICAL_ONLY", "1") == "1"

ENABLED = bool(SLACK_WEBHOOK_URL)

_CRITICAL_PAT = [
    r"🔴", r"🚨", r"\bcritical\b", r"\bdisaster\b",
    r"\bkritik\b", r"\bfelaket\b", r"FAILED", r"down\b",
]


def _has_critical(text: str) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in _CRITICAL_PAT)


def send_report(report_text: str) -> bool:
    """Raporu Slack'e gönderir."""
    if not ENABLED:
        return False
    if SLACK_CRITICAL_ONLY and not _has_critical(report_text):
        log.debug("Slack: kritik içerik yok, atlandı.")
        return False

    ts      = datetime.now().strftime("%d.%m.%Y %H:%M")
    preview = report_text[:2900] + ("…" if len(report_text) > 2900 else "")

    payload: dict = {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": f"🔐 EcY_S3CB0T Güvenlik Raporu — {ts}"},
            },
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": preview},
            },
        ]
    }
    if SLACK_CHANNEL:
        payload["channel"] = SLACK_CHANNEL

    try:
        resp = requests.post(SLACK_WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
        log.info("Slack: rapor gönderildi.")
        return True
    except Exception as e:
        log.error("Slack gönderim hatası: %s", e)
        return False


def send_alert(title: str, body: str, severity: str = "critical") -> bool:
    """Tek bir alarm için anlık Slack bildirimi gönderir."""
    if not ENABLED:
        return False

    color = {"critical": "#f85149", "warning": "#d29922", "info": "#388bfd"}.get(severity, "#888888")
    icon  = {"critical": "🔴",      "warning": "🟡",       "info":  "🔵"}.get(severity,     "❓")
    ts    = datetime.now().strftime("%d.%m.%Y %H:%M")

    payload: dict = {
        "attachments": [{
            "color": color,
            "blocks": [
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*{icon} [{severity.upper()}] {title}*"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": body}},
                {"type": "context", "elements": [{"type": "mrkdwn", "text": f"⏱ {ts} TSİ"}]},
            ],
        }]
    }
    if SLACK_CHANNEL:
        payload["channel"] = SLACK_CHANNEL

    try:
        resp = requests.post(SLACK_WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
        log.info("Slack: alert gönderildi → %s", title)
        return True
    except Exception as e:
        log.error("Slack alert gönderim hatası: %s", e)
        return False
