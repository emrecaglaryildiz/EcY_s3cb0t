"""
bot.py — EcY_S3CB0T Ana Modülü
Web UI entegrasyonlu sürüm:
  - Web UI'dan ayarları okur (SQLite üzerinden)
  - Her raporu Web UI'ye POST eder
  - Heartbeat gönderir
  - --once bayrağıyla tek rapor üretip çıkar (UI'dan tetikleme)
"""

import asyncio
import logging
import os
import sys
import schedule
import time
import threading
import requests as http_requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv

from telegram import Update, BotCommand
from telegram.ext import Application, CommandHandler, ContextTypes

from wazuh_collector      import get_recent_alerts
from observium_collector  import get_device_status, get_alerts, get_port_errors, get_summary as obs_get_summary, get_dashboard_summary
from graylog_collector    import get_summary as gl_get_summary
from fortinet_collector   import get_summary as ft_get_summary
from prometheus_collector import get_summary as prom_get_summary
from zabbix_collector     import get_summary as zbx_get_summary
from webhook_receiver     import get_summary as wh_get_summary, start_webhook_server
from llm_analyzer         import analyze_security_data

# ─────────────────────────────────────────────────────────────────────────────
load_dotenv()

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger("ecy-s3cb0t")

TOKEN    = os.getenv("TELEGRAM_TOKEN")
CHAT_ID  = int(os.getenv("TELEGRAM_CHAT_ID", "0"))
INTERVAL = int(os.getenv("CHECK_INTERVAL_MINUTES", "30"))

# Web UI API adresi (aynı sunucuda çalışıyorsa)
WEB_UI_API = os.getenv("WEB_UI_API", "http://localhost:5000")

_app: Application | None = None
_loop: asyncio.AbstractEventLoop | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Web UI entegrasyonu
# ─────────────────────────────────────────────────────────────────────────────

def push_report_to_ui(content: str, wazuh_data: dict, obs_data: dict, report_type: str = "auto"):
    """Raporu Web UI'ye kaydet."""
    try:
        devices = obs_data.get("devices", {})
        alerts_obs = obs_data.get("alerts", {})
        payload = {
            "reportType":    report_type,
            "content":       content,
            "wazuhAlerts":   wazuh_data.get("total_alerts", 0),
            "wazuhAgents":   wazuh_data.get("total_agents", 0),
            "obsDevicesUp":  devices.get("up_count", 0),
            "obsDevicesDown":devices.get("down_count", 0),
            "obsAlerts":     alerts_obs.get("active_alerts", 0),
            "status":        "success",
        }
        http_requests.post(f"{WEB_UI_API}/api/reports", json=payload, timeout=5)
    except Exception as e:
        log.warning("Web UI rapor push hatası: %s", e)


def log_telegram_message(content: str, message_type: str = "report",
                          trigger_source: str = "auto", status: str = "sent"):
    """Telegram'a gönderilen mesajı Web UI'ye kaydet."""
    try:
        payload = {
            "direction":     "out",
            "chatId":        str(CHAT_ID),
            "messageType":   message_type,
            "content":       content,
            "status":        status,
            "triggerSource": trigger_source,
        }
        http_requests.post(f"{WEB_UI_API}/api/telegram/messages", json=payload, timeout=5)
    except Exception as e:
        log.warning("Telegram mesaj log hatası: %s", e)


def send_heartbeat():
    """Web UI'ye periyodik heartbeat gönder."""
    try:
        http_requests.post(f"{WEB_UI_API}/api/bot/heartbeat", timeout=3)
    except Exception:
        pass  # Web UI yoksa sessizce geç


# ─────────────────────────────────────────────────────────────────────────────
# Veri toplama & analiz
# ─────────────────────────────────────────────────────────────────────────────

def collect_all() -> dict:
    tasks: dict[str, callable] = {
        "wazuh":     get_recent_alerts,
        "observium": obs_get_summary,
    }
    if os.getenv("GRAYLOG_HOST", ""):
        tasks["graylog"] = gl_get_summary
    if os.getenv("FORTINET_HOST", ""):
        tasks["fortinet"] = ft_get_summary
    if os.getenv("PROMETHEUS_HOST", "") or os.getenv("ALERTMANAGER_HOST", ""):
        tasks["prometheus"] = prom_get_summary
    if os.getenv("ZABBIX_HOST", ""):
        tasks["zabbix"] = zbx_get_summary
    tasks["webhooks"] = wh_get_summary  # her zaman çalışır (yerel deque)

    results: dict = {}
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        future_to_key = {executor.submit(fn): key for key, fn in tasks.items()}
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            try:
                results[key] = future.result(timeout=90)
            except Exception as e:
                results[key] = {"error": str(e)}

    results.setdefault("graylog", {})
    results.setdefault("fortinet", {})
    results.setdefault("prometheus", {})
    results.setdefault("zabbix", {})
    results.setdefault("webhooks", {})
    return results


def build_report() -> tuple[str, dict]:
    """Rapor metni + ham veri döner."""
    log.info("Veri toplanıyor...")
    data   = collect_all()
    log.info("LLM analizi başlatılıyor (provider: %s)...", os.getenv("LLM_PROVIDER", "ollama"))
    report = analyze_security_data(
        data["wazuh"],
        data["observium"],
        data.get("graylog"),
        data.get("fortinet"),
        data.get("prometheus"),
        data.get("zabbix"),
        data.get("webhooks"),
    )
    ts = datetime.now().strftime("%d.%m.%Y %H:%M")
    return f"{report}\n\n⏱ _{ts} TSİ_", data


def split_message(text: str, limit: int = 4000) -> list[str]:
    return [text[i : i + limit] for i in range(0, len(text), limit)]


def _is_authorized(update: Update) -> bool:
    """Yalnızca yapılandırılmış CHAT_ID'ye izin ver."""
    return update.effective_chat.id == CHAT_ID


async def send_chunks(bot, chat_id: int, text: str,
                       message_type: str = "report", trigger_source: str = "auto"):
    for chunk in split_message(text):
        await bot.send_message(chat_id=chat_id, text=chunk, parse_mode="Markdown")
        log_telegram_message(chunk, message_type=message_type, trigger_source=trigger_source)


# ─────────────────────────────────────────────────────────────────────────────
# Telegram komut işleyicileri
# ─────────────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    prom_active = bool(os.getenv("PROMETHEUS_HOST") or os.getenv("ALERTMANAGER_HOST"))
    zbx_active  = bool(os.getenv("ZABBIX_HOST"))
    extra = ""
    if prom_active:
        extra += "• /prometheus\_sondurum \u2014 Prometheus/Alertmanager durumu\n"
    if zbx_active:
        extra += "• /zabbix\_sondurum \u2014 Zabbix problem durumu\n"
    extra += "• /webhook\_sondurum \u2014 Gelen webhook sinyalleri\n"
    msg = (
        "🤖 *EcY_S3CB0T — Güvenlik & Ağ İzleme*\n\n"
        "Kullanılabilir komutlar:\n"
        "• /durum \u2014 Tam analiz raporu (LLM)\n"
        "• /wazuh\\_sondurum \u2014 Wazuh güvenlik durumu\n"
        "• /observium\\_sondurum \u2014 Observium ağ durumu\n"
        "• /graylog\\_sondurum \u2014 Graylog log durumu\n"
        "• /forti\\_sondurum \u2014 Fortinet FortiGate durumu\n"
        + extra +
        "• /yardim \u2014 Bu mesaj\n\n"
        f"⏰ Otomatik rapor her *{INTERVAL} dakika*da bir gönderilir.\n"
        f"🖥 Web UI: {WEB_UI_API}"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


async def cmd_durum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    await update.message.reply_text("🔄 Analiz başlatıldı, lütfen bekleyin...")
    try:
        loop = asyncio.get_running_loop()
        report_text, data = await loop.run_in_executor(None, build_report)
        await send_chunks(ctx.bot, update.message.chat_id, report_text,
                          message_type="report", trigger_source="manual")
        push_report_to_ui(report_text, data["wazuh"], data["observium"], "manual")
    except Exception as e:
        log.error("cmd_durum hatası: %s", e)
        await update.message.reply_text(f"❌ Hata oluştu: `{e}`", parse_mode="Markdown")


async def cmd_wazuh_sondurum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    await update.message.reply_text("🔄 Wazuh verileri çekiliyor...")
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, get_recent_alerts)

        if "error" in data:
            await update.message.reply_text(
                f"❌ *Wazuh bağlantı hatası:*\n`{data['error']}`",
                parse_mode="Markdown",
            )
            return

        lines = [
            "🔐 *Wazuh Anlık Durum*\n",
            f"• Toplam alert (son {INTERVAL} dk): *{data['total_alerts']}*",
            f"• Aktif agent: *{data['active_agents']}* / {data['total_agents']}",
        ]
        disc = data.get("disconnected_agents", [])
        if disc:
            lines.append(f"• 🔴 Kopuk agentler: `{', '.join(disc)}`")
        else:
            lines.append("• 🟢 Tüm agentler bağlı")

        for a in data.get("top_alerts", [])[:7]:
            mitre = f" `{', '.join(a['mitre'])}`" if a.get("mitre") else ""
            lines.append(f"  `{a['rule']}`\n  → {a['count']}x | {', '.join(a['agents'][:3])}{mitre}")

        ts = datetime.now().strftime("%d.%m.%Y %H:%M")
        lines.append(f"\n⏱ _{ts} TSİ_")
        await send_chunks(ctx.bot, update.message.chat_id, "\n".join(lines))

    except Exception as e:
        log.error("cmd_wazuh hatası: %s", e)
        await update.message.reply_text(f"❌ Hata: `{e}`", parse_mode="Markdown")


async def cmd_observium_sondurum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    await update.message.reply_text("🔄 Observium ağ verileri çekiliyor...")
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, get_dashboard_summary)

        if "error" in data:
            await update.message.reply_text(
                f"🔴 *Observium bağlantı hatası:*\n`{data['error']}`",
                parse_mode="Markdown"
            )
            return

        summary  = data.get("summary", {})
        dev      = summary.get("devices", {})
        ports    = summary.get("ports", {})
        ao       = data.get("alerts_overview", {})
        warnings = data.get("status_warnings", [])
        alerts   = data.get("alert_status", [])

        lines = ["🌐 *Observium Ağ Durumu*\n"]

        # Cihazlar özeti
        lines += [
            f"📡 *Cihazlar:* Toplam {dev.get('total',0)} — 🟢 {dev.get('up',0)} aktif — 🔴 {dev.get('down',0)} çevrimdışı",
            f"🔌 *Portlar:* Toplam {ports.get('total',0)} — 🟢 {ports.get('up',0)} aktif — 🔴 {ports.get('down',0)} down",
        ]

        # Alerts özeti
        if ao:
            lines.append(
                f"\n🔔 *Alert Özeti:* ✅ Ok={ao.get('ok',0)} | ❌ Fail={ao.get('fail',0)} "
                f"| ⏳ Delay={ao.get('delay',0)} | 🔕 Suppress={ao.get('suppress',0)}"
            )

        # Çevrimdışı / reboot cihazlar
        if warnings:
            lines.append("\n⚠️ *Durum Uyarıları:*")
            for w in warnings[:8]:
                icon = "🔴" if w["status"] == "down" else "🔁"
                dur  = f" ({w['duration']}" + ")" if w.get("duration") else ""
                lines.append(f"  {icon} `{w['hostname']}` — {w['badge']}{dur}")

        # Kritik alarmlar
        critical = [a for a in alerts if a.get("severity") == "critical"]
        warning  = [a for a in alerts if a.get("severity") == "warning"]

        if critical:
            lines.append(f"\n🚨 *Kritik Alarmlar ({len(critical)}):*")
            for a in critical[:6]:
                lines.append(f"  • `{a['device']}` / {a['entity']} — {a['message']}")

        if warning:
            lines.append(f"\n⚠️ *Uyarılar ({len(warning)}):*")
            for a in warning[:4]:
                lines.append(f"  • `{a['device']}` / {a['entity']} — {a['message']}")

        ts = datetime.now().strftime("%d.%m.%Y %H:%M")
        lines.append(f"\n⏱ _{ts} TSİ_")
        await send_chunks(ctx.bot, update.message.chat_id, "\n".join(lines))

    except Exception as e:
        log.error("cmd_network hatası: %s", e)
        await update.message.reply_text(f"❌ Hata: `{e}`", parse_mode="Markdown")


async def cmd_graylog_sondurum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    await update.message.reply_text("🔄 Graylog verileri çekiliyor...")
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, gl_get_summary)

        if "error" in data:
            await update.message.reply_text(
                f"🔴 *Graylog bağlantı hatası:*\n`{data['error']}`",
                parse_mode="Markdown"
            )
            return

        gl_sys = data.get("system", {})
        gl_events = data.get("events", {})
        gl_notifs = data.get("notifications", {})
        gl_stats = data.get("log_stats", {})

        lines = ["📊 *Graylog Son Durum*\n"]
        processing_icon = "✅ Evet" if gl_sys.get("is_processing") else "❌ Hayır"
        lines.append(
            f"• Versiyon: *Graylog {gl_sys.get('version', '?')}* ({gl_sys.get('hostname', '?')})\n"
            f"• Throughput: *{gl_sys.get('throughput', 0)}* msg/sn\n"
            f"• İşleniyor: {processing_icon}"
        )

        # Log istatistikleri
        total_msgs = gl_stats.get("total_messages", 0)
        level_dist = gl_stats.get("level_distribution", {})
        if total_msgs:
            lines.append(f"\n📈 *Log İstatistikleri (son 1 sa):*")
            lines.append(f"• Toplam: *{total_msgs:,}* mesaj")
            if level_dist:
                for lvl in ["CRITICAL", "EMERGENCY", "ERROR", "WARNING", "INFO"]:
                    cnt = level_dist.get(lvl, 0)
                    if cnt > 0:
                        icon = "🔴" if lvl in ("CRITICAL", "EMERGENCY", "ERROR") else "🟡" if lvl == "WARNING" else "🔵"
                        lines.append(f"  {icon} {lvl}: *{cnt:,}*")

        # Top kaynaklar
        top_src = gl_stats.get("top_sources", {})
        if top_src:
            lines.append("\n🖥 *En Çok Log Gönderen:*")
            for src, cnt in sorted(top_src.items(), key=lambda x: x[1], reverse=True)[:5]:
                lines.append(f"  • `{src}` — {cnt:,}")

        # Eventler
        event_list = gl_events.get("event_list", [])
        if event_list:
            lines.append(f"\n🚨 *Tetiklenen Alarmlar ({gl_events.get('total_events', 0)}):*")
            for ev in event_list[:5]:
                pri = ev.get("priority", 0)
                icon = "🔴" if pri >= 3 else "🟡" if pri >= 2 else "🔵"
                lines.append(f"  {icon} `{ev.get('source', '?')}` — {ev.get('message', '?')}")

        # Bildirimler
        if gl_notifs.get("count", 0) > 0:
            lines.append(f"\n⚠️ *Sistem Bildirimleri ({gl_notifs['count']}):*")
            for n in gl_notifs.get("notifications", [])[:3]:
                sev_icon = "🔴" if n.get("severity") == "urgent" else "🟡"
                lines.append(f"  {sev_icon} {n.get('message') or n.get('type', '?')}")

        ts = datetime.now().strftime("%d.%m.%Y %H:%M")
        lines.append(f"\n⏱ _{ts} TSİ_")
        await send_chunks(ctx.bot, update.message.chat_id, "\n".join(lines))

    except Exception as e:
        log.error("cmd_graylog_sondurum hatası: %s", e)
        await update.message.reply_text(f"❌ Hata: `{e}`", parse_mode="Markdown")


async def cmd_forti_sondurum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    await update.message.reply_text("🔄 Fortinet FortiGate verileri çekiliyor...")
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, ft_get_summary)

        if "error" in data:
            await update.message.reply_text(
                f"🔴 *Fortinet bağlantı hatası:*\n`{data['error']}`",
                parse_mode="Markdown"
            )
            return

        ft_sys = data.get("system", {})
        ft_res = data.get("resources", {})
        ft_iface = data.get("interfaces", [])
        ft_ipsec = data.get("ipsec", [])
        ft_policy = data.get("policies", [])
        ft_sessions = data.get("sessions", {})
        ft_routes = data.get("routes", [])

        lines = ["🛡️ *Fortinet FortiGate Son Durum*\n"]

        # Sistem bilgisi
        lines.append(
            f"• Hostname: *{ft_sys.get('hostname', '?')}*\n"
            f"• FortiOS: *{ft_sys.get('version', '?')}*\n"
            f"• S/N: `{ft_sys.get('serial', '?')}`\n"
            f"• VDOM: {ft_sys.get('vdom', '?')}"
        )

        # Kaynaklar
        cpu = ft_res.get("cpu", 0)
        mem = ft_res.get("memory", 0)
        disk = ft_res.get("disk", 0)
        cpu_icon = "🔴" if cpu > 85 else "🟡" if cpu > 60 else "🟢"
        mem_icon = "🔴" if mem > 85 else "🟡" if mem > 60 else "🟢"
        lines.append(
            f"\n💻 *Sistem Kaynakları:*\n"
            f"  {cpu_icon} CPU: *{cpu}%*\n"
            f"  {mem_icon} RAM: *{mem}%*\n"
            f"  🔵 Disk: *{disk}%*"
        )

        # Arayüzler
        up_ifaces = [i for i in ft_iface if i.get("link") == "up" or i.get("status") == "up"]
        down_ifaces = [i for i in ft_iface if i.get("link") == "down" or i.get("status") == "down"]
        lines.append(f"\n🔌 *Arayüzler:* 🟢 {len(up_ifaces)} aktif | 🔴 {len(down_ifaces)} down / Toplam {len(ft_iface)}")
        if down_ifaces:
            for i in down_ifaces[:5]:
                lines.append(f"  🔴 `{i.get('name', '?')}` — {i.get('speed', '?')} {i.get('duplex', '')}")

        # IPSec tünelleri
        if ft_ipsec:
            up_vpn = [t for t in ft_ipsec if t.get("status") == "up"]
            down_vpn = [t for t in ft_ipsec if t.get("status") != "up"]
            lines.append(f"\n🔒 *IPSec VPN:* 🟢 {len(up_vpn)} aktif | 🔴 {len(down_vpn)} down / Toplam {len(ft_ipsec)}")
            if down_vpn:
                for t in down_vpn[:5]:
                    lines.append(f"  🔴 `{t.get('name', '?')}` — {t.get('incoming_bytes_str', '')}")
            if up_vpn:
                for t in up_vpn[:3]:
                    lines.append(f"  🟢 `{t.get('name', '?')}` — RX: {t.get('incoming_bytes_str', '?')} TX: {t.get('outgoing_bytes_str', '?')}")

        # Firewall policy
        if ft_policy:
            active_pol = [p for p in ft_policy if p.get("status") == "enable"]
            lines.append(f"\n🔥 *Firewall Kuralları:* {len(active_pol)} aktif / Toplam {len(ft_policy)}")
            top_hit = sorted(ft_policy, key=lambda p: p.get("hit_count", 0), reverse=True)[:3]
            for p in top_hit:
                lines.append(
                    f"  • #{p.get('id','?')} {p.get('name', p.get('srcintf','?'))} → {p.get('dstintf','?')} "
                    f"hits: *{p.get('hit_count', 0):,}* bytes: *{p.get('bytes', 0):,}*"
                )

        # Session
        if ft_sessions:
            lines.append(f"\n📡 *Oturumlar:* {ft_sessions.get('active_sessions', '?')} aktif")

        # Routing
        if ft_routes:
            lines.append(f"\n🗺 *Routing:* {len(ft_routes)} rota")

        ts = datetime.now().strftime("%d.%m.%Y %H:%M")
        lines.append(f"\n⏱ _{ts} TSİ_")
        await send_chunks(ctx.bot, update.message.chat_id, "\n".join(lines))

    except Exception as e:
        log.error("cmd_forti_sondurum hatası: %s", e)
        await update.message.reply_text(f"❌ Hata: `{e}`", parse_mode="Markdown")


async def cmd_prometheus_sondurum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    await update.message.reply_text("🔄 Prometheus/Alertmanager verileri çekiliyor...")
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, prom_get_summary)

        if data.get("errors"):
            await update.message.reply_text(
                f"🔴 *Prometheus bağlantı hatası:*\n`{data['errors']}`",
                parse_mode="Markdown"
            )
            return

        lines = ["📈 *Prometheus / Alertmanager Durumu*\n"]
        sources = data.get("sources_active", {})
        active_src = ", ".join(k for k, v in sources.items() if v) or "Yapılandırılmamış"
        lines.append(f"🔌 Aktif kaynaklar: *{active_src}*")
        lines.append(f"🔥 Toplam Firing: *{data.get('total_firing', 0)}* "
                     f"(🔴 {data.get('critical_count', 0)} kritik | "
                     f"🟡 {data.get('warning_count', 0)} uyarı | "
                     f"🔵 {data.get('info_count', 0)} bilgi)")

        for a in data.get("critical_alerts", [])[:8]:
            lines.append(f"\n  🔴 *{a.get('name','?')}*")
            if a.get("instance"):
                lines.append(f"     Instance: `{a['instance']}`")
            if a.get("summary"):
                lines.append(f"     {a['summary']}")

        for a in data.get("warning_alerts", [])[:5]:
            lines.append(f"\n  🟡 *{a.get('name','?')}* — `{a.get('instance','?')}`")

        if not data.get("total_firing"):
            lines.append("✅ Firing alarm yok")

        ts = datetime.now().strftime("%d.%m.%Y %H:%M")
        lines.append(f"\n⏱ _{ts} TSİ_")
        await send_chunks(ctx.bot, update.message.chat_id, "\n".join(lines))

    except Exception as e:
        log.error("cmd_prometheus_sondurum hatası: %s", e)
        await update.message.reply_text(f"❌ Hata: `{e}`", parse_mode="Markdown")


async def cmd_zabbix_sondurum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    await update.message.reply_text("🔄 Zabbix verileri çekiliyor...")
    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, zbx_get_summary)

        if "error" in data:
            await update.message.reply_text(
                f"🔴 *Zabbix bağlantı hatası:*\n`{data['error']}`",
                parse_mode="Markdown"
            )
            return

        sc = data.get("severity_counts", {})
        lines = ["🔎 *Zabbix Problem Durumu*\n"]
        lines.append(f"📊 Toplam Problem: *{data.get('total_problems', 0)}*")
        lines.append(
            f"🚨 Felaket: *{sc.get('disaster', 0)}* | "
            f"🔴 Yüksek: *{sc.get('high', 0)}* | "
            f"🟠 Orta: *{sc.get('average', 0)}* | "
            f"🟡 Uyarı: *{sc.get('warning', 0)}*"
        )

        problems = data.get("problems", [])
        if problems:
            lines.append("\n*Aktif Problemler:*")
            for p in problems[:12]:
                ack = "✅" if p.get("acknowledged") else "❌"
                lines.append(
                    f"  {p.get('severity_icon','❓')} `{p.get('host','?')}` — "
                    f"{p.get('name','?')} {ack}"
                )
        else:
            lines.append("✅ Aktif problem yok")

        ts = datetime.now().strftime("%d.%m.%Y %H:%M")
        lines.append(f"\n⏱ _{ts} TSİ_")
        await send_chunks(ctx.bot, update.message.chat_id, "\n".join(lines))

    except Exception as e:
        log.error("cmd_zabbix_sondurum hatası: %s", e)
        await update.message.reply_text(f"❌ Hata: `{e}`", parse_mode="Markdown")


async def cmd_webhook_sondurum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _is_authorized(update):
        return
    try:
        from webhook_receiver import get_pending_webhooks, WEBHOOK_PORT
        # mark_consumed=False: sadece bak, rapor döngüsüne bırak
        pending = get_pending_webhooks(mark_consumed=False)

        lines = [f"🔗 *Webhook Sinyalleri* (port: {WEBHOOK_PORT})\n"]
        if not pending:
            lines.append("✅ Bekleyen sinyal yok")
        else:
            critical = [e for e in pending if e["severity"] == "critical"]
            warning  = [e for e in pending if e["severity"] == "warning"]
            info     = [e for e in pending if e["severity"] == "info"]
            lines.append(f"📥 Toplam: *{len(pending)}* "
                         f"(🔴 {len(critical)} | 🟡 {len(warning)} | 🔵 {len(info)})\n")
            for e in (critical + warning + info)[:10]:
                icon = "🔴" if e["severity"] == "critical" else "🟡" if e["severity"] == "warning" else "🔵"
                consumed = "✓" if e.get("consumed") else "•"
                lines.append(f"  {icon} {consumed} `{e['source']}` — {e['title']}")

        ts = datetime.now().strftime("%d.%m.%Y %H:%M")
        lines.append(f"\n⏱ _{ts} TSİ_")
        await send_chunks(ctx.bot, update.message.chat_id, "\n".join(lines))

    except Exception as e:
        log.error("cmd_webhook_sondurum hatası: %s", e)
        await update.message.reply_text(f"❌ Hata: `{e}`", parse_mode="Markdown")


async def cmd_yardim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await cmd_start(update, ctx)


# ─────────────────────────────────────────────────────────────────────────────
# Zamanlanmış rapor
# ─────────────────────────────────────────────────────────────────────────────

def _scheduled_job():
    global _app, _loop
    if _app is None or _loop is None:
        return
    log.info("Zamanlanmış rapor tetiklendi.")
    try:
        report_text, data = build_report()
        for chunk in split_message(report_text):
            asyncio.run_coroutine_threadsafe(
                _app.bot.send_message(
                    chat_id=CHAT_ID,
                    text=chunk,
                    parse_mode="Markdown",
                ),
                _loop,
            )
        push_report_to_ui(report_text, data["wazuh"], data["observium"], "auto")
        log_telegram_message(report_text, message_type="report", trigger_source="auto")
        log.info("Zamanlanmış rapor gönderildi.")
    except Exception as e:
        log.error("Zamanlanmış rapor gönderilemedi: %s", e)


def _scheduler_thread():
    schedule.every(INTERVAL).minutes.do(_scheduled_job)
    schedule.every(60).seconds.do(send_heartbeat)
    log.info("Zamanlayıcı başlatıldı: her %d dakikada rapor.", INTERVAL)
    while True:
        schedule.run_pending()
        time.sleep(15)


# ─────────────────────────────────────────────────────────────────────────────
# --once modu: tek rapor üret ve çık (Web UI tetikleme için)
# ─────────────────────────────────────────────────────────────────────────────

def run_once():
    """Tek rapor üretip Telegram'a gönder ve çık."""
    log.info("--once modu: tek rapor gönderiliyor...")
    if not TOKEN or not CHAT_ID:
        print("HATA: TELEGRAM_TOKEN veya TELEGRAM_CHAT_ID eksik", file=sys.stderr)
        sys.exit(1)

    try:
        report_text, data = build_report()
        push_report_to_ui(report_text, data["wazuh"], data["observium"], "manual")
        log_telegram_message(report_text, message_type="report", trigger_source="manual")

        async def _send():
            bot = Application.builder().token(TOKEN).build()
            async with bot:
                for chunk in split_message(report_text):
                    await bot.bot.send_message(
                        chat_id=CHAT_ID,
                        text=chunk,
                        parse_mode="Markdown",
                    )

        asyncio.run(_send())
        log.info("--once modu tamamlandı.")
    except Exception as e:
        log.error("--once hatası: %s", e)
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Ana giriş noktası
# ─────────────────────────────────────────────────────────────────────────────

def main():
    global _app

    if "--once" in sys.argv:
        run_once()
        return

    if not TOKEN:
        raise SystemExit("HATA: .env dosyasında TELEGRAM_TOKEN tanımlı değil!")
    if not CHAT_ID:
        raise SystemExit("HATA: .env dosyasında TELEGRAM_CHAT_ID tanımlı değil!")

    _app = Application.builder().token(TOKEN).build()
    _app.add_handler(CommandHandler("start",                cmd_start))
    _app.add_handler(CommandHandler("durum",                cmd_durum))
    _app.add_handler(CommandHandler("wazuh_sondurum",       cmd_wazuh_sondurum))
    _app.add_handler(CommandHandler("observium_sondurum",   cmd_observium_sondurum))
    _app.add_handler(CommandHandler("graylog_sondurum",     cmd_graylog_sondurum))
    _app.add_handler(CommandHandler("forti_sondurum",       cmd_forti_sondurum))
    _app.add_handler(CommandHandler("prometheus_sondurum",  cmd_prometheus_sondurum))
    _app.add_handler(CommandHandler("zabbix_sondurum",      cmd_zabbix_sondurum))
    _app.add_handler(CommandHandler("webhook_sondurum",     cmd_webhook_sondurum))
    _app.add_handler(CommandHandler("yardim",               cmd_yardim))

    # BotFather menüsünü ayarla ve event loop'u yakala
    async def _post_init(application: Application):
        global _loop
        _loop = asyncio.get_running_loop()
        commands = [
            BotCommand("durum",               "Tam analiz raporu (LLM)"),
            BotCommand("wazuh_sondurum",      "Wazuh güvenlik durumu"),
            BotCommand("observium_sondurum",  "Observium ağ durumu"),
            BotCommand("graylog_sondurum",    "Graylog log durumu"),
            BotCommand("forti_sondurum",      "Fortinet FortiGate durumu"),
            BotCommand("prometheus_sondurum", "Prometheus/Alertmanager durumu"),
            BotCommand("zabbix_sondurum",     "Zabbix problem durumu"),
            BotCommand("webhook_sondurum",    "Gelen webhook sinyalleri"),
            BotCommand("yardim",              "Yardım ve komut listesi"),
        ]
        await application.bot.set_my_commands(commands)
        log.info("Telegram bot menüsü güncellendi (%d komut).", len(commands))

    _app.post_init = _post_init

    threading.Thread(target=_scheduler_thread, daemon=True).start()

    # Webhook sunucusunu başlat
    start_webhook_server()

    # Başlangıç heartbeat'i
    send_heartbeat()

    log.info("Bot başlatıldı — Telegram komutları bekleniyor...")
    _app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
