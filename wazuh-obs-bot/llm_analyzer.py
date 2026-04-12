"""
llm_analyzer.py
Toplanan ham veriyi Ollama üzerindeki yerel LLM ile yorumlar.
"""

import requests
import json
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

GL_RANGE_DESC = f"{int(os.getenv('GRAYLOG_RANGE_SECONDS', '3600')) // 60} dk" 

OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

SYSTEM_PROMPT = """Sen kıdemli bir siber güvenlik ve ağ altyapısı uzmanısın.
Wazuh SIEM, Observium ağ izleme, Graylog log yönetimi ve Fortinet FortiGate firewall
sistemlerinden gelen ham JSON verilerini analiz edip Türkçe, öz ve aksiyon odaklı raporlar üretirsin.

Raporlama kuralların:
1. Başlık olarak "📊 Güvenlik & Ağ Durumu Raporu" kullan
2. Kritik ve acil sorunları en üste yaz
3. Her önemli bulgu için somut öneri ver (tek cümle yeterli)
4. Emoji kullan: 🔴 kritik, 🟡 uyarı, 🟢 normal, 🔵 bilgi
5. Bölümleri şöyle ayır: 🔐 Güvenlik | 🌐 Ağ | 📊 Graylog | 🛡️ Fortinet | 📋 Özet
6. Toplam uzunluk 4000 karakteri geçmesin
7. Eğer veri yoksa veya hata varsa bunu açıkça belirt"""


def analyze_security_data(wazuh_data: dict, observium_data: dict, graylog_data: dict | None = None, fortinet_data: dict | None = None) -> str:
    """
    Ham verileri LLM'e gönderir, Türkçe analiz raporu döner.
    LLM erişilemezse fallback özet döner.
    """
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")

    # Dashboard verisi varsa zengin içerik kullan, yoksa eski format
    dashboard = observium_data.get("dashboard", {})
    if dashboard and "error" not in dashboard:
        obs_section = f"""Cihaz Özeti: Toplam {dashboard.get('total_devices',0)}, Aktif {dashboard.get('devices_up',0)}, Çevrimdışı {dashboard.get('devices_down',0)}
Port Özeti: Toplam {dashboard.get('total_ports',0)}, Aktif {dashboard.get('ports_up',0)}, Down {dashboard.get('ports_down',0)}
Alert Özeti: OK={dashboard.get('alerts_ok',0)}, FAIL={dashboard.get('alerts_fail',0)}

Durum Uyarıları (Çevrimdışı/Reboot):
{json.dumps(dashboard.get('status_warnings', []), ensure_ascii=False, indent=2)}

Aktif Alarm Listesi:
{json.dumps(dashboard.get('alert_status', [])[:20], ensure_ascii=False, indent=2)}"""
    else:
        obs_section = f"""Cihaz Durumları:
{json.dumps(observium_data.get('devices', {}), ensure_ascii=False, indent=2)}

Aktif Alertler:
{json.dumps(observium_data.get('alerts', {}), ensure_ascii=False, indent=2)}

Port Durumu:
{json.dumps(observium_data.get('ports', {}), ensure_ascii=False, indent=2)}"""

    # Graylog verisini hazırla
    graylog_section = "(Graylog bağlantısı yapılandırılmamış)"
    if graylog_data and "error" not in graylog_data and graylog_data:
        gl_sys = graylog_data.get("system", {})
        gl_events = graylog_data.get("events", {})
        gl_notifs = graylog_data.get("notifications", {})
        gl_stats = graylog_data.get("log_stats", {})
        graylog_section = f"""Sistem: Graylog {gl_sys.get('version', '?')} — Throughput: {gl_sys.get('throughput', 0)} msg/sn
Bildirimler: {gl_notifs.get('count', 0)} aktif
{json.dumps(gl_notifs.get('notifications', [])[:5], ensure_ascii=False, indent=2)}

Tetiklenen Eventler (Son): {gl_events.get('total_events', 0)} adet
{json.dumps(gl_events.get('event_list', [])[:10], ensure_ascii=False, indent=2)}

Log İstatistikleri (Son {GL_RANGE_DESC}):
  Toplam mesaj: {gl_stats.get('total_messages', 0)}
  Seviye dağılımı: {json.dumps(gl_stats.get('level_distribution', {}), ensure_ascii=False)}
  En çok kaynak: {json.dumps(gl_stats.get('top_sources', {}), ensure_ascii=False)}"""

    # Fortinet verisini hazırla
    fortinet_section = "(Fortinet FortiGate bağlantısı yapılandırılmamış)"
    if fortinet_data and "error" not in fortinet_data and fortinet_data:
        ft_sys = fortinet_data.get("system", {})
        ft_res = fortinet_data.get("resources", {})
        ft_iface = fortinet_data.get("interfaces", [])
        ft_ipsec = fortinet_data.get("ipsec", [])
        ft_policy = fortinet_data.get("policies", [])
        ft_sessions = fortinet_data.get("sessions", {})
        ft_routes = fortinet_data.get("routes", [])
        fortinet_section = f"""Sistem: FortiOS {ft_sys.get('version', '?')} — {ft_sys.get('hostname', '?')} (S/N: {ft_sys.get('serial', '?')})
Kaynaklar: CPU {ft_res.get('cpu', '?')}%, RAM {ft_res.get('memory', '?')}%, Disk {ft_res.get('disk', '?')}%

Arayüzler ({len(ft_iface)} adet):
{json.dumps(ft_iface[:10], ensure_ascii=False, indent=2)}

IPSec VPN Tünelleri ({len(ft_ipsec)} adet):
{json.dumps(ft_ipsec[:10], ensure_ascii=False, indent=2)}

Firewall Policy İstatistikleri (ilk 15):
{json.dumps(ft_policy[:15], ensure_ascii=False, indent=2)}

Oturum Bilgisi: {json.dumps(ft_sessions, ensure_ascii=False)}

Routing Tablosu ({len(ft_routes)} rota):
{json.dumps(ft_routes[:10], ensure_ascii=False, indent=2)}"""

    user_message = f"""
Tarih/Saat: {now_str} (TSİ)

=== WAZUH GÜVENLİK VERİLERİ ===
{json.dumps(wazuh_data, ensure_ascii=False, indent=2)}

=== OBSERVİUM AĞ VERİLERİ ===
{obs_section}

=== GRAYLOG LOG VERİLERİ ===
{graylog_section}

=== FORTİNET FORTİGATE VERİLERİ ===
{fortinet_section}

Yukarıdaki verileri analiz et ve Telegram'a gönderilecek bir durum raporu oluştur.
"""

    try:
        r = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model":  OLLAMA_MODEL,
                "prompt": user_message,
                "system": SYSTEM_PROMPT,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 1200,
                    "top_p":       0.9,
                    "repeat_penalty": 1.1,
                },
            },
            timeout=180,
        )
        r.raise_for_status()
        response_text = r.json().get("response", "").strip()
        if not response_text:
            raise ValueError("LLM boş yanıt döndürdü.")
        return response_text

    except requests.exceptions.Timeout:
        return (
            "⚠️ *LLM zaman aşımı* — model yanıt vermedi.\n\n"
            + _fallback_summary(wazuh_data, observium_data, graylog_data, fortinet_data)
        )
    except Exception as e:
        return (
            f"⚠️ *LLM hatası:* `{e}`\n\n"
            + _fallback_summary(wazuh_data, observium_data, graylog_data, fortinet_data)
        )


def _fallback_summary(wazuh: dict, obs: dict, graylog: dict | None = None, fortinet: dict | None = None) -> str:
    """LLM olmadan ham veriden kısa özet üretir."""
    lines = ["📊 *Ham Veri Özeti*\n"]

    # ── Wazuh ──────────────────────────────────────────────────
    if "error" not in wazuh:
        lines.append(
            f"🔐 *Wazuh:* {wazuh.get('total_alerts', 0)} alert | "
            f"{wazuh.get('active_agents', 0)}/{wazuh.get('total_agents', 0)} agent aktif"
        )
        disc = wazuh.get("disconnected_agents", [])
        if disc:
            lines.append(f"🔴 Kopuk agentler: `{', '.join(disc)}`")
        top = wazuh.get("top_alerts", [])
        if top:
            lines.append("\nEn çok tetiklenen kurallar:")
            for a in top[:5]:
                lines.append(f"  • `{a['rule']}` → {a['count']}x")
    else:
        lines.append(f"🔴 *Wazuh bağlantı hatası:* `{wazuh['error']}`")

    lines.append("")

    # ── Observium ──────────────────────────────────────────────
    # Önce zengin dashboard verisini dene, yoksa eski format
    dashboard = obs.get("dashboard", {})
    if dashboard and "error" not in dashboard:
        lines.append(
            f"🌐 *Observium:* {dashboard.get('devices_up','?')} cihaz aktif | "
            f"{dashboard.get('devices_down','?')} çevrimdışı | "
            f"{dashboard.get('ports_down','?')} port down"
        )
        for w in dashboard.get("status_warnings", [])[:5]:
            icon = "🔴" if w["status"] == "down" else "🔁"
            dur = f" ({w['duration']})" if w.get("duration") else ""
            lines.append(f"  {icon} `{w['hostname']}` — {w.get('badge','')}{dur}")
        critical = [a for a in dashboard.get("alert_status", []) if a.get("severity") == "critical"]
        if critical:
            lines.append(f"🚨 Kritik alarm: {len(critical)} (ilk 3: " +
                         ", ".join(f"`{a['device']}`" for a in critical[:3]) + ")")
    else:
        devices = obs.get("devices", {})
        if "error" not in devices:
            lines.append(
                f"🌐 *Observium:* {devices.get('up_count', '?')} cihaz ayakta | "
                f"{devices.get('down_count', '?')} çevrimdışı"
            )
            down_list = devices.get("down_devices", [])
            if down_list:
                lines.append("🔴 Çevrimdışı cihazlar:")
                for d in down_list[:5]:
                    lines.append(f"  • `{d['hostname']}` — {d.get('location','')}")
        else:
            lines.append(f"🔴 *Observium bağlantı hatası:* `{devices.get('error','?')}`")

        alerts_data = obs.get("alerts", {})
        if "error" not in alerts_data:
            lines.append(f"🟡 Aktif ağ alerleri: {alerts_data.get('active_alerts', 0)}")

        ports = obs.get("ports", {})
        if "error" not in ports:
            lines.append(f"🟡 Down port sayısı: {ports.get('down_ports', 0)}")


    # ── Graylog ──────────────────────────────────────────────
    if graylog and "error" not in graylog:
        gl_events = graylog.get("events", {})
        gl_stats = graylog.get("log_stats", {})
        gl_notifs = graylog.get("notifications", {})
        lines.append("")
        lines.append(
            f"📊 *Graylog:* {gl_stats.get('total_messages', '?')} log | "
            f"{gl_events.get('total_events', 0)} event | "
            f"{gl_notifs.get('count', 0)} bildirim"
        )
        level_dist = gl_stats.get("level_distribution", {})
        if level_dist:
            err_cnt = level_dist.get("ERROR", 0) + level_dist.get("CRITICAL", 0) + level_dist.get("EMERGENCY", 0)
            warn_cnt = level_dist.get("WARNING", 0)
            if err_cnt > 0:
                lines.append(f"🔴 Hata seviyesi loglar: {err_cnt}")
            if warn_cnt > 0:
                lines.append(f"🟡 Uyarı seviyesi loglar: {warn_cnt}")

    # ── Fortinet ──────────────────────────────────────────────
    if fortinet and "error" not in fortinet:
        ft_sys = fortinet.get("system", {})
        ft_res = fortinet.get("resources", {})
        ft_iface = fortinet.get("interfaces", [])
        ft_ipsec = fortinet.get("ipsec", [])
        ft_sessions = fortinet.get("sessions", {})
        lines.append("")
        lines.append(
            f"🛡️ *Fortinet:* {ft_sys.get('hostname', '?')} — FortiOS {ft_sys.get('version', '?')} | "
            f"CPU {ft_res.get('cpu', '?')}% RAM {ft_res.get('memory', '?')}%"
        )
        down_ifaces = [i for i in ft_iface if i.get("link") == "down" or i.get("status") == "down"]
        if down_ifaces:
            names = ", ".join(f"`{i.get('name','?')}`" for i in down_ifaces[:5])
            lines.append(f"🔴 Down arayüzler: {names}")
        up_count = len([i for i in ft_iface if i.get("link") == "up" or i.get("status") == "up"])
        lines.append(f"🟢 Aktif arayüz: {up_count}/{len(ft_iface)}")
        if ft_ipsec:
            down_vpn = [t for t in ft_ipsec if t.get("status") != "up"]
            if down_vpn:
                names = ", ".join(f"`{t.get('name','?')}`" for t in down_vpn[:5])
                lines.append(f"🔴 Down IPSec tünelleri: {names}")
            else:
                lines.append(f"🟢 Tüm IPSec tünelleri aktif ({len(ft_ipsec)} adet)")
        if ft_sessions:
            lines.append(f"🔵 Aktif oturum: {ft_sessions.get('active_sessions', '?')}")
    elif fortinet and "error" in fortinet:
        lines.append(f"\n🔴 *Fortinet bağlantı hatası:* `{fortinet['error']}`")

    return "\n".join(lines)
