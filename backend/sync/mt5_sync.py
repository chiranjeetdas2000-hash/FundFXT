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


# ─── MT5 fetch ───
def kill_mt5_process():
    try:
        import subprocess
        subprocess.run(["taskkill", "/IM", "terminal64.exe", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    except Exception as e:
        print("    [kill] error:", e)

def write_mt5_launch_ini(login, password, server):
    import tempfile
    fd, ini_path = tempfile.mkstemp(prefix="mt5_launch_", suffix=".ini")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("[Common]\n")
            f.write("Login=%s\n" % login)
            f.write("Password=%s\n" % password)
            f.write("Server=%s\n" % server)
    except Exception:
        try:
            os.close(fd)
        except Exception:
            pass
        raise
    return ini_path

def delete_file_safe(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print("    [del] %s: %s" % (path, e))

def find_terminal_exe():
    import glob
    candidates = [
        r"C:\Program Files\MetaTrader 5\terminal64.exe",
        r"C:\Program Files (x86)\MetaTrader 5\terminal64.exe",
        r"C:\Program Files\FT Trading MT5\terminal64.exe",
        r"C:\Program Files\FTTrading MT5\terminal64.exe",
        r"C:\Program Files\FTTrading-Server\terminal64.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    for base in [r"C:\Program Files", r"C:\Program Files (x86)", os.path.expandvars(r"%LOCALAPPDATA%"), os.path.expandvars(r"%APPDATA%")]:
        try:
            matches = glob.glob(os.path.join(base, "**", "terminal64.exe"), recursive=True)
            if matches:
                return matches[0]
        except Exception:
            pass
    return None

def clear_mt5_session():
    terminal_dir = os.path.expandvars(r"%APPDATA%\MetaQuotes\Terminal")
    if not os.path.exists(terminal_dir):
        return
    for instance in os.listdir(terminal_dir):
        instance_path = os.path.join(terminal_dir, instance)
        config_path = os.path.join(instance_path, "config")
        if not os.path.isdir(config_path):
            continue
        for fname in ["accounts.dat", "common.ini"]:
            fpath = os.path.join(config_path, fname)
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception as e:
                    print("    [clear] %s: %s" % (fname, e))

def fetch_mt5_data(login, password, server, last_synced_id):
    try:
        import MetaTrader5 as mt5
    except ImportError:
        raise Exception("MetaTrader5 package not installed. Run: pip install MetaTrader5")

    # Kill any existing MT5 process to start fresh
    kill_mt5_process()
    time.sleep(3)

    # Find terminal exe
    terminal_exe = MT5_TERMINAL_PATH or find_terminal_exe()
    if not terminal_exe:
        raise Exception("MT5 terminal64.exe not found. Set MT5_TERMINAL_PATH in .env")

    # Write launch INI with credentials (temp file)
    import subprocess
    ini_path = write_mt5_launch_ini(login, password, server)
    print("    [launch] %s (config=%s)" % (terminal_exe, ini_path))

    try:
        subprocess.Popen(
            [terminal_exe, "/config:" + ini_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Wait for MT5 to login + download history
        print("    [launch] waiting 30s for MT5 login...")
        time.sleep(30)
    finally:
        # Delete INI immediately after launch — password not on disk
        delete_file_safe(ini_path)

    # Attach to running terminal (no login args)
    init_ok = False
    last_err = None
    for _attempt in range(3):
        if mt5.initialize(path=terminal_exe):
            init_ok = True
            break
        last_err = mt5.last_error()
        print("    [attach] attempt %d failed: %s" % (_attempt + 1, str(last_err)))
        time.sleep(8)
    if not init_ok:
        raise Exception("MT5 attach failed: " + str(last_err))

    try:
        # Wait for terminal connection + history download
        for _w in range(15):
            _tinfo = mt5.terminal_info()
            if _tinfo and _tinfo.connected:
                break
            time.sleep(1)
        time.sleep(5)

        info = mt5.account_info()
        if info is None:
            raise Exception("MT5 account_info returned None")

        balance_cents = int(round(float(info.balance) * 100))
        equity_cents = int(round(float(info.equity) * 100))
        currency = str(info.currency or "USD")

        # Time window: last 5 years (breached accounts have full history)
        to_date = datetime.now(timezone.utc) + timedelta(days=1)
        from_date = datetime(2020, 1, 1)

        deals = mt5.history_deals_get(from_date, to_date) or []
        print("    MT5 returned %d deals" % len(deals))

        # Group deals by position_id → {in_deal, out_deal}
        positions = {}
        balance_ops = []

        for d in deals:
            # Deposits/withdrawals (balance/credit operations)
            if d.type == mt5.DEAL_TYPE_BALANCE:
                broker_tx_id = "mt5-bal-" + str(d.ticket)
                if last_synced_id and broker_tx_id <= last_synced_id:
                    continue
                amount_cents = int(round(float(d.profit) * 100))
                if amount_cents == 0:
                    continue
                tx_type = "DEPOSIT" if amount_cents > 0 else "WITHDRAWAL"
                ts = datetime.fromtimestamp(d.time, tz=timezone.utc)
                balance_ops.append({
                    "broker_tx_id": broker_tx_id,
                    "tx_type": tx_type,
                    "amount_cents": abs(amount_cents),
                    "tx_date": ts.isoformat(),
                    "notes": str(d.comment or "Balance op")[:100],
                })
                continue

            # Only entry-out (closed trade legs)
            if d.entry != mt5.DEAL_ENTRY_OUT:
                continue

            pid = int(d.position_id)
            positions.setdefault(pid, {})["out"] = d

        # Also fetch entry legs (DEAL_ENTRY_IN) to pair
        for d in deals:
            if d.entry == mt5.DEAL_ENTRY_IN:
                pid = int(d.position_id)
                positions.setdefault(pid, {})["in"] = d

        trades = []
        max_broker_id = last_synced_id

        for pid, legs in positions.items():
            if "in" not in legs or "out" not in legs:
                continue

            in_d = legs["in"]
            out_d = legs["out"]

            broker_trade_id = "mt5-pos-" + str(pid)
            if last_synced_id and broker_trade_id <= last_synced_id:
                continue

            symbol = str(out_d.symbol or "").upper()
            direction = "BUY" if in_d.type == mt5.DEAL_TYPE_BUY else "SELL"

            entry_price = float(in_d.price)
            exit_price = float(out_d.price)
            lot_size = float(out_d.volume)

            pip_size = get_pip_size(symbol)
            if pip_size > 0:
                diff = (exit_price - entry_price) if direction == "BUY" else (entry_price - exit_price)
                pips = round(diff / pip_size, 2)
            else:
                pips = 0.0

            total_profit = float(out_d.profit) + float(out_d.commission) + float(out_d.swap)
            profit_cents = int(round(total_profit * 100))

            opened_at = datetime.fromtimestamp(in_d.time, tz=timezone.utc).isoformat()
            closed_at = datetime.fromtimestamp(out_d.time, tz=timezone.utc).isoformat()

            trades.append({
                "broker_trade_id": broker_trade_id,
                "deal_ticket": str(out_d.ticket),
                "symbol": symbol,
                "direction": direction,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "lot_size": lot_size,
                "pips": pips,
                "profit_cents": profit_cents,
                "opened_at": opened_at,
                "closed_at": closed_at,
                "status": "CLOSED",
                "notes": str(out_d.comment or "")[:200] or None,
            })

            if max_broker_id is None or broker_trade_id > max_broker_id:
                max_broker_id = broker_trade_id

        return {
            "balance_cents": balance_cents,
            "equity_cents": equity_cents,
            "currency": currency,
            "trades": trades,
            "transactions": balance_ops,
            "max_broker_id": max_broker_id,
        }
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass
        time.sleep(2)
        kill_mt5_process()
        time.sleep(3)
        clear_mt5_session()
        time.sleep(3)


# ─── Process single account ───
def process_account(item):
    account_id = item.get("account_id")
    login = item.get("platform_login")
    encrypted_pwd = item.get("platform_password_encrypted")
    server = item.get("broker_server")
    source = item.get("source", "AUTO")
    last_synced_id = item.get("last_synced_broker_trade_id")

    print("  [account %s] login=%s server=%s source=%s last_synced=%s" % (
        account_id, login, server, source, last_synced_id
    ))

    if not login or not encrypted_pwd or not server:
        print("  [account %s] missing credentials — skipping" % account_id)
        return

    if not mark_start(account_id, source):
        print("  [account %s] sync-start failed — skipping" % account_id)
        return

    try:
        password = decrypt_field(encrypted_pwd)
        if not password:
            raise Exception("Decryption failed")

        print("  [account %s] decrypt OK — connecting MT5..." % account_id)
        data = fetch_mt5_data(login, password, server, last_synced_id)

        print("  [account %s] fetched %d trades, %d transactions, balance=%d cents" % (
            account_id, len(data["trades"]), len(data["transactions"]), data["balance_cents"]
        ))

        payload = {
            "balance_cents": data["balance_cents"],
            "equity_cents": data["equity_cents"],
            "currency": data["currency"],
            "trades": data["trades"],
            "transactions": data["transactions"],
        }

        if push_complete(account_id, payload):
            print("  [account %s] SUCCESS" % account_id)
        else:
            push_fail(account_id, "sync-complete failed")
    except Exception as e:
        err = str(e)[:250]
        print("  [account %s] FAIL: %s" % (account_id, err))
        traceback.print_exc()
        push_fail(account_id, err)


if __name__ == "__main__":
    main_loop()
