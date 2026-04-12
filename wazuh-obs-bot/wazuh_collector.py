"""
wazuh_collector.py
Wazuh REST API'den alert ve agent verilerini toplar.
"""

import requests
import os
import urllib3
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

WAZUH_HOST  = os.getenv("WAZUH_HOST", "https://localhost:55000")
WAZUH_USER  = os.getenv("WAZUH_USER", "wazuh")
WAZUH_PASS  = os.getenv("WAZUH_PASS", "wazuh")
ALERT_LEVEL = int(os.getenv("WAZUH_ALERT_LEVEL", 7))


def get_wazuh_token() -> str | None:
    """Wazuh JWT token al."""
    try:
        r = requests.get(
            f"{WAZUH_HOST}/security/user/authenticate",
            auth=(WAZUH_USER, WAZUH_PASS),
            verify=False,
            timeout=10,
        )
        r.raise_for_status()
        return r.json()["data"]["token"]
    except Exception as e:
        return None


def get_recent_alerts() -> dict:
    """
    Son CHECK_INTERVAL_MINUTES dakikanın kritik alertlerini çeker,
    agent durumlarıyla birlikte özetlenmiş dict döner.
    """
    token = get_wazuh_token()
    if not token:
        return {"error": "Wazuh bağlantısı kurulamadı — token alınamadı."}

    headers = {"Authorization": f"Bearer {token}"}
    interval = int(os.getenv("CHECK_INTERVAL_MINUTES", 30))

    try:
        # ── Alertler ──────────────────────────────────────────────────────
        r_alerts = requests.get(
            f"{WAZUH_HOST}/alerts",
            headers=headers,
            params={
                "limit": 100,
                "sort": "-timestamp",
                "q": f"rule.level>={ALERT_LEVEL}",
            },
            verify=False,
            timeout=20,
        )
        r_alerts.raise_for_status()
        alerts = r_alerts.json().get("data", {}).get("affected_items", [])

        # ── Agent durumları ───────────────────────────────────────────────
        r_agents = requests.get(
            f"{WAZUH_HOST}/agents",
            headers=headers,
            params={"limit": 500},
            verify=False,
            timeout=20,
        )
        r_agents.raise_for_status()
        agents = r_agents.json().get("data", {}).get("affected_items", [])

        disconnected = [a for a in agents if a.get("status") == "disconnected"]
        active       = [a for a in agents if a.get("status") == "active"]

        # ── Alert grupla (kural bazında) ──────────────────────────────────
        rule_counts: dict = {}
        for alert in alerts:
            rule      = alert.get("rule", {})
            desc      = rule.get("description", "Bilinmeyen kural")
            level     = rule.get("level", 0)
            agent_name = alert.get("agent", {}).get("name", "?")
            mitre_ids  = [
                t.get("id", "")
                for t in rule.get("mitre", {}).get("technique", [])
            ]
            key = f"[Seviye {level}] {desc}"
            if key not in rule_counts:
                rule_counts[key] = {
                    "count":  0,
                    "agents": set(),
                    "mitre":  set(),
                }
            rule_counts[key]["count"] += 1
            rule_counts[key]["agents"].add(agent_name)
            rule_counts[key]["mitre"].update(mitre_ids)

        top_alerts = sorted(
            rule_counts.items(),
            key=lambda x: x[1]["count"],
            reverse=True,
        )[:10]

        return {
            "total_alerts":        len(alerts),
            "total_agents":        len(agents),
            "active_agents":       len(active),
            "disconnected_agents": [a.get("name", "?") for a in disconnected],
            "top_alerts": [
                {
                    "rule":   k,
                    "count":  v["count"],
                    "agents": list(v["agents"]),
                    "mitre":  list(v["mitre"]),
                }
                for k, v in top_alerts
            ],
        }

    except Exception as e:
        return {"error": str(e)}
