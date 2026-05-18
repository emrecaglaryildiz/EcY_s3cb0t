"""
llm_analyzer.py
Toplanan ham veriyi seçilen LLM provider ile yorumlar.

Provider seçimi (LLM_PROVIDER env):
  ollama  — yerel Ollama (varsayılan)
  claude  — Anthropic Claude API
  openai  — OpenAI-compatible API (OpenAI, Azure OpenAI, vb.)
"""

import json
import logging
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("ecy-s3cb0t.llm")

# ── Provider yapılandırması (env varsayılanları) ───────────────────────────────
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()

OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", os.getenv("ANTHROPIC_API_KEY", ""))
CLAUDE_MODEL   = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001")

OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def _get_system_prompt(config: dict | None) -> str:
    """UI'dan özel prompt tanımlıysa onu kullan, yoksa varsayılanı döndür."""
    custom = (config or {}).get("llm_system_prompt", "").strip()
    return custom if custom else SYSTEM_PROMPT


def _resolve_config(override: dict | None) -> dict:
    """Env değerlerini UI ayarlarıyla birleştirir. UI değerleri önceliklidir."""
    c        = override or {}
    provider = c.get("llm_provider", LLM_PROVIDER).lower() or LLM_PROVIDER
    model    = c.get("llm_model", "").strip()
    base_url = c.get("llm_base_url", "").strip()
    api_key  = c.get("llm_api_key", "").strip()
    timeout  = int(c.get("llm_timeout", 60) or 60)
    if provider == "claude":
        return {"provider": "claude",
                "model":   model  or CLAUDE_MODEL,
                "api_key": api_key or CLAUDE_API_KEY,
                "timeout": timeout}
    if provider == "openai":
        return {"provider": "openai",
                "base_url": base_url or OPENAI_BASE_URL,
                "model":    model    or OPENAI_MODEL,
                "api_key":  api_key  or OPENAI_API_KEY,
                "timeout":  timeout}
    return {"provider": "ollama",
            "host":    base_url or OLLAMA_HOST,
            "model":   model    or OLLAMA_MODEL,
            "timeout": timeout}

GL_RANGE_DESC = f"{int(os.getenv('GRAYLOG_RANGE_SECONDS', '3600')) // 60} dk"

SYSTEM_PROMPT = """Sen kıdemli bir siber güvenlik ve ağ altyapısı uzmanısın.
Wazuh SIEM, Observium, Graylog, Fortinet FortiGate, Prometheus/Alertmanager,
Zabbix ve harici webhook sistemlerinden gelen ham JSON verilerini analiz edip
Türkçe, öz ve aksiyon odaklı raporlar üretirsin.

Raporlama kuralların:
1. Başlık olarak "📊 Güvenlik & Ağ Durumu Raporu" kullan
2. Kritik ve acil sorunları en üste yaz
3. Her önemli bulgu için somut öneri ver (tek cümle yeterli)
4. Emoji kullan: 🔴 kritik, 🟡 uyarı, 🟢 normal, 🔵 bilgi
5. Bölümleri şöyle ayır: 🔐 Güvenlik | 🌐 Ağ | 📊 Graylog | 🛡️ Fortinet | 📈 Prometheus | 🔎 Zabbix | 🔗 Webhook | 📋 Özet
6. Veri olmayan bölümleri atla
7. Toplam uzunluk 4000 karakteri geçmesin
8. Eğer veri yoksa veya hata varsa bunu açıkça belirt"""


# ── Veri hazırlama ────────────────────────────────────────────────────────────

def _build_user_message(wazuh: dict, observium: dict,
                         graylog: dict | None,
                         fortinet: dict | None,
                         prometheus: dict | None,
                         zabbix: dict | None,
                         webhooks: dict | None,
                         elastic: dict | None = None) -> str:
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")

    # Observium
    dashboard = observium.get("dashboard", {})
    if dashboard and "error" not in dashboard:
        obs_section = (
            f"Cihaz Özeti: Toplam {dashboard.get('total_devices',0)}, "
            f"Aktif {dashboard.get('devices_up',0)}, Çevrimdışı {dashboard.get('devices_down',0)}\n"
            f"Port Özeti: Toplam {dashboard.get('total_ports',0)}, "
            f"Aktif {dashboard.get('ports_up',0)}, Down {dashboard.get('ports_down',0)}\n"
            f"Alert Özeti: OK={dashboard.get('alerts_ok',0)}, FAIL={dashboard.get('alerts_fail',0)}\n"
            f"Durum Uyarıları:\n"
            f"{json.dumps(dashboard.get('status_warnings', []), ensure_ascii=False, indent=2)}\n"
            f"Aktif Alarmlar:\n"
            f"{json.dumps(dashboard.get('alert_status', [])[:20], ensure_ascii=False, indent=2)}"
        )
    else:
        obs_section = json.dumps(observium, ensure_ascii=False, indent=2)

    # Graylog
    if graylog and "error" not in graylog and graylog:
        gl_sys    = graylog.get("system", {})
        gl_events = graylog.get("events", {})
        gl_notifs = graylog.get("notifications", {})
        gl_stats  = graylog.get("log_stats", {})
        graylog_section = (
            f"Sistem: Graylog {gl_sys.get('version','?')} — Throughput: {gl_sys.get('throughput',0)} msg/sn\n"
            f"Bildirimler: {gl_notifs.get('count',0)} aktif\n"
            f"{json.dumps(gl_notifs.get('notifications',[])[:5], ensure_ascii=False, indent=2)}\n"
            f"Eventler (son): {gl_events.get('total_events',0)} adet\n"
            f"{json.dumps(gl_events.get('event_list',[])[:10], ensure_ascii=False, indent=2)}\n"
            f"Log İstatistikleri (Son {GL_RANGE_DESC}): Toplam={gl_stats.get('total_messages',0)}\n"
            f"Seviye: {json.dumps(gl_stats.get('level_distribution',{}), ensure_ascii=False)}\n"
            f"En çok kaynak: {json.dumps(gl_stats.get('top_sources',{}), ensure_ascii=False)}"
        )
    else:
        graylog_section = "(Graylog bağlantısı yapılandırılmamış)"

    # Fortinet
    if fortinet and "error" not in fortinet and fortinet:
        ft_sys    = fortinet.get("system", {})
        ft_res    = fortinet.get("resources", {})
        ft_iface  = fortinet.get("interfaces", [])
        ft_ipsec  = fortinet.get("ipsec", [])
        ft_policy = fortinet.get("policies", [])
        ft_sess   = fortinet.get("sessions", {})
        fortinet_section = (
            f"Sistem: FortiOS {ft_sys.get('version','?')} — {ft_sys.get('hostname','?')}\n"
            f"Kaynaklar: CPU {ft_res.get('cpu','?')}%, RAM {ft_res.get('memory','?')}%\n"
            f"Arayüzler ({len(ft_iface or [])} adet):\n"
            f"{json.dumps((ft_iface or [])[:10], ensure_ascii=False, indent=2)}\n"
            f"IPSec VPN ({len(ft_ipsec or [])} tünel):\n"
            f"{json.dumps((ft_ipsec or [])[:10], ensure_ascii=False, indent=2)}\n"
            f"Politika İstatistikleri:\n"
            f"{json.dumps((ft_policy or [])[:15], ensure_ascii=False, indent=2)}\n"
            f"Oturumlar: {json.dumps(ft_sess or {}, ensure_ascii=False)}"
        )
    else:
        fortinet_section = "(Fortinet FortiGate bağlantısı yapılandırılmamış)"

    # Prometheus
    if prometheus and prometheus.get("total_firing", 0) > 0:
        prom_section = (
            f"Toplam Firing: {prometheus.get('total_firing',0)} "
            f"(Kritik: {prometheus.get('critical_count',0)}, "
            f"Uyarı: {prometheus.get('warning_count',0)})\n"
            f"Kritik Alarmlar:\n"
            f"{json.dumps(prometheus.get('critical_alerts',[])[:10], ensure_ascii=False, indent=2)}\n"
            f"Uyarı Alarmları:\n"
            f"{json.dumps(prometheus.get('warning_alerts',[])[:10], ensure_ascii=False, indent=2)}"
        )
    elif prometheus and prometheus.get("errors"):
        prom_section = f"(Prometheus bağlantı hatası: {prometheus['errors']})"
    else:
        prom_section = "(Prometheus yapılandırılmamış veya firing alarm yok)"

    # Zabbix
    if zabbix and zabbix.get("total_problems", 0) > 0:
        counts = zabbix.get("severity_counts", {})
        zabbix_section = (
            f"Toplam Problem: {zabbix.get('total_problems',0)}\n"
            f"Severity: Felaket={counts.get('disaster',0)}, "
            f"Yüksek={counts.get('high',0)}, Orta={counts.get('average',0)}, "
            f"Uyarı={counts.get('warning',0)}\n"
            f"Problemler:\n"
            f"{json.dumps(zabbix.get('problems',[])[:20], ensure_ascii=False, indent=2)}"
        )
    elif zabbix and "error" in zabbix:
        zabbix_section = f"(Zabbix bağlantı hatası: {zabbix['error']})"
    else:
        zabbix_section = "(Zabbix yapılandırılmamış veya aktif problem yok)"

    # Webhooks
    if webhooks and webhooks.get("total", 0) > 0:
        wh_section = (
            f"Toplam Bekleyen Sinyal: {webhooks.get('total',0)} "
            f"(Kritik: {webhooks.get('critical_count',0)}, "
            f"Uyarı: {webhooks.get('warning_count',0)})\n"
            f"Kaynaklar: {json.dumps(webhooks.get('by_source',{}), ensure_ascii=False)}\n"
            f"Kritik Eventler:\n"
            f"{json.dumps(webhooks.get('critical_events',[]), ensure_ascii=False, indent=2)}"
        )
    else:
        wh_section = "(Bu dönemde webhook sinyali gelmedi)"

    # ElasticSearch / OpenSearch
    if elastic and "cluster" in elastic and "error" not in elastic.get("cluster", {}):
        cl = elastic["cluster"]
        el_section = (
            f"Cluster: {cl.get('cluster_name','?')} — Durum: {cl.get('status','?')} "
            f"({cl.get('nodes',0)} node, {cl.get('shards_unassigned',0)} unassigned shard)\n"
            f"Son dönem hata sayısı: {elastic.get('error_count',0)}, uyarı: {elastic.get('warn_count',0)}\n"
            f"Önemli eventler:\n"
            f"{json.dumps(elastic.get('top_events',[])[:10], ensure_ascii=False, indent=2)}"
        )
    else:
        el_section = "(ElasticSearch/OpenSearch yapılandırılmamış)"

    return f"""Tarih/Saat: {now_str} (TSİ)

=== WAZUH GÜVENLİK VERİLERİ ===
{json.dumps(wazuh, ensure_ascii=False, indent=2)}

=== OBSERVİUM AĞ VERİLERİ ===
{obs_section}

=== GRAYLOG LOG VERİLERİ ===
{graylog_section}

=== FORTİNET FORTİGATE VERİLERİ ===
{fortinet_section}

=== PROMETHEUS / ALERTMANAGER ===
{prom_section}

=== ZABBIX ===
{zabbix_section}

=== ELASTİCSEARCH / OPENSEARCH ===
{el_section}

=== WEBHOOK SİNYALLERİ ===
{wh_section}

Yukarıdaki verileri analiz et ve Telegram'a gönderilecek bir durum raporu oluştur.
"""


# ── LLM provider'ları ─────────────────────────────────────────────────────────

def _call_ollama(user_message: str, cfg: dict) -> str:
    import requests as _req
    r = _req.post(
        f"{cfg['host']}/api/generate",
        json={
            "model":  cfg["model"],
            "prompt": user_message,
            "system": _get_system_prompt(cfg),
            "stream": False,
            "options": {
                "temperature":    0.3,
                "num_predict":    1200,
                "top_p":          0.9,
                "repeat_penalty": 1.1,
            },
        },
        timeout=cfg["timeout"],
    )
    r.raise_for_status()
    text = r.json().get("response", "").strip()
    if not text:
        raise ValueError("Ollama boş yanıt döndürdü.")
    return text


def _call_claude(user_message: str, cfg: dict) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=cfg["api_key"])
    msg = client.messages.create(
        model=cfg["model"],
        max_tokens=1500,
        system=_get_system_prompt(cfg),
        messages=[{"role": "user", "content": user_message}],
    )
    return msg.content[0].text.strip()


def _call_openai(user_message: str, cfg: dict) -> str:
    import openai
    client = openai.OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"])
    resp = client.chat.completions.create(
        model=cfg["model"],
        messages=[
            {"role": "system", "content": _get_system_prompt(cfg)},
            {"role": "user",   "content": user_message},
        ],
        max_tokens=1500,
        temperature=0.3,
    )
    return resp.choices[0].message.content.strip()


def _call_llm(user_message: str, cfg: dict) -> str:
    if cfg["provider"] == "claude":
        return _call_claude(user_message, cfg)
    if cfg["provider"] == "openai":
        return _call_openai(user_message, cfg)
    return _call_ollama(user_message, cfg)


# ── Ana analiz fonksiyonu ─────────────────────────────────────────────────────

def analyze_security_data(
    wazuh_data: dict,
    observium_data: dict,
    graylog_data: dict | None = None,
    fortinet_data: dict | None = None,
    prometheus_data: dict | None = None,
    zabbix_data: dict | None = None,
    webhook_data: dict | None = None,
    elastic_data: dict | None = None,
    llm_config: dict | None = None,
) -> str:
    """Ham verileri LLM'e gönderir, Türkçe analiz raporu döner.

    llm_config: UI'dan gelen ayarlar (llm_provider, llm_base_url, llm_model,
                llm_api_key, llm_timeout). Verilmezse env değerleri kullanılır.
    """
    cfg          = _resolve_config(llm_config)
    user_message = _build_user_message(
        wazuh_data, observium_data, graylog_data,
        fortinet_data, prometheus_data, zabbix_data, webhook_data, elastic_data,
    )

    provider_label = f"{cfg['provider']}/{cfg.get('model', cfg.get('host', '?'))}"
    log.info("LLM analizi başlatılıyor (provider: %s)...", provider_label)

    try:
        return _call_llm(user_message, cfg)
    except TimeoutError:
        return (
            f"⚠️ *LLM zaman aşımı* ({provider_label}) — model yanıt vermedi.\n\n"
            + _fallback_summary(wazuh_data, observium_data, graylog_data,
                                fortinet_data, prometheus_data, zabbix_data, webhook_data, elastic_data)
        )
    except Exception as e:
        return (
            f"⚠️ *LLM hatası* ({provider_label}): `{e}`\n\n"
            + _fallback_summary(wazuh_data, observium_data, graylog_data,
                                fortinet_data, prometheus_data, zabbix_data, webhook_data, elastic_data)
        )


# ── Fallback özet ─────────────────────────────────────────────────────────────

def _fallback_summary(wazuh: dict, obs: dict,
                       graylog: dict | None = None,
                       fortinet: dict | None = None,
                       prometheus: dict | None = None,
                       zabbix: dict | None = None,
                       webhooks: dict | None = None,
                       elastic: dict | None = None) -> str:
    lines = ["📊 *Ham Veri Özeti*\n"]

    # Wazuh
    if "error" not in wazuh:
        lines.append(f"🔐 *Wazuh:* {wazuh.get('total_alerts',0)} alert | "
                     f"{wazuh.get('active_agents',0)}/{wazuh.get('total_agents',0)} agent aktif")
        disc = wazuh.get("disconnected_agents", [])
        if disc:
            lines.append(f"🔴 Kopuk agentler: `{', '.join(disc)}`")
        for a in wazuh.get("top_alerts", [])[:5]:
            lines.append(f"  • `{a['rule']}` → {a['count']}x")
    else:
        lines.append(f"🔴 *Wazuh:* `{wazuh['error']}`")

    # Observium
    dashboard = obs.get("dashboard", {})
    if dashboard and "error" not in dashboard:
        lines.append(f"🌐 *Observium:* {dashboard.get('devices_up','?')} aktif | "
                     f"{dashboard.get('devices_down','?')} çevrimdışı | "
                     f"{dashboard.get('ports_down','?')} port down")
    else:
        devices = obs.get("devices", {})
        if "error" not in devices:
            lines.append(f"🌐 *Observium:* {devices.get('up_count','?')} aktif | "
                         f"{devices.get('down_count','?')} çevrimdışı")

    # Graylog
    if graylog and "error" not in graylog:
        gl_stats = graylog.get("log_stats", {})
        lines.append(f"📊 *Graylog:* {gl_stats.get('total_messages','?')} log | "
                     f"{graylog.get('events',{}).get('total_events',0)} event")

    # Fortinet
    if fortinet and "error" not in fortinet:
        ft_sys = fortinet.get("system", {})
        ft_res = fortinet.get("resources", {})
        lines.append(f"🛡️ *Fortinet:* {ft_sys.get('hostname','?')} | "
                     f"CPU {ft_res.get('cpu','?')}% RAM {ft_res.get('memory','?')}%")

    # Prometheus
    if prometheus and prometheus.get("total_firing", 0) > 0:
        lines.append(f"📈 *Prometheus:* {prometheus['total_firing']} firing alarm "
                     f"(🔴 {prometheus.get('critical_count',0)} kritik, "
                     f"🟡 {prometheus.get('warning_count',0)} uyarı)")
        for a in prometheus.get("critical_alerts", [])[:3]:
            lines.append(f"  🔴 `{a.get('name','?')}` — {a.get('instance','?')}: {a.get('summary','')}")

    # Zabbix
    if zabbix and zabbix.get("total_problems", 0) > 0:
        sc = zabbix.get("severity_counts", {})
        lines.append(f"🔎 *Zabbix:* {zabbix['total_problems']} problem "
                     f"(🚨 Felaket: {sc.get('disaster',0)}, 🔴 Yüksek: {sc.get('high',0)})")
        for p in zabbix.get("problems", [])[:3]:
            lines.append(f"  {p.get('severity_icon','❓')} `{p.get('host','?')}` — {p.get('name','?')}")

    # Webhooks
    if webhooks and webhooks.get("total", 0) > 0:
        lines.append(f"🔗 *Webhook:* {webhooks['total']} sinyal "
                     f"(🔴 {webhooks.get('critical_count',0)} kritik)")
        for e in webhooks.get("critical_events", [])[:3]:
            lines.append(f"  🔴 `{e.get('source','?')}` — {e.get('title','?')}")

    # ElasticSearch
    if elastic and elastic.get("error_count", 0) + elastic.get("warn_count", 0) > 0:
        cl = elastic.get("cluster", {})
        lines.append(f"🔍 *Elastic:* {cl.get('cluster_name','?')} [{cl.get('status','?')}] | "
                     f"🔴 {elastic.get('error_count',0)} hata, 🟡 {elastic.get('warn_count',0)} uyarı")

    return "\n".join(lines)
