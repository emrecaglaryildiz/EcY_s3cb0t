"""
observium_collector.py
Observium Community Edition (24.x) — REST API yok.
Ana dashboard sayfasına (/) giriş yaparak HTML parse eder:
  • Özet tablo: Devices + Ports satırları (Total / Up / Alert/Down)
  • Alerts özet: Ok / Fail / Delay / Suppress sayaçları
  • "Status Warnings and Notifications" paneli: down/rebooted cihazlar + süre
  • "Alert Status" tablosu: Device / Entity / Alert mesajı / FAILED|WARNING / Change süresi
"""

import os
import re
import threading
import requests
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv

load_dotenv()

OBS_HOST = os.getenv("OBSERVIUM_HOST", "http://localhost").rstrip("/")
OBS_USER = os.getenv("OBSERVIUM_USER", "admin")
OBS_PASS = os.getenv("OBSERVIUM_PASS", "admin")

# ── Session yönetimi ──────────────────────────────────────────────────────────

_session: requests.Session | None = None
_session_lock = threading.Lock()


def _get_session() -> requests.Session:
    """Giriş yapılmış bir requests.Session döner. Zaten açıksa yeniden giriş yapmaz."""
    global _session
    with _session_lock:
        if _session is not None:
            return _session

        s = requests.Session()
        s.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        })

        # 1. Login sayfasını aç — hidden input / CSRF varsa al
        try:
            home = s.get(f"{OBS_HOST}/", allow_redirects=True, timeout=15)
            soup = BeautifulSoup(home.text, "html.parser")
            hidden = {}
            for inp in soup.find_all("input", {"type": "hidden"}):
                if inp.get("name"):
                    hidden[inp["name"]] = inp.get("value", "")
        except Exception:
            hidden = {}

        # 2. Login POST
        login_data = {
            "username": OBS_USER,
            "password": OBS_PASS,
            **hidden,
        }
        login_resp = s.post(
            f"{OBS_HOST}/login/",
            data=login_data,
            allow_redirects=True,
            timeout=15,
        )

        if login_resp.status_code >= 400:
            raise ConnectionError(
                f"Observium girişi başarısız: HTTP {login_resp.status_code}"
            )

        if "login" in login_resp.url.lower() and "incorrect" in login_resp.text.lower():
            raise PermissionError("Observium kullanıcı adı veya şifre yanlış")

        _session = s
        return s


def _reset_session():
    global _session
    with _session_lock:
        _session = None


def _get_page(path: str) -> BeautifulSoup:
    """Giriş yapılmış session ile bir sayfa çeker, BeautifulSoup döner."""
    s = _get_session()
    url = f"{OBS_HOST}{path}"
    r = s.get(url, allow_redirects=True, timeout=20)

    # Oturum süresi dolmuşsa yeniden giriş yap
    if "login" in r.url.lower() or r.status_code == 403:
        _reset_session()
        s = _get_session()
        r = s.get(url, allow_redirects=True, timeout=20)

    r.raise_for_status()
    return BeautifulSoup(r.text, "html.parser")


# ── Yardımcı: metin temizle ───────────────────────────────────────────────────

def _txt(tag) -> str:
    """Tag veya str'den temiz metin döner."""
    if tag is None:
        return ""
    if isinstance(tag, str):
        return tag.strip()
    return tag.get_text(separator=" ", strip=True)


# ── Dashboard özet tablosu ────────────────────────────────────────────────────

def _parse_summary_table(soup: BeautifulSoup) -> dict:
    """
    Dashboard'daki "Total / Up / Alert / Ignored / Disabled" tablosunu parse eder.
    Devices ve Ports satırlarını döner.

    Observium CE 24.x'te tablo yapısı:
      <table>
        <thead><tr><th/><th>Total</th><th>Up</th><th>Alert</th>...</tr></thead>
        <tbody>
          <tr><td>Devices</td><td>122</td><td>120 up</td><td>2 down</td>...</tr>
          <tr><td>Ports</td>  <td>1193</td><td>1073 up</td><td>88 down</td>...</tr>
        </tbody>
      </table>
    Sütun başlıkları "Total", "Up", "Alert" içerir.
    """
    result = {
        "devices": {"total": 0, "up": 0, "down": 0, "ignored": 0, "disabled": 0},
        "ports":   {"total": 0, "up": 0, "down": 0, "ignored": 0, "disabled": 0},
    }

    # Tüm tabloları tara — "Total" ve "Up" başlığı olan tabloyu bul
    for table in soup.find_all("table"):
        headers = [_txt(th).lower() for th in table.find_all("th")]
        if "total" not in headers or "up" not in headers:
            continue

        # Sütun indekslerini belirle
        def _col(name):
            for i, h in enumerate(headers):
                if name in h:
                    return i
            return -1

        col_total    = _col("total")
        col_up       = _col("up")
        col_alert    = _col("alert")
        col_ignored  = _col("ignored")
        col_disabled = _col("disabled")

        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if not cells:
                continue
            row_label = _txt(cells[0]).lower()

            def _num(idx):
                if idx < 0 or idx >= len(cells):
                    return 0
                return int(re.search(r"\d+", _txt(cells[idx]) or "0").group()
                           if re.search(r"\d+", _txt(cells[idx]) or "0") else "0")

            if "device" in row_label:
                result["devices"] = {
                    "total":    _num(col_total),
                    "up":       _num(col_up),
                    "down":     _num(col_alert),   # "Alert" = down/alert cihazlar
                    "ignored":  _num(col_ignored),
                    "disabled": _num(col_disabled),
                }
            elif "port" in row_label:
                result["ports"] = {
                    "total":    _num(col_total),
                    "up":       _num(col_up),
                    "down":     _num(col_alert),   # "Alert" = down/alert portlar
                    "ignored":  _num(col_ignored),
                    "disabled": _num(col_disabled),
                }
        break  # doğru tabloyu bulduk

    return result


# ── Alerts özet sayaçları ─────────────────────────────────────────────────────

def _parse_alerts_summary(soup: BeautifulSoup) -> dict:
    """
    Dashboard sağ üst köşedeki Alerts özet tablosunu parse eder.
    Sütunlar: Ok | Fail | Delay | Suppress | Other

    Observium CE 24.x'te bu tablo ayrı bir panel içinde:
      <table>
        <thead><tr><th/><th>Ok</th><th>Fail</th><th>Delay</th><th>Suppress</th>...</tr></thead>
        <tbody><tr><td>Alerts</td><td>709</td><td>16</td><td>0</td><td>0</td>...</tr></tbody>
      </table>
    """
    result = {"ok": 0, "fail": 0, "delay": 0, "suppress": 0, "other": 0}

    for table in soup.find_all("table"):
        headers = [_txt(th).lower() for th in table.find_all("th")]
        if "fail" not in headers or "ok" not in headers:
            continue

        def _col(name):
            for i, h in enumerate(headers):
                if name in h:
                    return i
            return -1

        col_ok       = _col("ok")
        col_fail     = _col("fail")
        col_delay    = _col("delay")
        col_suppress = _col("suppress")
        col_other    = _col("other")

        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if not cells:
                continue
            row_label = _txt(cells[0]).lower()
            if "alert" not in row_label:
                continue

            def _num(idx):
                if idx < 0 or idx >= len(cells):
                    return 0
                m = re.search(r"\d+", _txt(cells[idx]) or "0")
                return int(m.group()) if m else 0

            result = {
                "ok":       _num(col_ok),
                "fail":     _num(col_fail),
                "delay":    _num(col_delay),
                "suppress": _num(col_suppress),
                "other":    _num(col_other),
            }
        break

    return result


# ── Status Warnings and Notifications ─────────────────────────────────────────

def _parse_status_warnings(soup: BeautifulSoup) -> list[dict]:
    """
    "Status Warnings and Notifications" panelini parse eder.

    Observium CE 24.x yapısı (screenshot'tan):
      <div> içinde başlık "Status Warnings and Notifications" var
      Her satır:
        <device_link>  <badge "Device Down"|"Device Rebooted">  <icon>  <device_link>  <mesaj> <süre>
      Badge rengi:
        kırmızı/danger → "Device Down"
        mavi/info      → "Device Rebooted"

    Fallback: metin içinde "Device Down" veya "Device Rebooted" badge ara.
    """
    warnings = []

    # 1. Panel başlığını bul, ardından parent container'ı al
    heading = None
    for tag in soup.find_all(string=re.compile(r"Status Warnings and Notifications", re.I)):
        heading = tag
        break

    container = None
    if heading:
        parent = heading.parent
        # Üst container'ı bul (birkaç seviye yukarı)
        for _ in range(5):
            if parent and parent.name in ("div", "section", "article", "td"):
                container = parent
                break
            if parent:
                parent = parent.parent

    search_scope = container if container else soup

    # 2. Rozetleri (badge) tara
    # Observium CE "Device Down" için kırmızı label/span/badge kullanır
    # Her badge'in parent row'unda hostname, süre bilgisi olur

    # Badge içeren satırları bul
    badge_patterns = re.compile(r"Device Down|Device Rebooted|Cihaz Çevrimdışı|Down|Rebooted", re.I)

    processed_hostnames = set()

    for badge in search_scope.find_all(["span", "label", "a", "small"],
                                        string=badge_patterns):
        badge_text = _txt(badge)

        # Badge'in class'ından severity belirle
        badge_cls = " ".join(badge.get("class", []))
        if any(c in badge_cls for c in ["danger", "red", "down", "label-danger"]):
            status = "down"
        elif any(c in badge_cls for c in ["info", "blue", "rebooted", "label-info", "label-primary"]):
            status = "rebooted"
        elif any(c in badge_cls for c in ["warning", "orange", "label-warning"]):
            status = "warning"
        else:
            status = "down" if "down" in badge_text.lower() else "rebooted"

        # Satır/container bul
        row_tag = badge.parent
        for _ in range(4):
            if row_tag and row_tag.name in ("tr", "li", "div"):
                break
            if row_tag:
                row_tag = row_tag.parent

        if not row_tag:
            continue

        row_text = _txt(row_tag)

        # Hostname: badge önceki <a> veya badge'den önce gelen metin
        hostname = ""
        # Badge'in sol tarafındaki <a> linkler hostname adayı
        for a_tag in row_tag.find_all("a"):
            candidate = _txt(a_tag)
            if candidate and len(candidate) > 1 and candidate.lower() not in ("device", ""):
                hostname = candidate
                break

        if not hostname:
            # Metin parçalarını al, badge metninden öncekini hostname say
            parts = [p.strip() for p in row_text.split() if p.strip()]
            if parts:
                hostname = parts[0]

        if not hostname or hostname in processed_hostnames:
            continue
        processed_hostnames.add(hostname)

        # Süre: "Xh Xm Xs" veya "Xd Xh Xm" pattern
        duration_match = re.search(
            r"(\d+d\s*\d+h\s*\d+m|\d+h\s*\d+m\s*\d+s|\d+h\s*\d+m|\d+d\s*\d+h|\d+\s*days?)",
            row_text,
            re.I,
        )
        duration = duration_match.group().strip() if duration_match else ""

        # Mesaj
        message = ""
        if "down" in row_text.lower():
            # "Down (PING)" gibi kısmı yakala
            msg_match = re.search(r"Down\s*\([^)]+\)", row_text, re.I)
            if msg_match:
                message = msg_match.group()
            else:
                message = "Down"
        elif "rebooted" in badge_text.lower() or "reboot" in row_text.lower():
            message = "Rebooted"

        warnings.append({
            "hostname": hostname,
            "status":   status,
            "badge":    badge_text.strip(),
            "message":  message,
            "duration": duration,
        })

    return warnings


# ── Alert Status tablosu ──────────────────────────────────────────────────────

def _parse_alert_status_table(soup: BeautifulSoup) -> list[dict]:
    """
    "Alert Status" tablosunu parse eder.

    Observium CE 24.x — sütunlar: Device | Entity | Alert | Status | Change

    Status badge renkleri:
      kırmızı/danger → FAILED   (severity: critical)
      turuncu/warning → WARNING (severity: warning)
    """
    alerts = []

    # "Alert Status" başlıklı panel veya tabloyu bul
    # Başlık metni içeren elementi ara
    heading = None
    for tag in soup.find_all(string=re.compile(r"Alert Status", re.I)):
        heading = tag
        break

    # Heading'den en yakın tabloyu bul
    target_table = None
    if heading:
        parent = heading.parent
        for _ in range(10):
            if parent is None:
                break
            table = parent.find("table")
            if table:
                target_table = table
                break
            parent = parent.parent

    # Bulunamadıysa — Device|Entity|Alert başlıklı tabloyu tüm sayfada ara
    if not target_table:
        for table in soup.find_all("table"):
            headers = [_txt(th).lower() for th in table.find_all("th")]
            if "device" in headers and "alert" in headers and "status" in headers:
                target_table = table
                break

    if not target_table:
        return alerts

    # Sütun indekslerini belirle
    header_row = target_table.find("tr")
    if not header_row:
        return alerts
    headers = [_txt(th).lower() for th in header_row.find_all(["th", "td"])]

    def _col(name):
        for i, h in enumerate(headers):
            if name in h:
                return i
        return -1

    col_device = _col("device")
    col_entity = _col("entity")
    col_alert  = _col("alert")
    col_status = _col("status")
    col_change = _col("change")

    # Fallback indeksler (Observium tipik sıra)
    if col_device < 0: col_device = 0
    if col_entity < 0: col_entity = 1
    if col_alert  < 0: col_alert  = 2
    if col_status < 0: col_status = 3
    if col_change < 0: col_change = 4

    for row in target_table.find_all("tr"):
        cells = row.find_all("td")
        if not cells or len(cells) < 3:
            continue

        def _cell_txt(idx):
            if idx < 0 or idx >= len(cells):
                return ""
            return _txt(cells[idx])

        device  = _cell_txt(col_device)
        entity  = _cell_txt(col_entity)
        message = _cell_txt(col_alert)
        change  = _cell_txt(col_change)

        # Hostname: <a> linkten al
        if col_device >= 0 and col_device < len(cells):
            a = cells[col_device].find("a")
            if a:
                device = _txt(a)

        if not device or len(device) < 2:
            continue

        # Severity: status cell'den badge class'ına bak
        severity = "alert"
        status_text = ""
        if col_status >= 0 and col_status < len(cells):
            status_cell = cells[col_status]
            status_text = _txt(status_cell)
            status_cls = " ".join(status_cell.get("class", []))

            # Badge/span içindeki class'a da bak
            badge = status_cell.find(["span", "label", "div", "b"])
            badge_cls = " ".join(badge.get("class", [])) if badge else ""

            combined_cls = (status_cls + " " + badge_cls).lower()

            if any(c in combined_cls for c in ["danger", "red", "failed", "critical"]):
                severity = "critical"
            elif any(c in combined_cls for c in ["warning", "orange", "warn"]):
                severity = "warning"
            elif any(c in combined_cls for c in ["ok", "success", "green"]):
                severity = "ok"
            else:
                # Metin bazlı fallback
                st_lower = status_text.lower()
                if "fail" in st_lower or "critical" in st_lower:
                    severity = "critical"
                elif "warn" in st_lower:
                    severity = "warning"
                elif "ok" in st_lower:
                    severity = "ok"

        # Tablo satırı class'ından da dene
        row_cls = " ".join(row.get("class", [])).lower()
        if severity == "alert":
            if "danger" in row_cls or "failed" in row_cls:
                severity = "critical"
            elif "warning" in row_cls:
                severity = "warning"

        alerts.append({
            "device":   device,
            "entity":   entity,
            "message":  message,
            "status":   status_text or severity.upper(),
            "severity": severity,
            "change":   change,
        })

    return alerts


# ── Ana dashboard toplayıcı ───────────────────────────────────────────────────

def get_dashboard_summary() -> dict:
    """
    Observium CE ana dashboard'unu (/) parse eder.
    Tek seferde tüm kritik verileri döner:
      - summary: devices + ports sayaçları
      - alerts_overview: ok/fail/delay/suppress
      - status_warnings: çevrimdışı/rebooted cihazlar
      - alert_status: aktif alarm listesi
    """
    try:
        soup = _get_page("/")

        summary        = _parse_summary_table(soup)
        alerts_overview = _parse_alerts_summary(soup)
        status_warnings = _parse_status_warnings(soup)
        alert_status    = _parse_alert_status_table(soup)

        # Kritik sayıları hesapla
        failed_count  = sum(1 for a in alert_status if a["severity"] == "critical")
        warning_count = sum(1 for a in alert_status if a["severity"] == "warning")
        down_devices  = [w for w in status_warnings if w["status"] == "down"]

        return {
            "summary":         summary,
            "alerts_overview": alerts_overview,
            "status_warnings": status_warnings,
            "alert_status":    alert_status,
            # Kısayol erişim alanları (get_summary() uyumluluğu için)
            "total_devices":   summary["devices"]["total"],
            "devices_up":      summary["devices"]["up"],
            "devices_down":    summary["devices"]["down"],
            "total_ports":     summary["ports"]["total"],
            "ports_up":        summary["ports"]["up"],
            "ports_down":      summary["ports"]["down"],
            "alerts_fail":     alerts_overview["fail"],
            "alerts_ok":       alerts_overview["ok"],
            "failed_count":    failed_count,
            "warning_count":   warning_count,
            "down_devices":    down_devices,
        }

    except Exception as e:
        return {
            "error": str(e),
            "total_devices": 0, "devices_up": 0, "devices_down": 0,
            "total_ports": 0,   "ports_up": 0,   "ports_down": 0,
            "alerts_fail": 0,   "alerts_ok": 0,
            "failed_count": 0, "warning_count": 0,
            "down_devices": [], "alert_status": [], "status_warnings": [],
            "summary": {}, "alerts_overview": {},
        }


# ── Eski API uyumluluğu (bot.py ve web routes hâlâ bunları kullanabilir) ──────

def get_device_status() -> dict:
    """
    Dashboard'dan cihaz durumunu döner.
    get_dashboard_summary() sonucunu eski formata çevirir.
    """
    try:
        data = get_dashboard_summary()
        if "error" in data:
            return {
                "error": data["error"],
                "total_devices": 0, "up_count": 0, "down_count": 0, "down_devices": [],
            }

        return {
            "total_devices": data["total_devices"],
            "up_count":      data["devices_up"],
            "down_count":    data["devices_down"],
            "down_devices":  [
                {
                    "hostname": w["hostname"],
                    "status":   w["status"],
                    "duration": w["duration"],
                    "message":  w["message"],
                    "os": "", "location": "",
                }
                for w in data["status_warnings"] if w["status"] == "down"
            ],
            "rebooted_devices": [
                {
                    "hostname": w["hostname"],
                    "duration": w["duration"],
                }
                for w in data["status_warnings"] if w["status"] == "rebooted"
            ],
        }
    except Exception as e:
        return {"error": str(e), "total_devices": 0, "up_count": 0,
                "down_count": 0, "down_devices": []}


def get_alerts() -> dict:
    """
    Dashboard'dan aktif alarm özetini döner (Alert Status tablosu).
    """
    try:
        data = get_dashboard_summary()
        if "error" in data:
            return {"error": data["error"], "active_alerts": 0, "alert_list": []}

        alert_list = data.get("alert_status", [])
        return {
            "active_alerts": len(alert_list),
            "failed":        data["failed_count"],
            "warning":       data["warning_count"],
            "alert_list":    alert_list[:30],
            "overview":      data.get("alerts_overview", {}),
        }
    except Exception as e:
        return {"error": str(e), "active_alerts": 0, "alert_list": []}


def get_port_errors() -> dict:
    """
    Dashboard özet tablosundan port bilgilerini döner.
    Down port sayısı için /ports/ sayfasına ayrıca gidilir.
    """
    try:
        # Önce dashboard özet tablosundaki port sayısını dene (hızlı)
        data = get_dashboard_summary()
        if "error" not in data and data["ports_down"] > 0:
            return {
                "down_ports":  data["ports_down"],
                "total_ports": data["total_ports"],
                "ports_up":    data["ports_up"],
                "port_list":   [],  # Detay için /ports/ sayfasına bakılmalı
                "note":        "Dashboard özet tablosundan alındı",
            }

        # Fallback: /ports/ sayfasını parse et
        soup = _get_page("/ports/?ifOperStatus=down&pagesize=50")
        down_ports = []
        for row in soup.select("table tr"):
            cells = row.find_all("td")
            if not cells or len(cells) < 3:
                continue
            texts = [_txt(c) for c in cells]
            device    = texts[0] if texts else "?"
            interface = texts[1] if len(texts) > 1 else "?"
            speed     = texts[2] if len(texts) > 2 else "?"
            a = cells[0].find("a")
            if a:
                device = _txt(a)
            if len(device) < 2:
                continue
            down_ports.append({"device": device, "interface": interface, "speed": speed})

        return {
            "down_ports": len(down_ports),
            "port_list":  down_ports[:15],
        }

    except Exception as e:
        return {"error": str(e), "down_ports": 0, "port_list": []}


def get_recent_events(limit: int = 20) -> dict:
    """
    /eventlog/ sayfasından son olayları okur.
    """
    try:
        soup = _get_page("/eventlog/")
        events = []
        for row in soup.select("table tr"):
            cells = row.find_all("td")
            if not cells or len(cells) < 3:
                continue
            texts = [_txt(c) for c in cells]
            events.append({
                "time":    texts[0] if texts else "",
                "device":  texts[1] if len(texts) > 1 else "",
                "message": " | ".join(texts[2:]) if len(texts) > 2 else "",
            })
            if len(events) >= limit:
                break
        return {"event_count": len(events), "events": events}
    except Exception as e:
        return {"error": str(e), "event_count": 0, "events": []}


# ── Hızlı özet (bot.py tarafından çağrılır) ──────────────────────────────────

def get_summary(config: dict = None) -> dict:
    """
    Tek seferde giriş yaparak tüm verileri toplar.
    bot.py ve web UI routes bunu kullanır.
    """
    global OBS_HOST, OBS_USER, OBS_PASS
    if config:
        new_host = (config.get("obs_host") or "").rstrip("/")
        new_user = config.get("obs_user") or ""
        new_pass = config.get("obs_pass") or ""
        if new_host and new_host != OBS_HOST:
            OBS_HOST = new_host
            _reset_session()
        if new_user and new_user != OBS_USER:
            OBS_USER = new_user
            _reset_session()
        if new_pass and new_pass != OBS_PASS:
            OBS_PASS = new_pass
            _reset_session()

    dashboard = get_dashboard_summary()

    # Eski uyumluluk katmanı — devices / alerts / ports anahtarları
    if "error" in dashboard:
        empty = {"error": dashboard["error"]}
        return {
            "dashboard": dashboard,
            "devices": {**empty, "total_devices": 0, "up_count": 0,
                        "down_count": 0, "down_devices": []},
            "alerts":  {**empty, "active_alerts": 0, "alert_list": []},
            "ports":   {**empty, "down_ports": 0, "port_list": []},
        }

    return {
        "dashboard": dashboard,
        "devices": {
            "total_devices": dashboard["total_devices"],
            "up_count":      dashboard["devices_up"],
            "down_count":    dashboard["devices_down"],
            "down_devices":  [
                {"hostname": w["hostname"], "status": w["status"],
                 "duration": w["duration"], "message": w["message"],
                 "os": "", "location": ""}
                for w in dashboard.get("status_warnings", []) if w["status"] == "down"
            ],
        },
        "alerts": {
            "active_alerts": len(dashboard.get("alert_status", [])),
            "failed":        dashboard["failed_count"],
            "warning":       dashboard["warning_count"],
            "alert_list":    dashboard.get("alert_status", [])[:30],
            "overview":      dashboard.get("alerts_overview", {}),
        },
        "ports": {
            "down_ports":  dashboard["ports_down"],
            "total_ports": dashboard["total_ports"],
            "ports_up":    dashboard["ports_up"],
            "port_list":   [],
        },
    }
