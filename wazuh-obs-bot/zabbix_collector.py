"""
zabbix_collector.py
Zabbix JSON-RPC API üzerinden aktif problemleri toplar.
Zabbix 5.x / 6.x / 7.x uyumlu.

Auth yöntemleri:
  1. API Token (önerilen, Zabbix 5.4+) — ZABBIX_API_TOKEN
  2. Kullanıcı/şifre — ZABBIX_USER + ZABBIX_PASS
"""

import os
import threading
import requests
import urllib3
from dotenv import load_dotenv

load_dotenv()
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ZABBIX_HOST  = os.getenv("ZABBIX_HOST", "").rstrip("/")
ZABBIX_USER  = os.getenv("ZABBIX_USER", "Admin")
ZABBIX_PASS  = os.getenv("ZABBIX_PASS", "zabbix")
ZABBIX_TOKEN = os.getenv("ZABBIX_API_TOKEN", "")
VERIFY_SSL   = os.getenv("ZABBIX_VERIFY_SSL", "0") == "1"
TIMEOUT      = int(os.getenv("ZABBIX_TIMEOUT", "15"))

_auth_token: str = ""
_api_version: str = ""
_login_lock = threading.Lock()

SEVERITY_MAP = {
    "0": ("not_classified", "Sınıflandırılmamış", "⚪"),
    "1": ("info",           "Bilgi",               "🔵"),
    "2": ("warning",        "Uyarı",               "🟡"),
    "3": ("average",        "Orta",                "🟠"),
    "4": ("high",           "Yüksek",              "🔴"),
    "5": ("disaster",       "Felaket",             "🚨"),
}


# ── API altyapısı ─────────────────────────────────────────────────────────────

def _api_call(method: str, params: dict) -> object:
    """Zabbix JSON-RPC 2.0 çağrısı. Hata varsa ValueError fırlatır."""
    payload = {
        "jsonrpc": "2.0",
        "method":  method,
        "params":  params,
        "id":      1,
    }
    # API Token (Zabbix 5.4+) veya session token
    auth = ZABBIX_TOKEN or _auth_token
    if auth and method != "user.login":
        payload["auth"] = auth

    r = requests.post(
        f"{ZABBIX_HOST}/api_jsonrpc.php",
        json=payload,
        verify=VERIFY_SSL,
        timeout=TIMEOUT,
        headers={"Content-Type": "application/json"},
    )
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        err = data["error"]
        raise ValueError(f"Zabbix API {err.get('code', '')} — {err.get('data', err.get('message', '?'))}")
    return data.get("result")


def _ensure_login() -> bool:
    """Gerekiyorsa kullanıcı/şifre ile token al; API token varsa atla."""
    global _auth_token, _api_version
    if ZABBIX_TOKEN or _auth_token:
        return True
    if not ZABBIX_HOST:
        return False

    with _login_lock:
        if _auth_token:
            return True
        try:
            # Zabbix 5.4+ "username", önceki sürümler "user"
            try:
                token = _api_call("user.login", {"username": ZABBIX_USER, "password": ZABBIX_PASS})
            except ValueError:
                token = _api_call("user.login", {"user": ZABBIX_USER, "password": ZABBIX_PASS})
            _auth_token = str(token)
            return True
        except Exception:
            return False


def _get_api_version() -> str:
    global _api_version
    if _api_version:
        return _api_version
    try:
        _api_version = str(_api_call("apiinfo.version", {}))
    except Exception:
        _api_version = "?"
    return _api_version


# ── Veri toplama ─────────────────────────────────────────────────────────────

def get_active_problems() -> dict:
    """Tüm aktif Zabbix problemlerini severity gruplarına göre döner."""
    if not ZABBIX_HOST:
        return {"error": "ZABBIX_HOST tanımlı değil", "problems": [], "total_problems": 0}

    if not _ensure_login():
        return {"error": "Zabbix giriş başarısız — kullanıcı adı/şifre veya API token hatalı",
                "problems": [], "total_problems": 0}

    try:
        problems = _api_call("problem.get", {
            "output":        "extend",
            "selectHosts":   ["host", "name"],
            "selectTags":    "extend",
            "recent":        False,
            "suppressed":    False,
            "limit":         200,
            "sortfield":     ["severity", "eventid"],
            "sortorder":     "DESC",
        })

        if not isinstance(problems, list):
            problems = []

        severity_counts: dict[str, int] = {v[0]: 0 for v in SEVERITY_MAP.values()}
        formatted: list[dict] = []

        for p in problems:
            sev_key   = str(p.get("severity", "0"))
            sev_name, sev_label, sev_icon = SEVERITY_MAP.get(sev_key, ("unknown", "?", "❓"))
            severity_counts[sev_name] = severity_counts.get(sev_name, 0) + 1

            hosts     = p.get("hosts", [])
            host_name = hosts[0].get("name", "?") if hosts else "?"
            tags      = [f"{t.get('tag', '')}={t.get('value', '')}" for t in p.get("tags", [])]

            formatted.append({
                "id":             p.get("eventid", "?"),
                "name":           p.get("name", "?"),
                "host":           host_name,
                "severity":       sev_name,
                "severity_label": sev_label,
                "severity_icon":  sev_icon,
                "clock":          int(p.get("clock", 0)),
                "acknowledged":   p.get("acknowledged", "0") == "1",
                "tags":           tags,
            })

        return {
            "total_problems":  len(formatted),
            "severity_counts": severity_counts,
            "problems":        formatted,
            "disaster_count":  severity_counts.get("disaster", 0),
            "high_count":      severity_counts.get("high", 0),
            "warning_count":   severity_counts.get("warning", 0),
        }

    except Exception as e:
        return {"error": str(e), "problems": [], "total_problems": 0}


def get_summary() -> dict:
    return get_active_problems()


# ── Bağlantı testi ────────────────────────────────────────────────────────────

def test_connection(host: str = "", user: str = "", password: str = "", token: str = "") -> dict:
    global ZABBIX_HOST, ZABBIX_USER, ZABBIX_PASS, ZABBIX_TOKEN, _auth_token, _api_version
    if host:
        ZABBIX_HOST  = host.rstrip("/")
        ZABBIX_USER  = user or ZABBIX_USER
        ZABBIX_PASS  = password or ZABBIX_PASS
        ZABBIX_TOKEN = token or ZABBIX_TOKEN
        _auth_token  = ""
        _api_version = ""

    if not ZABBIX_HOST:
        return {"ok": False, "message": "ZABBIX_HOST tanımlı değil"}
    try:
        version = _get_api_version()
        if version == "?":
            return {"ok": False, "message": "Zabbix API erişilemiyor"}
        return {"ok": True, "message": f"Zabbix API {version} — bağlantı başarılı"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
