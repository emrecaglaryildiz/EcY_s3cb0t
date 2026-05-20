"""
graylog_collector.py
Graylog REST API üzerinden log istatistikleri ve aktif alarmları çeker.
Tüm Graylog sürümleri (4.x / 5.x / 6.x) ile uyumlu — Basic Auth.

Toplanan veriler:
  • Sistem durumu: node count, throughput, index istatistikleri
  • Aktif sistem bildirimleri (notifications)
  • Tetiklenmiş event/alert listesi (son N dakika)
  • Log istatistikleri: toplam mesaj, seviye dağılımı, kaynak dağılımı
"""

import os
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

GL_HOST      = os.getenv("GRAYLOG_HOST", "http://localhost:9000").rstrip("/")
GL_USER      = os.getenv("GRAYLOG_USER", "admin")
GL_PASS      = os.getenv("GRAYLOG_PASS", "admin")
GL_RANGE     = int(os.getenv("GRAYLOG_RANGE_SECONDS", "3600"))
GL_VERIFY_SSL = os.getenv("GRAYLOG_VERIFY_SSL", "0") == "1"


def _auth():
    return (GL_USER, GL_PASS)


def _headers():
    return {
        "Accept": "application/json",
        "X-Requested-By": "secbot",
    }


def _get(path: str, params: dict | None = None, timeout: int = 15) -> dict:
    """Graylog API GET isteği, JSON döner."""
    url = f"{GL_HOST}/api{path}"
    r = requests.get(url, auth=_auth(), headers=_headers(),
                     params=params, timeout=timeout, verify=GL_VERIFY_SSL)
    r.raise_for_status()
    return r.json()


def _post(path: str, body: dict | None = None, timeout: int = 15) -> dict:
    """Graylog API POST isteği."""
    url = f"{GL_HOST}/api{path}"
    r = requests.post(url, auth=_auth(), headers={**_headers(), "Content-Type": "application/json"},
                      json=body, timeout=timeout, verify=GL_VERIFY_SSL)
    r.raise_for_status()
    return r.json()


# ── Sistem durumu ─────────────────────────────────────────────────────────────

def get_system_overview() -> dict:
    """
    Graylog cluster/system bilgilerini toplar:
      - Cluster düğüm sayısı ve durumları
      - İndeks istatistikleri (toplam belge, boyut)
      - Throughput (mesaj/sn)
    """
    result = {}

    # 1. Sistem genel
    try:
        sys_info = _get("/system")
        result["version"] = sys_info.get("version", "?")
        result["hostname"] = sys_info.get("hostname", "?")
        result["is_processing"] = sys_info.get("is_processing", False)
        result["lifecycle_status"] = sys_info.get("lifecycle", "?")
        result["lb_status"] = sys_info.get("lb_status", "?")
    except Exception as e:
        result["system_error"] = str(e)

    # 2. Cluster node'ları
    try:
        cluster = _get("/system/cluster/nodes")
        nodes = cluster if isinstance(cluster, list) else cluster.get("nodes", [])
        result["node_count"] = len(nodes)
        result["nodes"] = [
            {
                "id": n.get("node_id", "?")[:8],
                "hostname": n.get("hostname", "?"),
                "is_leader": n.get("is_leader", False) or n.get("is_master", False),
                "transport": n.get("transport_address", ""),
            }
            for n in (nodes if isinstance(nodes, list) else [])
        ][:10]
    except Exception:
        result["node_count"] = 1
        result["nodes"] = []

    # 3. Throughput
    try:
        tp = _get("/system/throughput")
        result["throughput"] = tp.get("throughput", 0)  # mesaj/sn
    except Exception:
        result["throughput"] = 0

    # 4. İndeks istatistikleri
    try:
        idx_stats = _get("/system/indices/index_sets/stats")
        result["index_stats"] = {
            "indices": idx_stats.get("indices", 0),
            "documents": idx_stats.get("documents", 0),
            "size_bytes": idx_stats.get("size", 0),
        }
    except Exception:
        result["index_stats"] = {}

    return result


# ── Aktif bildirimler (System Notifications) ──────────────────────────────────

def get_notifications() -> dict:
    """
    /api/system/notifications — aktif sistem bildirimleri.
    Bunlar Graylog'un kendi iç uyarıları (index rotation, journal full, vb.)
    """
    try:
        data = _get("/system/notifications")
        notifs = data.get("notifications", data) if isinstance(data, dict) else data
        if not isinstance(notifs, list):
            notifs = []

        return {
            "count": len(notifs),
            "notifications": [
                {
                    "type": n.get("type", "?"),
                    "severity": n.get("severity", "normal"),
                    "timestamp": n.get("timestamp", ""),
                    "message": (n.get("details", {}) or {}).get("description", "")
                               or n.get("type", ""),
                }
                for n in notifs[:20]
            ],
        }
    except Exception as e:
        return {"error": str(e), "count": 0, "notifications": []}


# ── Tetiklenmiş event'ler / alarmlar ─────────────────────────────────────────

def get_events(range_seconds: int | None = None) -> dict:
    """
    /api/events/search — tetiklenmiş event/alert tanımlamalarını çeker.
    Graylog 4.x+ event sistemi (eski alert sistemi yerine).
    """
    if range_seconds is None:
        range_seconds = GL_RANGE

    try:
        body = {
            "query": "",
            "filter": {"alerts": "only"},  # sadece alarm niteliğindekiler
            "timerange": {
                "type": "relative",
                "range": range_seconds,
            },
            "sort_by": "timestamp",
            "sort_direction": "desc",
            "page": 1,
            "per_page": 30,
        }
        data = _post("/events/search", body)
        events = data.get("events", [])
        total = data.get("total_events", len(events))

        event_list = []
        for ev in events[:30]:
            event_data = ev.get("event", ev)
            event_list.append({
                "id": event_data.get("id", "?")[:12],
                "event_definition": event_data.get("event_definition_id", ""),
                "message": event_data.get("message", "Alarm"),
                "priority": event_data.get("priority", 0),
                "timestamp": event_data.get("timestamp", ""),
                "source": event_data.get("source", ""),
                "alert": event_data.get("alert", True),
                "fields": event_data.get("fields", {}),
            })

        return {
            "total_events": total,
            "event_list": event_list,
        }

    except requests.exceptions.HTTPError as e:
        # events/search yoksa (eski sürüm) → boş dön
        if e.response is not None and e.response.status_code == 404:
            return {"total_events": 0, "event_list": [],
                    "note": "Event API bulunamadı — eski Graylog sürümü olabilir"}
        return {"error": str(e), "total_events": 0, "event_list": []}

    except Exception as e:
        return {"error": str(e), "total_events": 0, "event_list": []}


# ── Log istatistikleri ────────────────────────────────────────────────────────

def get_log_stats(range_seconds: int | None = None) -> dict:
    """
    /api/search/universal/relative ile son N dakikadaki logların:
      - Toplam mesaj sayısı
      - Seviye dağılımı (level alanı)
      - Kaynak dağılımı (source alanı, top 10)
    """
    if range_seconds is None:
        range_seconds = GL_RANGE

    result = {}

    # 1. Toplam mesaj sayısı
    try:
        search = _get("/search/universal/relative", params={
            "query": "*",
            "range": range_seconds,
            "limit": 0,
            "fields": "message",
        })
        result["total_messages"] = search.get("total_results", 0)
    except Exception as e:
        result["total_messages"] = 0
        result["search_error"] = str(e)

    # 2. Seviye dağılımı (level)
    try:
        terms = _get("/search/universal/relative/terms", params={
            "field": "level",
            "query": "*",
            "range": range_seconds,
            "size": 10,
        })
        raw_terms = terms.get("terms", {})
        # Graylog syslog level → okunabilir etiket
        LEVEL_NAMES = {
            "0": "EMERGENCY", "1": "ALERT", "2": "CRITICAL", "3": "ERROR",
            "4": "WARNING", "5": "NOTICE", "6": "INFO", "7": "DEBUG",
        }
        result["level_distribution"] = {
            LEVEL_NAMES.get(str(k), str(k)): v
            for k, v in raw_terms.items()
        }
    except Exception:
        result["level_distribution"] = {}

    # 3. Kaynak dağılımı (source)
    try:
        terms = _get("/search/universal/relative/terms", params={
            "field": "source",
            "query": "*",
            "range": range_seconds,
            "size": 10,
        })
        result["top_sources"] = terms.get("terms", {})
    except Exception:
        result["top_sources"] = {}

    return result


# ── Hızlı özet (bot.py tarafından çağrılır) ──────────────────────────────────

def get_summary(config: dict = None) -> dict:
    """Tüm Graylog verilerini tek seferde toplar ve birleşik özet döner."""
    global GL_HOST, GL_USER, GL_PASS, GL_RANGE, GL_VERIFY_SSL
    if config:
        if config.get("graylog_host"):          GL_HOST       = config["graylog_host"].rstrip("/")
        if config.get("graylog_user"):           GL_USER       = config["graylog_user"]
        if config.get("graylog_pass"):           GL_PASS       = config["graylog_pass"]
        if config.get("graylog_range_seconds"):  GL_RANGE      = int(config["graylog_range_seconds"])
        if config.get("graylog_verify_ssl") is not None:
            GL_VERIFY_SSL = config["graylog_verify_ssl"] == "1"
    if not GL_HOST or GL_HOST == "http://localhost:9000":
        return {}
    system = get_system_overview()
    notifications = get_notifications()
    events = get_events()
    log_stats = get_log_stats()

    return {
        "system":        system,
        "notifications": notifications,
        "events":        events,
        "log_stats":     log_stats,
    }


# ── Bağlantı testi ────────────────────────────────────────────────────────────

def test_connection(host: str | None = None, user: str | None = None,
                     password: str | None = None) -> dict:
    """Graylog bağlantı testi — /api/system endpoint'ine Basic Auth ile GET."""
    h = (host or GL_HOST).rstrip("/")
    u = user or GL_USER
    p = password or GL_PASS

    try:
        r = requests.get(
            f"{h}/api/system",
            auth=(u, p),
            headers={"Accept": "application/json", "X-Requested-By": "secbot"},
            timeout=10,
            verify=GL_VERIFY_SSL,
        )
        if r.status_code == 401:
            return {"ok": False, "message": "Kimlik doğrulama başarısız — kullanıcı adı/şifre hatalı"}
        r.raise_for_status()
        data = r.json()
        version = data.get("version", "?")
        hostname = data.get("hostname", "?")
        return {"ok": True, "message": f"Bağlantı başarılı — Graylog {version} ({hostname})"}
    except requests.exceptions.Timeout:
        return {"ok": False, "message": "Bağlantı zaman aşımına uğradı (10s)"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
