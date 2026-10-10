#!/usr/bin/env python3
"""
TID MT5 Sync Worker
Polls backend for accounts needing sync, fetches MT5 data, pushes results.

Requirements:
  pip install MetaTrader5 cryptography python-dotenv requests mysql-connector-python

Setup:
  1. Copy .env.example to .env and fill in real values
  2. Ensure MT5 terminal is installed and running
  3. Run: python mt5_sync.py
"""

import os
import sys
import time
import json
import base64
import hashlib
import traceback
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Load .env from same directory
script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(script_dir, ".env"))

# ─── Config ───
BACKEND_URL = os.environ.get("BACKEND_URL", "https://fundfxt.onrender.com").rstrip("/")
INTERNAL_SYNC_KEY = os.environ.get("INTERNAL_SYNC_KEY", "")
TID_ENCRYPTION_KEY = os.environ.get("TID_ENCRYPTION_KEY", "")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "10"))
DRY_RUN = os.environ.get("DRY_RUN", "0") == "1"
MT5_TERMINAL_PATH = os.environ.get("MT5_TERMINAL_PATH", "")

if not INTERNAL_SYNC_KEY:
    print("FATAL: INTERNAL_SYNC_KEY not set in .env")
    sys.exit(1)

if not TID_ENCRYPTION_KEY:
    print("FATAL: TID_ENCRYPTION_KEY not set in .env")
    sys.exit(1)

# ─── Encryption ───
def _get_key():
    raw = TID_ENCRYPTION_KEY
    if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
        return bytes.fromhex(raw)
    return hashlib.sha256(raw.encode("utf-8")).digest()

def decrypt_field(payload):
    if not payload:
        return None
    try:
        key = _get_key()
        buf = base64.b64decode(payload)
        if len(buf) < 28:
            return None
        iv = buf[:12]
        tag = buf[12:28]
        enc = buf[28:]
        aesgcm = AESGCM(key)
        decrypted = aesgcm.decrypt(iv, enc + tag, None)
        return decrypted.decode("utf-8")
    except Exception as e:
        print("  [decrypt] error:", e)
        return None

# ─── Backend API ───
def api_headers():
    return {
        "x-internal-sync-key": INTERNAL_SYNC_KEY,
        "Content-Type": "application/json",
    }

def fetch_queue(limit=BATCH_SIZE):
    try:
        r = requests.get(
            BACKEND_URL + "/api/admin/internal/sync-queue",
            headers=api_headers(),
            params={"limit": limit},
            timeout=30,
        )
        if r.status_code != 200:
            print("  [queue] HTTP", r.status_code, r.text[:200])
            return []
        data = r.json()
        return data.get("items", []) if data.get("success") else []
    except Exception as e:
        print("  [queue] error:", e)
        return []

def mark_start(account_id, source="AUTO"):
    try:
        r = requests.post(
            BACKEND_URL + "/api/admin/internal/sync-start/" + str(account_id),
            headers=api_headers(),
            json={"source": source},
            timeout=30,
        )
        return r.status_code == 200
    except Exception as e:
        print("  [sync-start] error:", e)
        return False

def push_complete(account_id, payload):
    if DRY_RUN:
        print("  [DRY_RUN] Would POST sync-complete:", account_id, "trades:", len(payload.get("trades", [])))
        return True
    try:
        r = requests.post(
            BACKEND_URL + "/api/admin/internal/sync-complete/" + str(account_id),
            headers=api_headers(),
            json=payload,
            timeout=120,
        )
        if r.status_code != 200:
            print("  [sync-complete] HTTP", r.status_code, r.text[:300])
            return False
        print("  [sync-complete] OK:", r.json())
        return True
    except Exception as e:
        print("  [sync-complete] error:", e)
        return False

def push_fail(account_id, error_msg):
    if DRY_RUN:
        print("  [DRY_RUN] Would POST sync-fail:", account_id, "error:", error_msg[:100])
        return
    try:
        requests.post(
            BACKEND_URL + "/api/admin/internal/sync-fail/" + str(account_id),
            headers=api_headers(),
            json={"error": str(error_msg)[:255]},
            timeout=30,
        )
    except Exception as e:
        print("  [sync-fail] error:", e)

# ─── Symbol → pip map ───
PIP_MAP = {
    "EURUSD": 0.0001, "GBPUSD": 0.0001, "AUDUSD": 0.0001, "NZDUSD": 0.0001,
    "USDCHF": 0.0001, "USDCAD": 0.0001, "EURGBP": 0.0001, "EURCHF": 0.0001,
    "EURJPY": 0.01, "GBPJPY": 0.01, "USDJPY": 0.01, "AUDJPY": 0.01,
    "CHFJPY": 0.01, "CADJPY": 0.01, "NZDJPY": 0.01,
    "XAUUSD": 0.1, "XAGUSD": 0.01,
    "US30": 1.0, "NAS100": 1.0, "SPX500": 1.0, "GER40": 1.0, "UK100": 1.0,
    "BTCUSD": 1.0, "ETHUSD": 1.0,
}

def get_pip_size(symbol):
    sym = str(symbol or "").upper()
    if sym in PIP_MAP:
        return PIP_MAP[sym]
    for key in PIP_MAP:
        if sym.startswith(key):
            return PIP_MAP[key]
    return 0.0001

# ─── Main loop ───
def main_loop():
    print("=== TID MT5 Sync Worker ===")
    print("Backend:", BACKEND_URL)
    print("Poll interval:", POLL_INTERVAL, "sec")
    print("Batch size:", BATCH_SIZE)
    print("DRY_RUN:", DRY_RUN)
    print("")

    while True:
        try:
            items = fetch_queue(BATCH_SIZE)
            if items:
                print("[%s] Queue has %d item(s)" % (datetime.now().strftime("%H:%M:%S"), len(items)))
                for item in items:
                    process_account(item)
            else:
                print("[%s] Queue empty." % datetime.now().strftime("%H:%M:%S"))
        except KeyboardInterrupt:
            print("\nStopped by user.")
            return
        except Exception as e:
            print("[loop] error:", e)
            traceback.print_exc()

        time.sleep(POLL_INTERVAL)


# ─── Placeholder (part 2 will define process_account) ───
def process_account(item):
    print("  [process_account] placeholder — not yet implemented")
    print("  item:", item.get("account_id"))


if __name__ == "__main__":
    main_loop()
