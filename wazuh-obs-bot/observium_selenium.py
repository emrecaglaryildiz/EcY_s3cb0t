"""
observium_selenium.py
Observium Community Edition Alert Status tablosunu Selenium ile çeker.
Chrome headless gerektirir.
"""
import os
import logging
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

log = logging.getLogger("ecy-s3cb0t.obs-selenium")

def _get_driver():
    options = Options()
    options.binary_location = os.getenv("CHROME_BIN", "/usr/bin/chromium")
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    return webdriver.Chrome(options=options)

def get_summary(config: dict = None) -> dict:
    cfg = config or {}
    url  = cfg.get("obs_host") or os.getenv("OBSERVIUM_HOST", "http://localhost")
    user = cfg.get("obs_user") or os.getenv("OBSERVIUM_USER", "admin")
    pwd  = cfg.get("obs_pass") or os.getenv("OBSERVIUM_PASS", "admin")

    driver = None
    try:
        driver = _get_driver()
        driver.get(url)
        time.sleep(2)

        driver.find_element(By.NAME, "username").send_keys(user)
        driver.find_element(By.NAME, "password").send_keys(pwd + Keys.RETURN)
        time.sleep(3)

        alerts = []
        total_alerts = 0
        critical_count = 0
        warning_count = 0

        try:
            alert_box = driver.find_element(By.XPATH, "//h3[contains(text(),'Alert Status')]/following::table[1]")
            rows = alert_box.find_elements(By.TAG_NAME, "tr")
            for row in rows:
                cols = row.find_elements(By.TAG_NAME, "td")
                if not cols or len(cols) < 3:
                    continue
                device = cols[2].text.strip() if len(cols) > 2 else ""
                alert  = cols[3].text.strip() if len(cols) > 3 else ""
                status = cols[4].text.strip() if len(cols) > 4 else ""
                if not device:
                    continue
                sev = "critical" if "FAILED" in status.upper() else "warning" if "WARN" in status.upper() else "alert"
                if sev == "critical": critical_count += 1
                else: warning_count += 1
                alerts.append({"device": device, "entity": alert, "message": status, "severity": sev, "status": status, "change": ""})
            total_alerts = len(alerts)
        except Exception as e:
            log.warning("Alert Status tablosu bulunamadı: %s", e)

        # Device summary — look for the Devices row in the overview table
        devices_up = 0
        devices_down = 0
        try:
            import re
            # Try the summary table: Devices | <total> | <up> | <alert/down>
            tables = driver.find_elements(By.TAG_NAME, "table")
            for tbl in tables:
                text = tbl.text
                if "Devices" in text and "Ports" in text:
                    rows = tbl.find_elements(By.TAG_NAME, "tr")
                    for row in rows:
                        cols = row.find_elements(By.TAG_NAME, "td")
                        if cols and "device" in cols[0].text.lower():
                            nums = re.findall(r"\d+", row.text)
                            if len(nums) >= 2:
                                devices_up   = int(nums[1])   # Up column
                                devices_down = int(nums[2]) if len(nums) > 2 else 0
                    break
        except Exception:
            pass

        return {
            "total_devices": devices_up + devices_down,
            "devices_up": devices_up,
            "devices_down": devices_down,
            "total_ports": 0, "ports_up": 0, "ports_down": 0,
            "alerts_fail": critical_count,
            "alerts_ok": 0,
            "failed_count": critical_count,
            "warning_count": warning_count,
            "down_devices": [],
            "alert_status": alerts,
            "status_warnings": [],
            "summary": {"devices": {"total": devices_up+devices_down, "up": devices_up, "down": devices_down}},
            "alerts_overview": {"ok": 0, "fail": critical_count, "delay": 0, "suppress": 0},
        }
    except Exception as e:
        return {"error": str(e), "total_devices": 0, "devices_up": 0, "devices_down": 0,
                "total_ports": 0, "ports_up": 0, "ports_down": 0, "alerts_fail": 0,
                "alerts_ok": 0, "failed_count": 0, "warning_count": 0,
                "down_devices": [], "alert_status": [], "status_warnings": [],
                "summary": {}, "alerts_overview": {}}
    finally:
        if driver:
            try: driver.quit()
            except: pass
