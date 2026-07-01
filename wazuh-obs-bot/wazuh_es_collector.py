"""
wazuh_es_collector.py
Wazuh uyarılarını Elasticsearch/OpenSearch üzerinden çeker.
Kullanım: wazuh_backend=elasticsearch ayarlandığında devreye girer.
"""
import requests
from requests.auth import HTTPBasicAuth
import os
import urllib3
from datetime import datetime, timedelta, timezone
urllib3.disable_warnings()

def _flag(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def get_recent_alerts(config: dict = None) -> dict:
    cfg = config or {}
    es_host    = (cfg.get("wazuh_es_host") or os.getenv("WAZUH_ES_HOST", "https://localhost:9200")).rstrip("/")
    es_user    = cfg.get("wazuh_es_user")  or os.getenv("WAZUH_ES_USER", "elastic")
    es_pass    = cfg.get("wazuh_es_pass")  or os.getenv("WAZUH_ES_PASS", "")
    interval   = int(cfg.get("check_interval_minutes") or os.getenv("CHECK_INTERVAL_MINUTES", "30"))
    verify_ssl = _flag(cfg.get("wazuh_verify_ssl") or os.getenv("WAZUH_VERIFY_SSL", "0"))
    min_level  = int(cfg.get("wazuh_alert_level")   or os.getenv("WAZUH_ALERT_LEVEL", "7"))

    query = {
        "size": 0,
        "query": {"bool": {"filter": [
            {"range": {"@timestamp": {"gte": f"now-{interval}m", "lte": "now"}}},
            {"range": {"rule.level":  {"gte": min_level}}},
        ]}},
        "aggs": {
            "by_rule": {
                "terms": {"field": "rule.description", "size": 50},
                "aggs": {
                    "by_level": {"terms": {"field": "rule.level", "size": 5}},
                    "by_agent": {"terms": {"field": "agent.name", "size": 10}},
                }
            },
            "total_agents": {"cardinality": {"field": "agent.id"}},
        }
    }

    try:
        url = f"{es_host}/wazuh-alerts-*/_search"
        resp = requests.get(
            url, auth=HTTPBasicAuth(es_user, es_pass),
            headers={"Content-Type": "application/json"},
            json=query, verify=verify_ssl, timeout=20
        )
        resp.raise_for_status()
        data = resp.json()

        buckets = data.get("aggregations", {}).get("by_rule", {}).get("buckets", [])
        total_hits = data.get("hits", {}).get("total", {})
        total_alerts = total_hits.get("value", 0) if isinstance(total_hits, dict) else int(total_hits or 0)

        top_alerts = []
        for b in buckets[:10]:
            agents = [a["key"] for a in b.get("by_agent", {}).get("buckets", [])]
            levels = [lv["key"] for lv in b.get("by_level", {}).get("buckets", [])]
            level = max(levels) if levels else 0
            top_alerts.append({
                "rule": f"[Seviye {level}] {b['key']}",
                "count": b["doc_count"],
                "agents": agents,
                "mitre": [],
            })

        return {
            "total_alerts": total_alerts,
            "total_agents": data.get("aggregations", {}).get("total_agents", {}).get("value", 0),
            "active_agents": data.get("aggregations", {}).get("total_agents", {}).get("value", 0),
            "disconnected_agents": [],
            "top_alerts": top_alerts,
        }
    except Exception as e:
        return {"error": str(e)}
