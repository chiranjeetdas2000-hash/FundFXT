═══════════════════════════════════════════
FUNDFXT + TRADERS ID — MASTER CONTEXT
═══════════════════════════════════════════
Last Updated: 11 October 2026
Owner: Chiranjeet Das (solo founder/dev)
Location: Ghaziabad, UP, India
═══════════════════════════════════════════

## PRODUCTS

1. **FundFXT** — Prop firm (challenges, trading terminal, payouts)
2. **Traders ID (TID)** — Verified trader career passport (free for traders)

**CRITICAL:** Both share ONE repo but are SEPARATE products.
- FundFXT files: `/frontend/*` (root) + `/frontend/admin/*` (root)
- TID files: `/frontend/tradersid/*` + `/frontend/admin/tid/*`
- Different auth: `fundfxt_token` vs `tid_token`
- NEVER touch one when working on the other

═══════════════════════════════════════════
BUSINESS MODEL
═══════════════════════════════════════════

TID:
- 100% FREE for traders forever
- B2B revenue Year 2+: firm SaaS, broker partnerships, data licensing
- Year 1 monetization: $2 per inactive account verification + $1/month service fee
- Live/Active accounts: FREE auto-sync, counts in score
- Closed/Breached (user just wants tracking): FREE sync, data visible, NO score impact
- Closed/Breached (user wants score improvement): $2 one-time + $1/month

Philosophy:
- Pips-based scoring (fund-size independent)
- Data must be REAL (broker-verified, not user-typed)
- Lifetime aggregate > per-account
- Mobile-first

═══════════════════════════════════════════
TECH STACK
═══════════════════════════════════════════

Frontend: Vercel (fundfxt.vercel.app → soon mytradingid.com)
Backend: Render (fundfxt.onrender.com) — free tier
Database: Aiven MySQL (defaultdb) — 43+ tables
Storage: Cloudflare R2 (bucket: tid-files)
Email: Resend (3000/month free) — currently support.fundfxt@gmail.com
Domain: mytradingid.com (purchased 11 Oct 2026, Cloudflare DNS active)
          rpelectrical.shop (purchased, pending nameserver fix)

═══════════════════════════════════════════
REPO STRUCTURE
═══════════════════════════════════════════

GitHub: chiranjeetdas2000-hash/FundFXT (branch: main)

backend/
├── server.js                    — mounts all routes
├── tid-routes.js                — core TID user API
├── tid-admin.js                 — TID admin API
├── tid-upload.js                — R2 file upload
├── tid-kyc.js                   — KYC submission
├── tid-crypto.js                — AES-256-GCM encryption
├── tid-kyc.js
├── sync/
│   ├── mt5_sync.py              — MT5 auto-sync worker
│   ├── encrypt.py               — Python encryption CLI
│   ├── requirements.txt
│   ├── .env.example
│   ├── start_sync.bat
│   └── README.md
├── database-control-preload.js  — admin SQL console
└── (FundFXT routes: trade-*, payment-*, admin-dashboard-*, etc.)

frontend/
├── home.html, Auth.html, dashboard.html, trading.html  (FundFXT)
├── admin/                                              (FundFXT admin)
├── tradersid/                                          (TID user pages)
│   ├── home.html, login.html, signup.html, dashboard.html
│   ├── account.html, firm.html (new), card.html, t.html
│   ├── verify-email.html, verify-identity.html
│   ├── css/tid.css, account.css, card-styles.css
│   ├── js/accounts.js, firms.js, acct-detail.js,
│   │     dashboard-extras.js, account-page.js, firm-page.js
│   └── legal/ (terms, privacy, etc.)
└── admin/tid/                                          (TID admin)
    ├── index.html, tid-admin.js
    ├── tid-payments.js, tid-update-queue.js
    └── database.html

═══════════════════════════════════════════
DATABASE SCHEMA (KEY TABLES)
═══════════════════════════════════════════

**tid_users** — Trader ID account (id, tid, email, password_hash, etc.)

**tid_profiles** — Extended profile (avatar_url, card_pattern, current_rank, etc.)

**tid_accounts** — Main accounts (Prop Firm + Broker)
Key columns:
- id, tid_user_id, firm_name, broker_name, account_category (PROP_FIRM/BROKER)
- account_type (CHALLENGE/FUNDED/LIVE), status (PENDING/ACTIVE/PASSED/FAILED/BREACHED/CLOSED)
- verification_status (NONE/TRACKING_ONLY/AWAITING_PAYMENT/PAID_REQUESTED/LINK_SENT/PAID_PENDING/VERIFIED/REJECTED)
- account_size_cents, account_currency, asset_class
- platform (MT5/MT4/CTRADER/...)
- platform_login, platform_password_encrypted (AES-256-GCM)
- platform_server, broker_server, server_whitelisted
- platform_sync_status (NONE/PENDING/IN_PROGRESS/SUCCESS/FAILED)
- platform_last_sync_at, last_synced_broker_trade_id (watermark)
- Aggregates: total_trades, total_wins, total_losses, total_pips,
  avg_win_pips, avg_loss_pips, best_trade_pips, worst_trade_pips,
  consistency_score, account_score, sum_pips_squared
- total_deposit_cents, total_withdrawal_cents, biggest_win_cents, biggest_loss_cents

**tid_trades**
- id, tid_user_id, account_id, broker_trade_id (unique per account)
- deal_ticket (MT5 deal id), symbol, direction, entry_price, exit_price,
  lot_size, pips, profit_cents, status, opened_at, closed_at, notes
- UNIQUE KEY uniq_broker_trade (account_id, broker_trade_id)

**tid_account_transactions**
- account_id, tx_type (DEPOSIT/WITHDRAWAL/PROFIT_ADJUSTMENT), amount_cents, tx_date, broker_tx_id

**tid_daily_passbook** — Daily snapshots for fast charts
- account_id, snapshot_date, cumulative_pips, cumulative_profit_cents,
  total_trades, avg_pips_per_trade

**tid_sync_log** — Per-account sync queue
- account_id (UNIQUE), sync_status (PENDING/IN_PROGRESS/SUCCESS/FAILED)
- attempts, error_message, triggered_by (USER/ADMIN/AUTO)
- started_at, completed_at, last_sync_at

**tid_broker_servers** — Server whitelist
- broker_name, server_name (UNIQUE), platform, verified

**tid_statements, tid_kyc_submissions, tid_payments,
tid_access_keys, tid_access_logs, tid_card_orders**

═══════════════════════════════════════════
MT5 AUTO-SYNC SYSTEM (WORKING ✅)
═══════════════════════════════════════════

Architecture:
- User adds account via dashboard → POST /accounts + POST /accounts/:id/platform-credentials
- Backend encrypts password (AES-256-GCM via tid-crypto.js)
- Server canonicalization: case-insensitive match against tid_broker_servers
- If whitelisted → platform_sync_status = PENDING
- If not whitelisted → admin review queue

Python worker (backend/sync/mt5_sync.py):
- Polls GET /api/admin/internal/sync-queue every 30s
- Uses MT5 Python API 5.0.6090 + Python 3.12 (compatible)
- Portable MT5 at C:\MT5-Portable\terminal64.exe (broker build has IPC bug)
- Per-account INI launch with /portable /config: flags
- **Fast path:** After first launch, MT5 stays alive, subsequent accounts via mt5.login()
- Session clear + kill per account (fresh INI per account)
- Fast switching: 3-5 sec/account after first boot

Backend endpoints (internal):
- GET /admin/internal/sync-queue — dedup by account_id
- POST /admin/internal/sync-start/:id
- POST /admin/internal/sync-complete/:id
- POST /admin/internal/sync-fail/:id
- Auth: x-internal-sync-key header (INTERNAL_SYNC_KEY env)

Admin endpoints:
- GET /admin/tid/server-review-queue — non-whitelisted accounts
- POST /admin/tid/accounts/:id/approve-server
- POST /admin/tid/accounts/:id/reject-server
- POST /admin/tid/accounts/:id/reject-sync
- POST /admin/tid/accounts/:id/allow-retry
- POST /admin/tid/accounts/:id/add-to-queue

Sync behavior:
- MAX 2 attempts → FAILED (admin review)
- Success resets attempts = 0
- SUCCESS + BREACHED/CLOSED → skip forever
- SUCCESS + ACTIVE/PASSED → re-sync after 24h stale
- server_whitelisted = 1 required for auto-sync

═══════════════════════════════════════════
WORKING FEATURES (LIVE)
═══════════════════════════════════════════

TID USER:
✅ Signup/login/email OTP
✅ Dashboard (Home/Accounts/Access/Profile/Cards/KYC)
✅ Mobile bottom nav + drawer sidebar
✅ Desktop sidebar (collapsed 76px → 240px hover)
✅ Add Account modal (Prop Firm + Broker + MT5 creds + status radio)
✅ Account status: ACTIVE/INACTIVE → maps to ACTIVE/BREACHED (prop) or ACTIVE/CLOSED (broker)
✅ Account canonicalization (case-insensitive server match)
✅ MT5 auto-sync (fully automatic via home PC worker)
✅ File upload (R2, max 2 files per account)
✅ Trade Passbook (14 cols: Date | Ticket | Type | Description | Pair | Dir | Lot | Entry | Exit | Pips | P/L | Amount | Balance | Status)
✅ Account Passbook (13 cols: + running balance)
✅ Money Flow: 4 cards (Deposited/Withdrawn/Trading P/L/Current Balance)
✅ Pips Analysis: Avg Win/Loss, R:R, Consistency, Best/Worst
✅ Lifetime Performance chart (snapshots → dates X-axis)
✅ Win/Loss donut
✅ Firm cards on dashboard (grouped accounts, aggregate stats)
✅ Firm page (firm.html) — hero + aggregate + nested accounts + Synced pills
✅ Access Keys system (AK-XXXXXXXX)
✅ Public profile (t.html)
✅ KYC submission flow
✅ Payment flow ($2 + $1/month) — admin manual
✅ Aggregates auto-recompute (incremental via watermark)
✅ Daily snapshots (tid_daily_passbook)

TID ADMIN:
✅ Overview stats
✅ KYC queue
✅ Account queue (pending verification only)
✅ Payment requests tab
✅ Update queue tab
✅ Users list
✅ Server review queue (backend) — UI pending
✅ Sync actions (Add to Queue / Allow Retry / Reject Sync buttons)
✅ Database SQL console

═══════════════════════════════════════════
PENDING / TODO
═══════════════════════════════════════════

IMMEDIATE:
⏳ mytradingid.com Vercel custom domain setup
⏳ Cloudflare Email Routing activate (support@mytradingid.com → Gmail)
⏳ Resend custom domain (noreply@mytradingid.com) — 3000/month
⏳ Backend CORS env update: FRONTEND_URL=https://mytradingid.com
⏳ rpelectrical.shop nameserver fix

SHORT TERM:
⏳ Server review queue UI (TID admin panel)
⏳ firm.html polish (combined equity curve, donut, money flow)
⏳ User form non-MT5 platforms (cTrader, TradeLocker manual upload)
⏳ Video verification admin UI (manual toggle)
⏳ Email templates (KYC approved/rejected, account verified, etc.)

LONG TERM:
⏳ MT5 scale to VPS (Year 2, 30-40 accounts/box)
⏳ Multi-platform adapters (cTrader, Kite, TradeLocker)
⏳ Physical card ordering flow
⏳ Multi-language support
⏳ Investor/firm subscription (B2B revenue)

═══════════════════════════════════════════
DEV WORKFLOW (STRICT)
═══════════════════════════════════════════

User uses Executor GPT for GitHub ops.
Assistant proposes diffs, user pastes in Executor.

RULES:
1. INSPECTION FIRST — paste current code with line numbers
2. PROPOSE DIFF — BEFORE/AFTER + files + impact
3. WAIT for "apply karo" / "Approved, apply"
4. Smallest diff, no reformatting
5. ONE TASK AT A TIME
6. Report "Existing features affected: NONE" always
7. Isolated files preferred (acct-detail.js, firms.js, etc.)
8. If Executor brace balance fails → split diff into chunks
9. NEVER delete files without confirmation
10. FundFXT and TID completely separate — ask "Kaunsa product?" if ambiguous

SQL handling:
- Executor GPT cannot run SQL
- User runs SQL in FundFXT admin console (fundfxt.vercel.app/admin/database.html) or Aiven Workbench
- Give SQL as code block → user runs → paste output

Render logs:
- Executor can't access
- User checks dashboard.render.com → Logs tab → screenshot

═══════════════════════════════════════════
TEST ACCOUNTS (USER 4 — Chiranjeet)
═══════════════════════════════════════════

TID: TID-9AY1B2T
Email: chiranjeetdas2000@gmail.com

Accounts:
- id=1: FundedNext, PASSED, no creds
- id=3: FTMO, PENDING, no creds
- id=5: For Traders $100K, BREACHED, login 191084
- id=6: For Traders $10K, BREACHED, login 657939
- id=7: For Traders $5K, BREACHED, login 167284
- id=8: For Traders $5K, BREACHED, login 279966
- id=9: For Traders $5K, BREACHED, login 395830
- id=12: For Traders $3K, login 261511 (recent test)
- id=13: For Traders $6K, login 681604
- id=14: For Traders $6K, login 465021
- id=4: Zerodha (BROKER), PENDING

MT5 Investor Passwords (all different):
- 191084 → Jeet@123
- 657939 → Investor@12
- 167284 → Investor@23
- 279966 → Investor@34
- 395830 → Investor@45

Firm "For Traders" server: FTTrading-Server (capital S)

═══════════════════════════════════════════
KEY ENV VARS (Render)
═══════════════════════════════════════════

DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME=defaultdb
JWT_SECRET
TID_ENCRYPTION_KEY (AES-256-GCM, 64-char hex)
INTERNAL_SYNC_KEY (Python worker auth)
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME=tid-files, R2_ENDPOINT
RESEND_API_KEY, EMAIL_FROM, EMAIL_USER, EMAIL_PASS
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET

═══════════════════════════════════════════
HANDOFF INSTRUCTIONS FOR NEW CHAT
═══════════════════════════════════════════

1. Paste this entire PROJECT.md at start of new chat
2. Say: "Ye mera PROJECT.md hai. Padho, samjho, ready ho jao."
3. Then state next task in 1 line

Assistant rules:
- Short Hinglish answers
- Direct action, no explanation
- Use → arrows, code blocks, bullets
- Never guess — inspect first
- One task at a time

═══════════════════════════════════════════
END OF PROJECT.md
═══════════════════════════════════════════