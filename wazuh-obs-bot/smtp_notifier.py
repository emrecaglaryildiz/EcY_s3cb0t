"""
smtp_notifier.py
Şirket SMTP sunucusu üzerinden e-posta bildirimi gönderir.

Yapılandırma (.env):
  SMTP_HOST             — SMTP sunucu adresi (boş = devre dışı)
  SMTP_PORT             — Port: 587 (STARTTLS, varsayılan) | 465 (SSL) | 25
  SMTP_USER             — Kullanıcı adı / gönderici
  SMTP_PASS             — Şifre
  SMTP_FROM             — Gönderici adres (boş = SMTP_USER)
  SMTP_TO               — Alıcılar (virgülle ayrılmış)
  SMTP_TLS              — 1 = STARTTLS kullan (varsayılan), 0 = düz
  SMTP_ON_CRITICAL_ONLY — 1 = yalnızca kritik içerik varsa gönder
"""

import logging
import os
import smtplib
import re
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText
from datetime             import datetime
from dotenv               import load_dotenv

load_dotenv()

log = logging.getLogger("ecy-s3cb0t.smtp")

SMTP_HOST        = os.getenv("SMTP_HOST", "")
SMTP_PORT        = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER        = os.getenv("SMTP_USER", "")
SMTP_PASS        = os.getenv("SMTP_PASS", "")
SMTP_FROM        = os.getenv("SMTP_FROM", "") or SMTP_USER
SMTP_TO_RAW      = os.getenv("SMTP_TO", "")
SMTP_TLS         = os.getenv("SMTP_TLS", "1") == "1"
CRITICAL_ONLY    = os.getenv("SMTP_ON_CRITICAL_ONLY", "1") == "1"

ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_TO_RAW)


def _recipients() -> list[str]:
    return [r.strip() for r in SMTP_TO_RAW.split(",") if r.strip()]


def _has_critical(text: str) -> bool:
    """Rapor metninde kritik göstergeler var mı?"""
    patterns = [
        r"🔴", r"🚨", r"\bcritical\b", r"\bdisaster\b",
        r"\bkritik\b", r"\bfelaket\b", r"FAILED", r"down\b",
    ]
    for p in patterns:
        if re.search(p, text, re.IGNORECASE):
            return True
    return False


def _markdown_to_html(text: str) -> str:
    """Telegram Markdown'ı basit HTML'e çevirir."""
    import html as _html
    text = _html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\*(.+?)\*",     r"<strong>\1</strong>", text)
    text = re.sub(r"`(.+?)`",       r"<code>\1</code>",     text)
    text = text.replace("\n", "<br>")
    return f"<html><body style='font-family:monospace;'>{text}</body></html>"


def send_report(report_text: str, subject: str = "") -> bool:
    """
    Raporu e-posta olarak gönderir.
    SMTP devre dışıysa veya CRITICAL_ONLY=1 ve kritik yoksa sessizce atlar.
    Başarı durumunda True, hata/atlanma durumunda False döner.
    """
    if not ENABLED:
        return False

    if CRITICAL_ONLY and not _has_critical(report_text):
        log.debug("SMTP: kritik içerik yok, e-posta atlandı.")
        return False

    ts = datetime.now().strftime("%d.%m.%Y %H:%M")
    subject = subject or f"[EcY_S3CB0T] Güvenlik Raporu — {ts}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = SMTP_FROM
    msg["To"]      = ", ".join(_recipients())

    # Düz metin versiyonu
    msg.attach(MIMEText(report_text, "plain", "utf-8"))
    # HTML versiyonu
    msg.attach(MIMEText(_markdown_to_html(report_text), "html", "utf-8"))

    try:
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as srv:
                srv.login(SMTP_USER, SMTP_PASS)
                srv.sendmail(SMTP_FROM, _recipients(), msg.as_string())
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as srv:
                srv.ehlo()
                if SMTP_TLS:
                    srv.starttls()
                    srv.ehlo()
                if SMTP_USER and SMTP_PASS:
                    srv.login(SMTP_USER, SMTP_PASS)
                srv.sendmail(SMTP_FROM, _recipients(), msg.as_string())

        log.info("SMTP: rapor gönderildi → %s", ", ".join(_recipients()))
        return True

    except smtplib.SMTPAuthenticationError:
        log.error("SMTP kimlik doğrulama hatası — kullanıcı/şifre kontrol edin.")
    except smtplib.SMTPConnectError as e:
        log.error("SMTP bağlantı hatası: %s", e)
    except Exception as e:
        log.error("SMTP gönderim hatası: %s", e)
    return False


def send_alert(title: str, body: str, severity: str = "critical") -> bool:
    """
    Tek bir alarm/sinyal için acil e-posta gönderir.
    Zamanlanmış rapordan bağımsız, anlık uyarı için kullanılır.
    """
    if not ENABLED:
        return False

    icon  = {"critical": "🔴", "warning": "🟡", "info": "🔵"}.get(severity, "❓")
    ts    = datetime.now().strftime("%d.%m.%Y %H:%M")
    text  = f"{icon} [{severity.upper()}] {title}\n\n{body}\n\n⏱ {ts} TSİ"
    subject = f"[EcY_S3CB0T] {icon} {title[:80]}"
    return send_report(text, subject=subject)


def test_connection() -> dict:
    """SMTP bağlantısını test eder."""
    if not ENABLED:
        return {"ok": False, "message": "SMTP_HOST, SMTP_USER veya SMTP_TO tanımlı değil"}
    try:
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10) as srv:
                srv.login(SMTP_USER, SMTP_PASS)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as srv:
                srv.ehlo()
                if SMTP_TLS:
                    srv.starttls()
                if SMTP_USER and SMTP_PASS:
                    srv.login(SMTP_USER, SMTP_PASS)
        return {"ok": True, "message": f"SMTP bağlantısı başarılı: {SMTP_HOST}:{SMTP_PORT}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
