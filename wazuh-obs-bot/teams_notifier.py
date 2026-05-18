"""
teams_notifier.py
Microsoft Teams Incoming Webhook ile bildirim gönderir.
MessageCard (Legacy) formatı kullanır — tüm Teams sürümleriyle uyumlu.

Yapılandırma (.env):
  TEAMS_WEBHOOK_URL       — https://xxx.webhook.office.com/... (boş = devre dışı)
  TEAMS_ON_CRITICAL_ONLY  — 1 = yalnızca kritik içerikte gönder (varsayılan)
"""

import logging
import os
import re
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("ecy-s3cb0t.teams")

TEAMS_WEBHOOK_URL   = os.getenv("TEAMS_WEBHOOK_URL", "")
TEAMS_CRITICAL_ONLY = os.getenv("TEAMS_ON_CRITICAL_ONLY", "1") == "1"

ENABLED = bool(TEAMS_WEBHOOK_URL)

_CRITICAL_PAT = [
    r"🔴", r"🚨", r"\bcritical\b", r"\bdisaster\b",
    r"\bkritik\b", r"\bfelaket\b", r"FAILED", r"down\b",
]


def _has_critical(text: str) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in _CRITICAL_PAT)


def send_report(report_text: str) -> bool:
    """Raporu Teams'e gönderir."""
    if not ENABLED:
        return False
    if TEAMS_CRITICAL_ONLY and not _has_critical(report_text):
        log.debug("Teams: kritik içerik yok, atlandı.")
        return False

    ts      = datetime.now().strftime("%d.%m.%Y %H:%M")
    preview = report_text[:1500] + ("…" if len(report_text) > 1500 else "")

    payload = {
        "@type":      "MessageCard",
        "@context":   "https://schema.org/extensions",
        "themeColor": "f85149",
        "summary":    f"EcY_S3CB0T Güvenlik Raporu — {ts}",
        "sections": [{
            "activityTitle":    "🔐 EcY_S3CB0T Güvenlik Raporu",
            "activitySubtitle": ts,
            "text":             f"```\n{preview}\n```",
        }],
    }
    try:
        resp = requests.post(TEAMS_WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
        log.info("Teams: rapor gönderildi.")
        return True
    except Exception as e:
        log.error("Teams gönderim hatası: %s", e)
        return False


def send_alert(title: str, body: str, severity: str = "critical") -> bool:
    """Tek bir alarm için anlık Teams bildirimi gönderir."""
    if not ENABLED:
        return False

    color = {"critical": "f85149", "warning": "d29922", "info": "388bfd"}.get(severity, "888888")
    icon  = {"critical": "🔴",     "warning": "🟡",      "info": "🔵"}.get(severity,    "❓")
    ts    = datetime.now().strftime("%d.%m.%Y %H:%M")

    payload = {
        "@type":      "MessageCard",
        "@context":   "https://schema.org/extensions",
        "themeColor": color,
        "summary":    f"{icon} [{severity.upper()}] {title}",
        "sections": [{
            "activityTitle":    f"{icon} {title}",
            "activitySubtitle": f"{severity.upper()} — {ts} TSİ",
            "text":             body,
        }],
    }
    try:
        resp = requests.post(TEAMS_WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
        log.info("Teams: alert gönderildi → %s", title)
        return True
    except Exception as e:
        log.error("Teams alert gönderim hatası: %s", e)
        return False
