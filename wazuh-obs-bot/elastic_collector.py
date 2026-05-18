"""
elastic_collector.py
ElasticSearch / OpenSearch entegrasyonu.

Yapılandırma (.env):
  ELASTIC_HOST        — http://elastic:9200  (boş = devre dışı)
  ELASTIC_USER        — Kullanıcı adı
  ELASTIC_PASS        — Şifre
  ELASTIC_INDEX       — Sorgulanacak index pattern (* = tümü, varsayılan)
  ELASTIC_VERIFY_SSL  — 1 = doğrula, 0 = atla (varsayılan)
  ELASTIC_TIMEOUT     — İstek zaman aşımı saniye (varsayılan 15)
"""

import logging
import os
import requests
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("ecy-s3cb0t.elastic")

ELASTIC_HOST       = os.getenv("ELASTIC_HOST", "")
ELASTIC_USER       = os.getenv("ELASTIC_USER", "elastic")
ELASTIC_PASS       = os.getenv("ELASTIC_PASS", "")
ELASTIC_INDEX      = os.getenv("ELASTIC_INDEX", "*")
ELASTIC_VERIFY_SSL = os.getenv("ELASTIC_VERIFY_SSL", "0") == "1"
ELASTIC_TIMEOUT    = int(os.getenv("ELASTIC_TIMEOUT", "15"))

ENABLED = bool(ELASTIC_HOST)


def _auth():
    return (ELASTIC_USER, ELASTIC_PASS) if ELASTIC_USER and ELASTIC_PASS else None


def get_cluster_health() -> dict:
    if not ENABLED:
        return {}
    try:
        resp = requests.get(
            f"{ELASTIC_HOST}/_cluster/health",
            auth=_auth(), verify=ELASTIC_VERIFY_SSL, timeout=ELASTIC_TIMEOUT,
        )
        resp.raise_for_status()
        d = resp.json()
        return {
            "cluster_name":      d.get("cluster_name"),
            "status":            d.get("status"),   # green / yellow / red
            "nodes":             d.get("number_of_nodes", 0),
            "shards_active":     d.get("active_shards", 0),
            "shards_unassigned": d.get("unassigned_shards", 0),
        }
    except Exception as e:
        log.warning("ElasticSearch cluster health hatası: %s", e)
        return {"error": str(e)}


def get_recent_events(interval_minutes: int = 30) -> list:
    if not ENABLED:
        return []
    since = (datetime.now(timezone.utc) - timedelta(minutes=interval_minutes)).isoformat()
    query = {
        "size": 50,
        "sort": [{"@timestamp": {"order": "desc"}}],
        "query": {
            "bool": {
                "must": [
                    {"range": {"@timestamp": {"gte": since}}},
                    {"terms": {"log.level": ["error", "critical", "warn", "warning"]}},
                ]
            }
        },
        "_source": ["@timestamp", "message", "log.level", "host.name", "service.name"],
    }
    try:
        resp = requests.post(
            f"{ELASTIC_HOST}/{ELASTIC_INDEX}/_search",
            json=query, auth=_auth(),
            verify=ELASTIC_VERIFY_SSL, timeout=ELASTIC_TIMEOUT,
        )
        resp.raise_for_status()
        hits = resp.json().get("hits", {}).get("hits", [])
        return [
            {
                "timestamp": h["_source"].get("@timestamp"),
                "message":   h["_source"].get("message", ""),
                "level":     h["_source"].get("log", {}).get("level", "info"),
                "host":      h["_source"].get("host", {}).get("name", ""),
                "service":   h["_source"].get("service", {}).get("name", ""),
            }
            for h in hits
        ]
    except Exception as e:
        log.warning("ElasticSearch events sorgu hatası: %s", e)
        return []


def get_summary() -> dict:
    if not ENABLED:
        return {}
    health = get_cluster_health()
    events = get_recent_events()
    error_count = sum(1 for e in events if e.get("level") in ("error", "critical"))
    warn_count  = sum(1 for e in events if e.get("level") in ("warn",  "warning"))
    return {
        "cluster":       health,
        "recent_events": len(events),
        "error_count":   error_count,
        "warn_count":    warn_count,
        "top_events":    events[:10],
    }


def test_connection() -> dict:
    if not ENABLED:
        return {"ok": False, "message": "ELASTIC_HOST tanımlı değil"}
    try:
        resp = requests.get(
            f"{ELASTIC_HOST}/_cluster/health",
            auth=_auth(), verify=ELASTIC_VERIFY_SSL, timeout=ELASTIC_TIMEOUT,
        )
        resp.raise_for_status()
        d = resp.json()
        return {"ok": True, "message": f"Cluster: {d.get('cluster_name')} — {d.get('status')}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
