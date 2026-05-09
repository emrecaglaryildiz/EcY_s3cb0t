"""
prometheus_collector.py
Prometheus HTTP API ve Alertmanager'dan aktif firing alert'leri toplar.
Her iki kaynak opsiyoneldir; PROMETHEUS_HOST veya ALERTMANAGER_HOST
tanımlıysa ilgili endpoint sorgulanır.
"""

import os
import requests
import urllib3
from dotenv import load_dotenv

load_dotenv()
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

PROMETHEUS_HOST   = os.getenv("PROMETHEUS_HOST", "").rstrip("/")
ALERTMANAGER_HOST = os.getenv("ALERTMANAGER_HOST", "").rstrip("/")
PROM_USER         = os.getenv("PROMETHEUS_USER", "")
PROM_PASS         = os.getenv("PROMETHEUS_PASS", "")
VERIFY_SSL        = os.getenv("PROMETHEUS_VERIFY_SSL", "0") == "1"
TIMEOUT           = int(os.getenv("PROMETHEUS_TIMEOUT", "15"))

SEVERITY_ORDER = ["critical", "error", "fatal", "warning", "warn", "info", "none"]


def _auth():
    return (PROM_USER, PROM_PASS) if PROM_USER else None


def _sev_group(severity: str) -> str:
    s = severity.lower()
    if s in ("critical", "error", "fatal"):
        return "critical"
    if s in ("warning", "warn"):
        return "warning"
    return "info"


def _format_alert(a: dict) -> dict:
    labels = a.get("labels", {})
    annots = a.get("annotations", {})
    return {
        "name":        labels.get("alertname", "?"),
        "severity":    labels.get("severity", "none"),
        "severity_group": _sev_group(labels.get("severity", "")),
        "instance":    labels.get("instance", labels.get("job", "?")),
        "namespace":   labels.get("namespace", ""),
        "summary":     annots.get("summary", annots.get("message", "")),
        "description": annots.get("description", ""),
        "started_at":  a.get("activeAt", a.get("startsAt", "")),
        "labels":      labels,
    }


# ── Prometheus /api/v1/alerts ──────────────────────────────────────────────────

def _get_prometheus_firing() -> list[dict]:
    if not PROMETHEUS_HOST:
        return []
    try:
        r = requests.get(
            f"{PROMETHEUS_HOST}/api/v1/alerts",
            auth=_auth(),
            verify=VERIFY_SSL,
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        alerts = r.json().get("data", {}).get("alerts", [])
        return [a for a in alerts if a.get("state") == "firing"]
    except Exception as e:
        return [{"_error": str(e), "_source": "prometheus"}]


# ── Alertmanager /api/v2/alerts ────────────────────────────────────────────────

def _get_alertmanager_firing() -> list[dict]:
    if not ALERTMANAGER_HOST:
        return []
    try:
        r = requests.get(
            f"{ALERTMANAGER_HOST}/api/v2/alerts",
            params={"active": "true", "silenced": "false", "inhibited": "false"},
            auth=_auth(),
            verify=VERIFY_SSL,
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json() if isinstance(r.json(), list) else []
    except Exception as e:
        return [{"_error": str(e), "_source": "alertmanager"}]


# ── Toplu özet ────────────────────────────────────────────────────────────────

def get_summary() -> dict:
    """Prometheus + Alertmanager firing alert özeti."""
    prom_raw = _get_prometheus_firing()
    am_raw   = _get_alertmanager_firing()

    errors = [a["_error"] for a in prom_raw + am_raw if "_error" in a]
    firing_raw = [a for a in prom_raw + am_raw if "_error" not in a]

    # Alertname bazında deduplikasyon (Prometheus + AM aynı alarmı ikinci kez vermesin)
    seen: set[str] = set()
    firing: list[dict] = []
    for a in firing_raw:
        key = a.get("labels", {}).get("alertname", "") + "|" + a.get("labels", {}).get("instance", "")
        if key not in seen:
            seen.add(key)
            firing.append(a)

    formatted = [_format_alert(a) for a in firing]

    critical = [f for f in formatted if f["severity_group"] == "critical"]
    warning  = [f for f in formatted if f["severity_group"] == "warning"]
    info     = [f for f in formatted if f["severity_group"] == "info"]

    return {
        "total_firing":    len(formatted),
        "critical_count":  len(critical),
        "warning_count":   len(warning),
        "info_count":      len(info),
        "critical_alerts": critical[:15],
        "warning_alerts":  warning[:15],
        "info_alerts":     info[:5],
        "errors":          errors if errors else None,
        "sources_active": {
            "prometheus":   bool(PROMETHEUS_HOST),
            "alertmanager": bool(ALERTMANAGER_HOST),
        },
    }


# ── Bağlantı testi ────────────────────────────────────────────────────────────

def test_connection(host: str = "", kind: str = "prometheus") -> dict:
    h = host.rstrip("/") if host else (PROMETHEUS_HOST if kind == "prometheus" else ALERTMANAGER_HOST)
    if not h:
        return {"ok": False, "message": f"{kind.upper()}_HOST tanımlı değil"}
    try:
        if kind == "alertmanager":
            r = requests.get(f"{h}/api/v2/status", auth=_auth(), verify=VERIFY_SSL, timeout=10)
            r.raise_for_status()
            cluster = r.json().get("cluster", {}).get("status", "?")
            return {"ok": True, "message": f"Alertmanager bağlandı — cluster: {cluster}"}
        else:
            r = requests.get(f"{h}/api/v1/status/buildinfo", auth=_auth(), verify=VERIFY_SSL, timeout=10)
            r.raise_for_status()
            version = r.json().get("data", {}).get("version", "?")
            return {"ok": True, "message": f"Prometheus {version} — bağlantı başarılı"}
    except requests.exceptions.ConnectionError:
        return {"ok": False, "message": f"Bağlantı kurulamadı: {h}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
