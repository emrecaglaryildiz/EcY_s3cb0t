"""
fortinet_collector.py — FortiGate REST API (FortiOS 7.x)
Desteklenen auth yöntemleri:
  1. API Token (önerilen) — Header: Authorization: Bearer <token>
  2. Session auth (kullanıcı+şifre) — POST /logincheck → CSRF token + cookie
"""

import os
import logging
import threading
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
log = logging.getLogger("ecy-s3cb0t.fortinet")

# ── Ortam değişkenleri ────────────────────────────────────────────────────────
HOST = os.getenv("FORTINET_HOST", "").rstrip("/")         # https://10.0.0.1
AUTH_METHOD = os.getenv("FORTINET_AUTH", "token")          # token | session
API_TOKEN = os.getenv("FORTINET_API_TOKEN", "")
USER = os.getenv("FORTINET_USER", "")
PASS = os.getenv("FORTINET_PASS", "")
VDOM = os.getenv("FORTINET_VDOM", "root")
VERIFY_SSL = os.getenv("FORTINET_VERIFY_SSL", "0") == "1"
TIMEOUT = int(os.getenv("FORTINET_TIMEOUT", "15"))

# ── Session cache ─────────────────────────────────────────────────────────────
_session: requests.Session | None = None
_csrf_token: str = ""
_session_lock = threading.Lock()


def _get_session() -> requests.Session:
    """Session auth: login ve CSRF token al."""
    global _session, _csrf_token
    with _session_lock:
        if _session:
            return _session

        s = requests.Session()
        s.verify = VERIFY_SSL
        resp = s.post(
            f"{HOST}/logincheck",
            data={"ajax": "1", "username": USER, "secretkey": PASS},
            timeout=TIMEOUT,
        )
        if resp.text.strip() not in ("1", ""):
            raise ConnectionError(f"FortiGate login başarısız: HTTP {resp.status_code}")

        for cookie in s.cookies:
            if cookie.name.upper() == "CCSRFTOKEN":
                _csrf_token = cookie.value.strip('"')
                break

        _session = s
        return s


def _api_get(path: str, params: dict | None = None) -> dict:
    """FortiGate REST API'ye GET isteği."""
    url = f"{HOST}{path}"
    p = {"vdom": VDOM, **(params or {})}

    if AUTH_METHOD == "token" and API_TOKEN:
        headers = {"Authorization": f"Bearer {API_TOKEN}"}
        resp = requests.get(url, headers=headers, params=p,
                            verify=VERIFY_SSL, timeout=TIMEOUT)
    else:
        s = _get_session()
        headers = {}
        if _csrf_token:
            headers["X-CSRFTOKEN"] = _csrf_token
        resp = s.get(url, headers=headers, params=p, timeout=TIMEOUT)

    resp.raise_for_status()
    return resp.json()


def _safe_get(path: str, params: dict | None = None) -> dict | None:
    """Hata durumunda None döndüren wrapper."""
    try:
        return _api_get(path, params)
    except Exception as e:
        log.warning("FortiGate %s hatası: %s", path, e)
        return None


# ══════════════════════════════════════════════════════════════════════════════
# Veri toplama fonksiyonları
# ══════════════════════════════════════════════════════════════════════════════

def get_system_status() -> dict | None:
    """Cihaz bilgisi: hostname, firmware, seri no, uptime."""
    data = _safe_get("/api/v2/monitor/system/status")
    if not data:
        return None
    r = data.get("results", data)
    return {
        "hostname": r.get("hostname", ""),
        "serial": r.get("serial", ""),
        "version": r.get("version", ""),
        "build": r.get("build", ""),
        "uptime": r.get("uptime", 0),
    }


def get_system_resources() -> dict | None:
    """CPU, RAM, oturum sayısı."""
    data = _safe_get("/api/v2/monitor/system/resource/usage")
    if not data:
        return None
    r = data.get("results", {})
    return {
        "cpu":       r.get("cpu", [{}])[-1].get("current", 0) if isinstance(r.get("cpu"), list) else r.get("cpu", 0),
        "memory":    r.get("mem", [{}])[-1].get("current", 0) if isinstance(r.get("mem"), list) else r.get("mem", 0),
        "disk":      0,
        "session":   r.get("session", [{}])[-1].get("current", 0) if isinstance(r.get("session"), list) else r.get("session", 0),
        "setuprate": r.get("setuprate", [{}])[-1].get("current", 0) if isinstance(r.get("setuprate"), list) else r.get("setuprate", 0),
    }


def get_interfaces() -> list[dict] | None:
    """Tüm interface'ler: ad, ip, durum, hız, tx/rx byte."""
    data = _safe_get("/api/v2/monitor/system/interface", {"include_vlan": "true", "include_aggregate": "true"})
    if not data:
        return None
    results = data.get("results", [])
    # results dict olabilir (key=if_name) veya list
    if isinstance(results, dict):
        items = list(results.values())
    else:
        items = results

    ifaces = []
    for iface in items:
        ifaces.append({
            "name": iface.get("name", ""),
            "ip": iface.get("ip", ""),
            "link": iface.get("link", False),
            "speed": iface.get("speed", 0),
            "duplex": iface.get("duplex", ""),
            "tx_bytes": iface.get("tx_bytes", 0),
            "rx_bytes": iface.get("rx_bytes", 0),
            "tx_packets": iface.get("tx_packets", 0),
            "rx_packets": iface.get("rx_packets", 0),
            "tx_errors": iface.get("tx_errors", 0),
            "rx_errors": iface.get("rx_errors", 0),
        })
    return ifaces


def get_ipsec_tunnels() -> list[dict] | None:
    """IPSec VPN tünel durumları."""
    data = _safe_get("/api/v2/monitor/vpn/ipsec")
    if not data:
        return None
    tunnels = []
    for t in data.get("results", []):
        proxyid = t.get("proxyid", [{}])
        proxy_status = proxyid[0].get("status", "down") if proxyid else "down"
        incoming = sum(p.get("incoming_bytes", 0) for p in proxyid)
        outgoing = sum(p.get("outgoing_bytes", 0) for p in proxyid)
        tunnels.append({
            "name": t.get("name", ""),
            "type": t.get("type", ""),
            "rgwy": t.get("rgwy", ""),
            "status": proxy_status,
            "incoming_bytes": incoming,
            "outgoing_bytes": outgoing,
            "comments": t.get("comments", ""),
        })
    return tunnels


def get_firewall_policy_stats() -> list[dict] | None:
    """Firewall policy hit sayıları."""
    data = _safe_get("/api/v2/cmdb/firewall/policy", {"format": "policyid|name|action|status|srcintf|dstintf|srcaddr|dstaddr|schedule"})
    if not data:
        return None

    # Monitor endpoint'ten hit count
    mon_data = _safe_get("/api/v2/monitor/firewall/policy")
    hit_map: dict[int, dict] = {}
    if mon_data:
        for p in mon_data.get("results", []):
            hit_map[p.get("policyid", 0)] = p

    policies = []
    for p in data.get("results", []):
        pid = p.get("policyid", 0)
        mon = hit_map.get(pid, {})
        policies.append({
            "id": pid,
            "name": p.get("name", ""),
            "action": p.get("action", ""),
            "status": p.get("status", ""),
            "srcintf": [i.get("name", "") for i in p.get("srcintf", [])],
            "dstintf": [i.get("name", "") for i in p.get("dstintf", [])],
            "hit_count": mon.get("hit_count", mon.get("software_counters", {}).get("hit_count", 0)),
            "bytes": mon.get("byte", mon.get("software_counters", {}).get("byte", 0)),
            "first_used": mon.get("first_used", 0),
            "last_used": mon.get("last_used", 0),
        })
    return policies


def get_session_info() -> dict | None:
    """Aktif oturum istatistikleri."""
    data = _safe_get("/api/v2/monitor/firewall/session-top", {"count": "20", "sort_by": "bytes"})
    if not data:
        return None
    r = data.get("results", {})
    return {
        "active_sessions": r.get("total", 0),
        "top_sessions":    r.get("details", [])[:10],
    }


def get_routing_table() -> list[dict] | None:
    """Routing tablosu."""
    data = _safe_get("/api/v2/monitor/router/ipv4")
    if not data:
        return None
    routes = []
    for r in data.get("results", []):
        routes.append({
            "type": r.get("type", ""),
            "ip": r.get("ip", ""),
            "mask": r.get("mask", ""),
            "gateway": r.get("gateway", ""),
            "interface": r.get("interface", ""),
            "distance": r.get("distance", 0),
            "metric": r.get("metric", 0),
        })
    return routes


# ══════════════════════════════════════════════════════════════════════════════
# Toplu özet
# ══════════════════════════════════════════════════════════════════════════════

def get_summary() -> dict:
    """Tüm FortiGate verisini topla ve tek dict olarak döndür."""
    return {
        "system":     get_system_status(),
        "resources":  get_system_resources(),
        "interfaces": get_interfaces(),
        "ipsec":      get_ipsec_tunnels(),
        "policies":   get_firewall_policy_stats(),
        "sessions":   get_session_info(),
        "routes":     get_routing_table(),
    }


def test_connection(host: str = "", auth: str = "token",
                    token: str = "", user: str = "", passwd: str = "",
                    vdom: str = "root") -> dict:
    """Bağlantı testi — başarı/başarısızlık ve mesaj döndürür."""
    global HOST, AUTH_METHOD, API_TOKEN, USER, PASS, VDOM, _session
    HOST = host.rstrip("/")
    AUTH_METHOD = auth
    API_TOKEN = token
    USER = user
    PASS = passwd
    VDOM = vdom
    _session = None

    if not HOST:
        return {"ok": False, "message": "Host adresi boş"}
    try:
        data = _api_get("/api/v2/monitor/system/status")
        r = data.get("results", data)
        hostname = r.get("hostname", "")
        version = r.get("version", "")
        return {"ok": True, "message": f"Bağlandı: {hostname} (FortiOS {version})"}
    except requests.exceptions.SSLError:
        return {"ok": False, "message": "SSL sertifika hatası — FORTINET_VERIFY_SSL=0 deneyin"}
    except requests.exceptions.ConnectionError as e:
        return {"ok": False, "message": f"Bağlantı hatası: {e}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
