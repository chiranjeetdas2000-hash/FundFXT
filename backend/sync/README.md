# TID MT5 Sync Worker

Home PC daemon that polls the TID backend for accounts needing sync, fetches data from MetaTrader 5 using investor passwords, and pushes results back to the backend.

## Requirements

- Windows 10/11 (MT5 Python library is Windows-only)
- Python 3.8+ (tested on 3.14)
- MetaTrader 5 terminal installed and able to log in
- Internet connection (to reach fundfxt.onrender.com)

## One-time setup

### 1. Install Python packages

    pip install MetaTrader5 cryptography python-dotenv requests mysql-connector-python

### 2. Create .env file

Copy .env.example to .env in the same folder, then fill in:

    BACKEND_URL=https://fundfxt.onrender.com
    INTERNAL_SYNC_KEY=<copy from Render env>
    TID_ENCRYPTION_KEY=<copy from Render env>
    POLL_INTERVAL_SECONDS=30
    BATCH_SIZE=10
    MT5_TERMINAL_PATH=
    DRY_RUN=0

Important: INTERNAL_SYNC_KEY and TID_ENCRYPTION_KEY must match exactly the values in Render's environment variables for the FundFXT backend service. Ask the admin if unsure.

### 3. Ensure MT5 terminal is installed

Default path: C:\Program Files\MetaTrader 5\terminal64.exe

If you have it installed elsewhere, set MT5_TERMINAL_PATH in .env.

### 4. Ensure MT5 terminal has logged in at least once

Open MT5 manually, log in with any account, then close it. This creates the necessary config files for the Python library.

## Running

Option A — Double-click:

Double-click start_sync.bat in File Explorer.

Option B — Command line:

    cd backend\sync
    python mt5_sync.py

Stop: Press Ctrl+C in the terminal window.

## What it does

Every POLL_INTERVAL_SECONDS:

1. Fetches the sync queue from backend
2. For each account:
   - Marks sync as IN_PROGRESS via backend
   - Decrypts stored investor password (AES-256-GCM)
   - Connects to MT5 with login + investor_password + server
   - Fetches closed trades + deposits/withdrawals
   - Pushes results to backend (sync-complete)
   - On error, reports via sync-fail
3. Sleeps, then repeats

## Priority order

Backend serves jobs in this order:

1. User-requested — user clicked Request Update in dashboard
2. New pending — newly added account with platform_sync_status=PENDING
3. Stale active — ACTIVE accounts not synced in >6 hours
4. Breached/closed — one-time fetch, then marked SUCCESS forever

## Testing without touching backend

Set DRY_RUN=1 in .env. The worker still connects to MT5 and fetches data but does NOT POST to backend. Useful for debugging MT5 connection issues.

## Troubleshooting

MetaTrader5 package not installed:

    pip install MetaTrader5

MT5 initialize failed:

- Check login/password/server — investor password must be correct
- Ensure MT5 terminal is installed
- Try opening MT5 manually once to verify login works
- Check MT5_TERMINAL_PATH in .env if installed in non-default location

Decryption failed:

- TID_ENCRYPTION_KEY in .env does not match Render's value
- Credentials in DB were encrypted with a different key
- Ask admin to re-encrypt the password

Backend unreachable:

- Render free tier cold-starts after 15 min idle — first request may take 30-60 seconds
- Check internet connection
- Verify BACKEND_URL in .env

Queue is empty but accounts exist:

- Check platform_sync_status in DB
- Only accounts with platform_login + platform_password_encrypted + broker_server are queued
- Only accounts with server_whitelisted=1 or admin-approved are processed

## Logs

All output goes to stdout. Redirect to file if needed:

    python mt5_sync.py > sync.log 2>&1

## Security notes

- Never commit .env — it contains secrets
- Investor passwords are read-only — safe to store
- Backend API uses INTERNAL_SYNC_KEY for auth — keep it secret
- Worker only reads MT5 data; never trades

## Future: multi-platform

Currently only MT5 is supported. Future versions will add MT4, cTrader, TradeLocker. The worker design supports adapter pattern — add new adapter modules under backend/sync/adapters/.
