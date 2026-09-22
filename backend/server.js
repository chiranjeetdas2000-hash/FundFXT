require("./trading-day-preload");
require("./trade-pending-bridge");
require("./trade-engine-preload");
require("./payment-request-identity-preload");
require("./database-control-preload");
require("./payment-flow-preload");
require("./admin-dashboard-preload");

const WebSocket = require("ws");
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const crypto = require("crypto");
const { createRateLimiter, userRateLimiter } = require("./rate-limits");
require("dotenv").config();

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cors());

// ========== RATE LIMITERS ==========
// Public auth limits are IP-based. Authenticated limits are keyed by user ID.
const registerRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 });
const loginRateLimiter = createRateLimiter({ windowMs: 60 * 1000, limit: 10 });
const forgotPasswordRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 });
const verifyOtpRateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 10 });
const resetPasswordRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 });
const adminLoginRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 });

const tradeExecuteRateLimiter = userRateLimiter(30, 60 * 1000);
const tradeCloseRateLimiter = userRateLimiter(30, 60 * 1000);
const tradePendingRateLimiter = userRateLimiter(30, 60 * 1000);
const tradeModifyRateLimiter = userRateLimiter(30, 60 * 1000);
const tradeDeleteRateLimiter = userRateLimiter(30, 60 * 1000);
const pricesRateLimiter = userRateLimiter(120, 60 * 1000);
const accountsRateLimiter = userRateLimiter(60, 60 * 1000);

const walletWithdrawalRateLimiter = userRateLimiter(5, 60 * 60 * 1000);
const accountPayoutRateLimiter = userRateLimiter(5, 60 * 60 * 1000);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
    service: "FundFXT Backend"
  });
});


// ========== DATABASE ==========
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 25,
  queueLimit: 0,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await db.query("SELECT 1");
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ DB error:", err.message);
  }
})();



// ========== SECURITY CHECKS ==========
if (!process.env.JWT_SECRET) {
  console.error("❌ FATAL: JWT_SECRET is required");
  process.exit(1);
}

// ========== EMAIL (RESEND) - FIXED ==========
async function sendEmail(to, subject, html) {
  const API_KEY = process.env.EMAIL_PASS;
  const FROM_EMAIL = process.env.EMAIL_USER || "onboarding@resend.dev";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error("Email API Error: " + response.status);
}



// ========== PHASE REVIEW EMAIL ==========
async function sendPhaseEmail(customerEmail, customerName, traderId, accountCode, fromPhase, toPhase, status, reason, profitCents, targetCents) {
  try {
    const supportEmail = process.env.SUPPORT_EMAIL || "support.fundfxt@gmail.com";
    const escapeHtml = (value) =>
      String(value || "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      );
    const safeCustomerName = escapeHtml(customerName);
    const safeCustomerEmail = escapeHtml(customerEmail);
    const safeTraderId = escapeHtml(traderId);
    const safeAccountCode = escapeHtml(accountCode);
    const safeFromPhase = escapeHtml(fromPhase);
    const safeToPhase = escapeHtml(toPhase);
    const safeReason = escapeHtml(reason);
    const st = String(status || "").toUpperCase();
    const heading =
      st === "TARGET_HIT"
        ? "Phase Passed — Under Review"
        : st === "APPROVED"
          ? "Phase Approved — New Account Ready"
          : "Phase Review Rejected";
    const actionText =
      st === "TARGET_HIT"
        ? "Review and approve/reject"
        : st === "APPROVED"
          ? "Forward this customer-facing approval notice to the customer."
          : "Forward this customer-facing rejection notice to the customer.";
    const reasonRow = safeReason
      ? `<tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Reason</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;">${safeReason}</td></tr>`
      : "";
    const profit = (Number(profitCents || 0) / 100).toFixed(2);
    const target = (Number(targetCents || 0) / 100).toFixed(2);
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0b0e14;color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0e14;"><tr><td align="center" style="padding:32px 16px;"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#151924;border:1px solid #252b3a;border-radius:12px;"><tr><td style="padding:28px 30px 12px;"><div style="font-size:24px;font-weight:700;">Fund<span style="color:#00e59a;">FXT</span></div><div style="margin-top:6px;color:#8d96a8;font-size:13px;">Challenge Phase Notification</div></td></tr><tr><td style="padding:12px 30px 24px;"><div style="font-size:20px;font-weight:700;">${heading}</div></td></tr><tr><td style="padding:0 30px 24px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0e14;border:1px solid #252b3a;border-radius:8px;"><tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Customer Name</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;">${safeCustomerName}</td></tr><tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Customer Email</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;"><a href="mailto:${safeCustomerEmail}" style="color:#00e59a;">${safeCustomerEmail}</a></td></tr><tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Trader ID</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;">${safeTraderId}</td></tr><tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Account Code</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;">${safeAccountCode}</td></tr><tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Phase</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;">${safeFromPhase} → ${safeToPhase}</td></tr><tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Profit at Target</td><td style="padding:10px 12px;color:#00e59a;font-size:13px;">$${profit}</td></tr><tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Target Value</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;">$${target}</td></tr>${reasonRow}<tr><td style="padding:10px 12px;color:#8d96a8;font-size:13px;">Action Needed</td><td style="padding:10px 12px;color:#f4f7fb;font-size:13px;">${escapeHtml(actionText)}</td></tr></table></td></tr></table></td></tr></table></body></html>`;
    const subject =
      st === "TARGET_HIT"
        ? `[FundFXT] Phase Passed — ${customerEmail} — ${accountCode}`
        : st === "APPROVED"
          ? `[FundFXT] Phase Approved — ${customerEmail} — ${accountCode}`
          : `[FundFXT] Phase Rejected — ${customerEmail} — ${accountCode}`;
    await sendEmail(supportEmail, subject, html);
  } catch (error) {
    console.error("Phase email failed:", error.message);
  }
}

async function notifyTargetPassed(reviewId, accountId, userId) {
  try {
    const [rows] = await db.execute(`SELECT r.id, r.review_ref, r.from_phase, r.to_phase, r.target_snapshot, r.created_at, a.account_code, u.legal_name, u.email, u.trader_id, u.id AS user_id FROM account_phase_reviews r JOIN accounts a ON a.id = r.account_id JOIN users u ON u.id = r.user_id WHERE r.id = ? AND r.account_id = ? AND r.user_id = ? LIMIT 1`, [reviewId, accountId, userId]);
    if (!rows.length) return;
    const review = rows[0];
    const snapshot = typeof review.target_snapshot === "string" ? (() => { try { return JSON.parse(review.target_snapshot); } catch { return {}; } })() : (review.target_snapshot || {});
    await sendPhaseEmail(
      review.email,
      review.legal_name,
      review.trader_id,
      review.account_code,
      review.from_phase,
      review.to_phase,
      "TARGET_HIT",
      "",
      snapshot.profit_cents,
      snapshot.target_cents,
    );
    await createNotification(review.user_id, "phase_passed", `Phase ${review.from_phase} passed, review pending`, `Your ${review.from_phase} profit target has been reached. Your phase review is now pending.`, null);
  } catch (error) { console.error("Target-pass notification failed:", error.message); }
}

// ========== WALLET TRANSFER EMAIL ==========
async function sendWalletTransferEmail(
  customerEmail,
  customerName,
  traderId,
  status,
  amountCents,
  transferRef,
  reason,
) {
  // FundFXT EMAIL POLICY: Transactional emails are sent to support.fundfxt@gmail.com.
  // Admin manually forwards to customer. Email body MUST look customer-facing
  // (no admin-specific text). Reason: Resend free tier requires verified recipient.
  try {
    const escapeHtml = (value) =>
      String(value || "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );

    const supportEmail = process.env.SUPPORT_EMAIL || "support.fundfxt@gmail.com";
    if (!process.env.SUPPORT_EMAIL) {
      if (!sendWalletTransferEmail.supportEmailWarningLogged) {
        console.warn(
          "SUPPORT_EMAIL is not configured; using fallback support.fundfxt@gmail.com",
        );
        sendWalletTransferEmail.supportEmailWarningLogged = true;
      }
    }
    if (!supportEmail) {
      console.warn("Skipping wallet transfer email — SUPPORT_EMAIL is missing");
      return;
    }

    const safeCustomerName = escapeHtml(customerName);
    const safeCustomerEmail = escapeHtml(customerEmail);
    const safeTraderId = escapeHtml(traderId);
    const safeStatus = escapeHtml(status);
    const safeTransferRef = escapeHtml(transferRef);
    const safeReason = escapeHtml(reason);
    const amount = (Number(amountCents || 0) / 100).toFixed(2);
    const subjectPrefix =
      status === "APPROVED"
        ? "[FundFXT] Wallet Transfer Approved"
        : "[FundFXT] Wallet Transfer Rejected";
    const subject = `${subjectPrefix} — $${amount} — ${customerEmail}`;

    const reasonRow =
      status === "REJECTED"
        ? `<tr>
             <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Reason</td>
             <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeReason || "No reason provided."}</td>
           </tr>`
        : "";

    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b0e14;color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0e14;width:100%;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;background:#151924;border:1px solid #252b3a;border-radius:12px;">
            <tr>
              <td style="padding:28px 30px 12px;">
                <div style="font-size:24px;font-weight:700;letter-spacing:.4px;color:#f4f7fb;">Fund<span style="color:#00e59a;">FXT</span></div>
                <div style="margin-top:6px;color:#8d96a8;font-size:13px;">Wallet Transfer Notification</div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 30px 24px;">
                <div style="font-size:20px;font-weight:700;color:#f4f7fb;">Wallet Transfer ${safeStatus}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0e14;border:1px solid #252b3a;border-radius:8px;">
                  <tr>
                    <td colspan="2" style="padding:14px 12px;color:#00e59a;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Transfer Details</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;border-top:1px solid #252b3a;color:#8d96a8;font-size:13px;width:38%;">Customer Name</td>
                    <td style="padding:10px 12px;border-top:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeCustomerName || safeTraderId || "Trader"}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Customer Email</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;font-size:13px;"><a href="mailto:${safeCustomerEmail}" style="color:#00e59a;text-decoration:none;">${safeCustomerEmail}</a></td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Trader ID</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeTraderId || "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Amount</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#00e59a;font-size:13px;font-weight:700;">$${amount}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Transfer Reference</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeTransferRef}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;${status === "REJECTED" ? "border-bottom:1px solid #252b3a;" : ""}color:#8d96a8;font-size:13px;">Status</td>
                    <td style="padding:10px 12px;${status === "REJECTED" ? "border-bottom:1px solid #252b3a;" : ""}color:#00e59a;font-size:13px;font-weight:700;">${safeStatus}</td>
                  </tr>
                  ${reasonRow}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    await sendEmail(supportEmail, subject, html);
  } catch (error) {
    console.error("Wallet transfer email failed:", error.message);
  }
}

// ========== AFFILIATE SALES LEDGER ==========
// Sale history is stored separately and contains no customer PII.
async function ensureAffiliateSalesLedger() {
  try {
    await db.execute("INSERT INTO affiliates (user_id, affiliate_code, legal_name, total_sales, total_earnings_cents, pending_earnings_cents, status) SELECT u.id, u.affiliate_code, COALESCE(u.legal_name, u.email), 0, 0, 0, 'Active' FROM users u LEFT JOIN affiliates a ON a.user_id = u.id WHERE u.affiliate_code IS NOT NULL AND u.affiliate_code <> '' AND a.id IS NULL");
    await db.execute("CREATE TABLE IF NOT EXISTS affiliate_sales (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, affiliate_id BIGINT NOT NULL, order_id BIGINT NOT NULL, request_id VARCHAR(100) NOT NULL, affiliate_code VARCHAR(100) NULL, model VARCHAR(100) NULL, original_amount_cents BIGINT NOT NULL DEFAULT 0, discount_amount_cents BIGINT NOT NULL DEFAULT 0, final_amount_cents BIGINT NOT NULL DEFAULT 0, commission_rate_bps INT NOT NULL DEFAULT 2000, fixed_bonus_cents BIGINT NOT NULL DEFAULT 100, commission_amount_cents BIGINT NOT NULL DEFAULT 0, status VARCHAR(30) NOT NULL DEFAULT 'PENDING', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_affiliate_sales_order (affiliate_id, order_id), KEY idx_affiliate_sales_affiliate (affiliate_id, created_at))");
    await db.execute("INSERT IGNORE INTO affiliate_sales (affiliate_id, order_id, request_id, affiliate_code, model, original_amount_cents, discount_amount_cents, final_amount_cents, commission_rate_bps, fixed_bonus_cents, commission_amount_cents, status, created_at) SELECT a.id, po.id, po.request_id, po.affiliate_code, po.model, COALESCE(po.original_amount_cents,0), COALESCE(po.discount_amount_cents,0), COALESCE(po.final_amount_cents,0), 2000, 100, FLOOR(COALESCE(po.final_amount_cents,0) * 0.20 + 100), po.status, COALESCE(po.created_at, NOW()) FROM payment_requests po JOIN affiliates a ON a.affiliate_code = po.affiliate_code WHERE po.affiliate_code IS NOT NULL AND TRIM(po.affiliate_code) <> '' AND po.status IN ('PAYMENT_DONE')");
    await db.execute("UPDATE affiliate_sales s JOIN payment_requests po ON po.id = s.order_id SET s.status = po.status WHERE po.status IN ('PAYMENT_DONE')");
    await db.execute("INSERT INTO affiliate_commissions (affiliate_id, order_id, referred_user_id, model, commission_amount_cents, status) SELECT s.affiliate_id, s.order_id, po.user_id, s.model, s.commission_amount_cents, 'PENDING' FROM affiliate_sales s JOIN payment_requests po ON po.id = s.order_id LEFT JOIN affiliate_commissions ac ON ac.order_id = s.order_id WHERE ac.id IS NULL");
    await db.execute("INSERT IGNORE INTO affiliate_wallet_transactions (affiliate_id, txn_type, source, amount_cents, order_id, sale_status, commission_status, customer_email, account_code, description) SELECT a.id, 'CREDIT', 'COMMISSION', FLOOR(COALESCE(po.final_amount_cents,0) * 0.20 + 100), po.id, po.status, 'EARNED', u.email, po.account_code, CONCAT('Commission from ', po.model, ' for ', po.request_id) FROM payment_requests po JOIN affiliates a ON a.affiliate_code = po.affiliate_code JOIN users u ON u.id = po.user_id WHERE po.affiliate_code IS NOT NULL AND TRIM(po.affiliate_code) <> '' AND po.status IN ('PAYMENT_DONE')");
    await db.execute("UPDATE affiliate_wallet_transactions wt JOIN payment_requests po ON po.id = wt.order_id JOIN users u ON u.id = po.user_id SET wt.sale_status = po.status, wt.customer_email = u.email, wt.account_code = po.account_code, wt.description = CONCAT('Commission from ', po.model, ' for ', po.request_id) WHERE wt.source = 'COMMISSION' AND wt.order_id IS NOT NULL");
    await db.execute("UPDATE affiliates a LEFT JOIN (SELECT affiliate_id, COUNT(*) AS sales_count, COALESCE(SUM(commission_amount_cents),0) AS total_earnings, COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents,0),0)),0) AS pending_earnings, COALESCE(SUM(COALESCE(paid_amount_cents,0)),0) AS paid_earnings FROM affiliate_commissions GROUP BY affiliate_id) x ON x.affiliate_id = a.id SET a.total_sales = COALESCE(x.sales_count,0), a.total_earnings_cents = COALESCE(x.total_earnings,0), a.pending_earnings_cents = COALESCE(x.pending_earnings,0), a.paid_earnings_cents = COALESCE(x.paid_earnings,0)");
    const [walletRows] = await db.execute("SELECT id, affiliate_id, txn_type, amount_cents FROM affiliate_wallet_transactions ORDER BY affiliate_id ASC, created_at ASC, id ASC");
    let currentAffiliateId = null;
    let runningBalance = 0;
    for (const row of walletRows) {
      if (currentAffiliateId !== row.affiliate_id) {
        currentAffiliateId = row.affiliate_id;
        runningBalance = 0;
      }
      runningBalance += row.txn_type === 'CREDIT' ? Number(row.amount_cents || 0) : -Number(row.amount_cents || 0);
      await db.execute("UPDATE affiliate_wallet_transactions SET balance_after_cents = ? WHERE id = ?", [runningBalance, row.id]);
    }
    await db.execute("UPDATE affiliates a LEFT JOIN (SELECT affiliate_id, COALESCE(SUM(CASE WHEN txn_type = 'CREDIT' THEN amount_cents WHEN txn_type = 'DEBIT' THEN -amount_cents ELSE 0 END),0) AS wallet_balance FROM affiliate_wallet_transactions GROUP BY affiliate_id) w ON w.affiliate_id = a.id SET a.wallet_balance_cents = COALESCE(w.wallet_balance,0)");
    console.log('Affiliate sales ledger, wallet and historical passbook reconciled.');
  } catch (error) {
    console.error('Affiliate sales ledger migration failed:', error.message);
  }
}

// ========== AFFILIATE CODE GENERATOR ==========
function generateAffiliateCode() {
  const upperChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowerChars = "abcdefghijklmnopqrstuvwxyz";
  const numChars = "0123456789";
  const symbols = ["@", "#"];
  let chars = [];
  for (let i = 0; i < 3; i++)
    chars.push(upperChars[Math.floor(Math.random() * upperChars.length)]);
  for (let i = 0; i < 2; i++)
    chars.push(lowerChars[Math.floor(Math.random() * lowerChars.length)]);
  for (let i = 0; i < 3; i++)
    chars.push(numChars[Math.floor(Math.random() * numChars.length)]);
  chars.push("@");
  chars.push("#");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function getUniqueAffiliateCode() {
  let code = generateAffiliateCode();
  let [existing] = await db.execute(
    "SELECT id FROM users WHERE affiliate_code = ?",
    [code],
  );
  while (existing.length > 0) {
    code = generateAffiliateCode();
    [existing] = await db.execute(
      "SELECT id FROM users WHERE affiliate_code = ?",
      [code],
    );
  }
  return code;
}

// ========== REGISTER ==========
// Rate-limit account registration attempts per IP.
app.post("/api/register", registerRateLimiter, async (req, res) => {
  const {
    trader_id,
    email,
    phone,
    password,
    legal_name,
    address,
    referred_by_code,
  } = req.body;
  try {
    const [existing] = await db.execute(
      "SELECT * FROM users WHERE trader_id = ? OR email = ?",
      [trader_id, email],
    );
    if (existing.length)
      return res.status(400).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const newAffiliateCode = await getUniqueAffiliateCode();

    const [result] = await db.execute(
      `INSERT INTO users (trader_id, email, phone, password_hash, legal_name, address, is_verified, affiliate_code, referred_by_code, kyc_status, status) 
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'NOT_SUBMITTED', 'ACTIVE')`,
      [
        trader_id,
        email,
        phone,
        hashed,
        legal_name,
        address,
        newAffiliateCode,
        referred_by_code || null,
      ],
    );

    await db.execute(
      "INSERT INTO affiliates (user_id, affiliate_code, legal_name) VALUES (?, ?, ?)",
      [result.insertId, newAffiliateCode, legal_name],
    );

    const token = jwt.sign(
      { userId: result.insertId },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" },
    );
    res.json({
      success: true,
      token,
      account_code: null,
      affiliate_code: newAffiliateCode,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ========== LOGIN ==========
// Rate-limit user login attempts per IP.
app.post("/api/login", loginRateLimiter, async (req, res) => {
  const { identifier, password } = req.body;
  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE trader_id = ? OR email = ?",
      [identifier, identifier],
    );
    if (!rows.length) return res.status(400).json({ error: "User not found" });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: "Invalid password" });
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" },
    );
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ========== FORGOT PASSWORD (SECURE) ==========
// Rate-limit password reset initiation per IP.
app.post("/api/forgot-password", forgotPasswordRateLimiter, async (req, res) => {
  const { email } = req.body;
  try {
    const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (!rows.length) return res.status(400).json({ error: "Email not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Delete old OTPs & tokens
    await db.execute(
      'DELETE FROM email_verifications WHERE email = ? AND purpose = "PASSWORD_RESET"',
      [email],
    );

    // Insert new OTP + Reset Token
    await db.execute(
      `INSERT INTO email_verifications (email, purpose, otp_hash, reset_token_hash, expires_at) VALUES (?, ?, ?, ?, ?)`,
      [email, "PASSWORD_RESET", otpHash, resetTokenHash, expiresAt],
    );

    // Send OTP to Admin for manual forwarding
    const adminEmail = "support.fundfxt@gmail.com";
    await sendEmail(
      adminEmail,
      `Password Reset OTP for ${email}`,
      `<p>User Email: ${email}</p><p>OTP: <b>${otp}</b></p>`,
    ).catch((err) => console.log("Email failed:", err.message));

    // Return reset_token to frontend (this is the secure token for reset step)
    res.json({ success: true, reset_token: resetToken });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VERIFY OTP (Return reset_token)
// Rate-limit password-reset OTP verification per IP.
app.post("/api/verify-otp", verifyOtpRateLimiter, async (req, res) => {
  const { email, otp } = req.body;
  try {
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const [rows] = await db.execute(
      `SELECT reset_token_hash FROM email_verifications 
             WHERE email = ? AND otp_hash = ? AND purpose = 'PASSWORD_RESET' 
             AND expires_at > NOW() AND consumed_at IS NULL`,
      [email, otpHash],
    );
    if (!rows.length) return res.status(400).json({ error: "Invalid OTP" });

    res.json({ success: true, verified: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RESET PASSWORD (Now requires reset_token + OTP)
// Rate-limit password reset submissions per IP.
app.post("/api/reset-password", resetPasswordRateLimiter, async (req, res) => {
  const { email, otp, password, reset_token } = req.body;
  try {
    // Verify OTP + Token exist and valid
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(reset_token || "")
      .digest("hex");

    const [rows] = await db.execute(
      `SELECT * FROM email_verifications 
             WHERE email = ? AND otp_hash = ? AND reset_token_hash = ? 
             AND purpose = 'PASSWORD_RESET' AND expires_at > NOW() AND consumed_at IS NULL`,
      [email, otpHash, resetTokenHash],
    );
    if (!rows.length)
      return res.status(400).json({ error: "Invalid OTP or reset token" });

    // Update password
    const hashed = await bcrypt.hash(password, 10);
    await db.execute("UPDATE users SET password_hash = ? WHERE email = ?", [
      hashed,
      email,
    ]);

    // Consume OTP + token
    await db.execute(
      "UPDATE email_verifications SET consumed_at = NOW() WHERE email = ?",
      [email],
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ========== AUTH MIDDLEWARE ==========
function authenticateToken(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.userId = decoded.userId;
    next();
  });
}

// ========== USER PROFILE ==========
app.get("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, trader_id, legal_name, email, phone, address, kyc_status, affiliate_code FROM users WHERE id = ? LIMIT 1`,
      [req.userId],
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const user = rows[0];
    res.json({
      legal_name: user.legal_name,
      email: user.email,
      phone: user.phone,
      address: user.address,
      kyc_status: user.kyc_status,
      affiliate_code: user.affiliate_code || null,
    });
  } catch (error) {
    console.error("Profile DB Error:", error.message);
    res
      .status(500)
      .json({ error: "Column missing in database. Please run ALTER TABLE." });
  }
});

// ========== GET USER BY EMAIL ==========
app.get("/api/get-user-by-email", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email is required" });
  try {
    const [rows] = await db.execute(
      "SELECT legal_name, email, phone, address FROM users WHERE email = ?",
      [email],
    );
    if (rows.length > 0) {
      const user = rows[0];
      res.json({
        exists: true,
        name: user.legal_name,
        email: user.email,
        phone: user.phone,
        address: user.address,
      });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ========== ACCOUNTS ==========
// Rate-limit account list requests per authenticated user.
app.get("/api/accounts", authenticateToken, accountsRateLimiter, async (req, res) => {
  try {
    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE user_id = ?",
      [req.userId],
    );
    res.json({ accounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== PAYMENT ENGINE (using challenge_configs) ==========
const MODEL_MAP = {
  direct: "prototype_5k",
  two_step: "warrior_5k",
  prototype_5k: "prototype_5k",
  warrior_5k: "warrior_5k",
};

async function getChallengeConfig(modelKey) {
  const [rows] = await db.execute(
    "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
    [modelKey],
  );
  if (!rows.length) throw new Error("Invalid challenge model");
  return rows[0];
}

function parseChallengeModel(input) {
  const normalized = String(input || "").trim();

  const mapping = {
    prototype_5k: { model_key: "prototype", size_key: "5k" },
    warrior_5k: { model_key: "warrior", size_key: "5k" },
    warrior_10k: { model_key: "warrior", size_key: "10k" },
    warrior_15k: { model_key: "warrior", size_key: "15k" },
    warrior_25k: { model_key: "warrior", size_key: "25k" },
    direct: { model_key: "prototype", size_key: "5k" },
    two_step: { model_key: "warrior", size_key: "5k" },
    prototype: { model_key: "prototype", size_key: "5k" },
    warrior: { model_key: "warrior", size_key: "5k" },
  };

  return mapping[normalized] || null;
}

async function getChallengeSize(model_key, size_key) {
  const [rows] = await db.execute(
    "SELECT * FROM challenge_sizes WHERE model_key = ? AND size_key = ? AND is_active = 1 LIMIT 1",
    [model_key, size_key],
  );
  return rows.length ? rows[0] : null;
}

async function getChallengePhaseConfig(model_key, phase) {
  const [rows] = await db.execute(
    "SELECT * FROM challenge_phase_rules WHERE model_key = ? AND phase = ? AND is_active = 1 LIMIT 1",
    [model_key, phase],
  );
  return rows.length ? rows[0] : null;
}

async function getModelWithDefaultSize(model_key) {
  const [rows] = await db.execute(
    "SELECT * FROM challenge_sizes WHERE model_key = ? AND is_active = 1 ORDER BY starting_balance_cents ASC LIMIT 1",
    [model_key],
  );
  return rows.length ? rows[0] : null;
}

async function calculateServerPrice(model, affiliateCode) {
  const parsed = parseChallengeModel(model);

  let priceCents;
  let affiliateDiscountBps;
  let resolvedModel;
  let config;

  if (parsed && !["direct", "two_step"].includes(String(model || "").trim())) {
    const size = await getChallengeSize(parsed.model_key, parsed.size_key);
    if (size) {
      priceCents = Number(size.price_cents || 0);
      affiliateDiscountBps = Number(size.affiliate_discount_bps || 0);
      resolvedModel = parsed.model_key + "_" + parsed.size_key;
      config = size;
    }
  }

  if (priceCents === undefined) {
    const mappedModel = MODEL_MAP[model] || model;
    config = await getChallengeConfig(mappedModel);
    priceCents = Number(config.price_cents || 0);
    affiliateDiscountBps = Number(config.affiliate_discount_bps || 0);
    resolvedModel = mappedModel;
  }

  let discountAmountCents = 0,
    affiliateUserId = null,
    affiliateApplied = false;

  if (affiliateCode) {
    const [affiliateRows] = await db.execute(
      "SELECT id FROM users WHERE affiliate_code = ? LIMIT 1",
      [String(affiliateCode).trim()],
    );
    if (affiliateRows.length > 0) {
      affiliateUserId = affiliateRows[0].id;
      discountAmountCents = Math.floor(
        priceCents * (affiliateDiscountBps / 10000),
      );
      affiliateApplied = true;
    }
  }

  const finalAmount = Math.max(priceCents - discountAmountCents, 0);
  return {
    model: resolvedModel,
    originalAmountCents: priceCents,
    discountAmountCents,
    finalAmountCents: finalAmount,
    currency: String(process.env.PAYMENT_CURRENCY || "USD").toUpperCase(),
    affiliateApplied,
    affiliate_user_id: affiliateUserId,
    config,
  };
}

let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  const Razorpay = require("razorpay");
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  console.log("✅ Razorpay configured");
} else {
  console.warn("⚠️ Razorpay is not configured.");
}

// ========== PAYMENT QUOTE ==========
app.post("/api/payments/quote", authenticateToken, async (req, res) => {
  try {
    const pricing = await calculateServerPrice(
      req.body.model,
      req.body.affiliate_code,
    );
    res.json({ success: true, pricing });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Unable to calculate price" });
  }
});


// ========== ADMIN AUTH ==========
// Rate-limit admin login attempts per IP.
app.post("/api/admin/login", adminLoginRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const [admins] = await db.execute(
      "SELECT * FROM admin_users WHERE email = ?",
      [email],
    );
    if (!admins.length)
      return res.status(400).json({ error: "Admin not found" });
    const admin = admins[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(400).json({ error: "Invalid password" });
    const token = jwt.sign(
      { adminId: admin.id, role: admin.role },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "8h" },
    );
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function authenticateAdmin(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No admin token" });
  jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid admin token" });
    req.adminId = decoded.adminId;
    req.adminRole = decoded.role;
    next();
  });
}
// ========== ADMIN ROUTES ==========

// Get all users
app.get("/api/admin/users", authenticateAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      "SELECT id, trader_id, legal_name, email, phone, kyc_status, is_verified, affiliate_code, created_at FROM users ORDER BY created_at DESC",
    );
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve KYC
app.post(
  "/api/admin/users/:id/verify-kyc",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      await db.execute(
        "UPDATE users SET kyc_status = 'APPROVED' WHERE id = ?",
        [id],
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// Reset password
app.post(
  "/api/admin/users/:id/reset-password",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword)
      return res.status(400).json({ error: "New password required" });
    try {
      const hashed = await bcrypt.hash(newPassword, 10);
      await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
        hashed,
        id,
      ]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// Get payment orders
app.get("/api/admin/payment-orders", authenticateAdmin, async (req, res) => {
  const { status } = req.query;
  let query = `SELECT po.*, u.legal_name, u.email as user_email FROM payment_requests po JOIN users u ON po.user_id = u.id`;
  let params = [];
  if (status) {
    query += ` WHERE po.status = ?`;
    params.push(status);
  }
  query += ` ORDER BY po.created_at DESC`;
  try {
    const [orders] = await db.execute(query, params);
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update payment order status (with auto affiliate commission)
app.post(
  "/api/admin/payment-orders/:id/status",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const [orders] = await connection.execute(
        "SELECT * FROM payment_requests WHERE id = ? FOR UPDATE",
        [id],
      );
      if (!orders.length) throw new Error("Order not found");
      const order = orders[0];

      await connection.execute(
        "UPDATE payment_requests SET status = ? WHERE id = ?",
        [status, id],
      );

      // If payment done/approved, add affiliate commission
      
      if (
        status === "PAYMENT_DONE" &&
        order.affiliate_code
      ) {
        const [affiliateRows] = await connection.execute(
          "SELECT a.id AS affiliate_id, a.user_id FROM affiliates a JOIN users u ON u.id = a.user_id WHERE u.affiliate_code = ? LIMIT 1",
          [order.affiliate_code],
        );
        if (affiliateRows.length > 0) {
          const affiliate = affiliateRows[0];
          const commissionRateBps = 2000; // 20%
          const fixedBonusCents = 100; // $1.00
          const commissionCents = Math.floor(
            order.final_amount_cents * commissionRateBps / 10000 + fixedBonusCents,
          );
          const [existingComm] = await connection.execute(
            "SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1",
            [id],
          );
          if (existingComm.length === 0) {
            await connection.execute(
              `INSERT INTO affiliate_commissions (
                affiliate_id, order_id, referred_user_id, model,
                commission_amount_cents, original_amount_cents,
                discount_amount_cents, final_amount_cents, commission_rate_bps,
                fixed_bonus_cents, paid_amount_cents, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING')`,
              [
                affiliate.affiliate_id,
                id,
                order.user_id,
                order.model,
                commissionCents,
                order.original_amount_cents || 0,
                order.discount_amount_cents || 0,
                order.final_amount_cents || 0,
                commissionRateBps,
                fixedBonusCents,
              ],
            );
            await connection.execute(
              `UPDATE affiliates
               SET total_sales = total_sales + 1,
                   total_earnings_cents = COALESCE(total_earnings_cents, 0) + ?,
                   pending_earnings_cents = COALESCE(pending_earnings_cents, 0) + ?
               WHERE id = ?`,
              [commissionCents, commissionCents, affiliate.affiliate_id],
            );
          }
        }
      }

      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      res.status(500).json({ error: error.message });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

// Get withdrawals
app.get("/api/admin/withdrawals", authenticateAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "").toUpperCase();
    const allowedStatuses = ["PENDING", "APPROVED", "PAID", "REJECTED"];
    if (status && !allowedStatuses.includes(status)) return res.status(400).json({ error: "Invalid withdrawal status" });
    const where = status ? "AND wr.status = ?" : "";
    const params = status ? [status] : [];
    const [withdrawals] = await db.query(
      `SELECT wr.*, u.legal_name, u.email AS user_email, u.trader_id
       FROM withdrawal_request wr
       JOIN users u ON wr.user_id = u.id
       WHERE wr.kind = 'WALLET' ${where}
       ORDER BY wr.created_at DESC`,
      params,
    );
    res.json({ success: true, withdrawals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get affiliates
app.get("/api/admin/affiliates", authenticateAdmin, async (req, res) => {
  try {
    const [affiliates] = await db.query(`
            SELECT a.*, u.legal_name, u.email 
            FROM affiliates a JOIN users u ON a.user_id = u.id 
            ORDER BY a.total_earnings_cents DESC
        `);
    res.json({ success: true, affiliates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get certificates
app.get("/api/admin/certificates", authenticateAdmin, async (req, res) => {
  try {
    const [certs] = await db.query(`
            SELECT c.*, u.legal_name, a.account_code 
            FROM certificates c 
            JOIN users u ON c.user_id = u.id 
            LEFT JOIN accounts a ON c.account_id = a.id 
            ORDER BY c.issued_on DESC
        `);
    res.json({ success: true, certificates: certs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Issue certificate
app.post(
  "/api/admin/certificates/issue",
  authenticateAdmin,
  async (req, res) => {
    const { user_id, account_id, model, achievement } = req.body;
    try {
      const certRef =
        "CERT-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        crypto.randomBytes(3).toString("hex").toUpperCase();
      await db.execute(
        "INSERT INTO certificates (certificate_ref, user_id, account_id, model, achievement, issued_on) VALUES (?, ?, ?, ?, ?, CURDATE())",
        [certRef, user_id, account_id, model, achievement],
      );
      res.json({ success: true, cert_ref: certRef });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ========== BIQUOTE LIVE MARKET DATA ==========
const BIQUOTE_BASE = "https://biquote.io";
const BIQUOTE_SYMBOLS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURGBP",
  "EURJPY",
  "EURAUD",
  "EURCHF",
  "EURNZD",
  "GBPJPY",
  "GBPCHF",
  "GBPAUD",
  "GBPNZD",
  "AUDJPY",
  "AUDNZD",
  "AUDCAD",
  "AUDCHF",
  "CADJPY",
  "CADCHF",
  "CHFJPY",
  "NZDJPY",
  "NZDCHF",
  "NZDCAD",
  "XAUUSD",
  "XAGUSD",
];
global.prices = global.prices || {};
global.priceCache = global.priceCache || {};

function isForexWeekend() {
  const d = new Date().getUTCDay();
  return d === 0 || d === 6;
}

function normalizeBiQuoteTick(t) {
  if (!t || !t.symbol) return null;
  const symbol = String(t.symbol).toUpperCase();
  const bid = Number(t.bid),
    ask = Number(t.ask),
    mid = Number(t.mid);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  const m = Number.isFinite(mid) ? mid : (bid + ask) / 2;
  const spread = Number.isFinite(Number(t.spread))
    ? Number(t.spread)
    : Math.abs(ask - bid);
  const dayPct = Number(t.dayDiffPercent ?? t.changePercent ?? t.chp);
  const change = Number(t.changeAmount ?? t.change ?? t.ch);
  return {
    symbol,
    bid,
    ask,
    mid: m,
    // BiQuote documents last=0 for FX/CFD; mid is the usable last/single price.
    last:
      Number.isFinite(Number(t.last)) && Number(t.last) !== 0
        ? Number(t.last)
        : m,
    spread,
    spreadPercent: m ? (spread / m) * 100 : 0,
    change: Number.isFinite(change)
      ? change
      : Number.isFinite(dayPct)
        ? (m * dayPct) / 100
        : 0,
    changePercent: Number.isFinite(dayPct) ? dayPct : 0,
    marketState: t.marketState || "open",
    stale: Boolean(t.stale),
    quoteAgeSeconds: Number(t.quoteAgeSeconds || 0),
    updatedAt: Date.now(),
    source: "BiQuote",
  };
}

async function refreshBiQuotePrices() {
  const qs = BIQUOTE_SYMBOLS.map(
    (x) => "symbols=" + encodeURIComponent(x),
  ).join("&");
  const r = await fetch(BIQUOTE_BASE + "/api/latest?" + qs, {
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error("BiQuote HTTP " + r.status);
  const body = await r.json();
  const ticks = Array.isArray(body)
    ? body
    : Array.isArray(body.ticks)
      ? body.ticks
      : Array.isArray(body.data)
        ? body.data
        : [];
  const source =
    body &&
    body.data &&
    typeof body.data === "object" &&
    !Array.isArray(body.data)
      ? body.data
      : body;
  const list = ticks.length
    ? ticks
    : Object.entries(source || {}).map(([symbol, t]) => ({
        ...(t || {}),
        symbol: (t && t.symbol) || symbol,
      }));
  for (const raw of list) {
    const q = normalizeBiQuoteTick(raw);
    if (!q || !BIQUOTE_SYMBOLS.includes(q.symbol)) continue;
    global.prices[q.symbol] = q;
    global.priceCache[q.symbol] = q;
  }
  // Quotes remain available when the market is closed, but the trade engine must not mutate positions on weekends.
  if (!isForexWeekend() && typeof processLivePrices === "function") {
    processLivePrices().catch((e) =>
      console.error("BiQuote trade engine:", e.message),
    );
  }
  if (!isForexWeekend() && typeof processPendingOrders === "function") {
  processPendingOrders().catch((e) =>
    console.error("BiQuote pending engine:", e.message),
  );
}
  return global.prices;
}

refreshBiQuotePrices()
  .then(() => console.log("BiQuote feed connected"))
  .catch((e) => console.error("BiQuote initial fetch failed:", e.message));
setInterval(
  () =>
    refreshBiQuotePrices().catch((e) =>
      console.error("BiQuote refresh failed:", e.message),
    ),
  1000,
);


// ========== PENDING ORDER AUTO-EXECUTION ENGINE ==========
async function processPendingOrders() {
  const priceCache = global.priceCache || {};
  const [trades] = await db.execute(
    "SELECT * FROM trades WHERE status = 'PENDING' ORDER BY id ASC"
  );

  for (const trade of trades) {
    const price = priceCache[trade.symbol];

    if (!price) {
      continue;
    }

    const orderType = String(trade.order_type || "").toUpperCase();
    const requestedPrice = Number(trade.entry_price);
    const bid = Number(price.bid);
    const ask = Number(price.ask);

    if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
      continue;
    }

    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
      continue;
    }

    let shouldExecute = false;
    let executionPrice = 0;

    if (orderType === "BUY_LIMIT" || (orderType === "LIMIT" && trade.side === "BUY")) {
      if (ask <= requestedPrice) {
        shouldExecute = true;
        executionPrice = ask;
      }
    } else if (orderType === "SELL_LIMIT" || (orderType === "LIMIT" && trade.side === "SELL")) {
      if (bid >= requestedPrice) {
        shouldExecute = true;
        executionPrice = bid;
      }
    } else if (orderType === "BUY_STOP" || (orderType === "STOP" && trade.side === "BUY")) {
      if (ask >= requestedPrice) {
        shouldExecute = true;
        executionPrice = ask;
      }
    } else if (orderType === "SELL_STOP" || (orderType === "STOP" && trade.side === "SELL")) {
      if (bid <= requestedPrice) {
        shouldExecute = true;
        executionPrice = bid;
      }
    }

    if (!shouldExecute || !Number.isFinite(executionPrice) || executionPrice <= 0) {
      continue;
    }

    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE id = ? LIMIT 1",
      [trade.account_id],
    );

    if (!accounts.length || accounts[0].status !== "ACTIVE") {
      continue;
    }

    const account = accounts[0];
    const risk = await checkAccountRisk(account);
    if (risk.breached || !risk.allowed) {
      continue;
    }

    if (
      Number(trade.volume) < risk.minLot
      || Number(trade.volume) > risk.maxLot
    ) {
      continue;
    }

    const [result] = await db.execute(
      "UPDATE trades SET status = 'OPEN', order_type = ?, entry_price = ?, "
      + "entry_time = NOW(3), trading_day = CURDATE(), current_price = ?, "
      + "floating_profit_cents = 0, realized_profit_cents = 0 "
      + "WHERE trade_id = ? AND status = 'PENDING'",
      [
        orderType,
        executionPrice,
        executionPrice,
        trade.trade_id,
      ],
    );

    if (result.affectedRows === 1) {
      console.log(
        `Pending order executed: ${trade.trade_id} | ${trade.symbol} ${trade.side} @ ${executionPrice}`
      );
    }
  }
}

// Terminal market-data endpoint. Authenticated because the terminal is account-bound.
// Rate-limit terminal market-data polling per authenticated user.
app.get("/api/prices", authenticateToken, pricesRateLimiter, (req, res) => {
  res.json({
    success: true,
    source: "BiQuote",
    symbols: BIQUOTE_SYMBOLS,
    prices: global.prices || {},
  });
});

// Same account-scoped trade fetch used by the Account Dashboard.
app.get("/api/trade/get", authenticateToken, async (req, res) => {
  try {
    const accountCode = String(req.query.account_code || "").trim();
    const accountId = Number(req.query.account_id);

    if (!accountCode && !Number.isInteger(accountId))
      return res
        .status(400)
        .json({ success: false, error: "account_code or account_id is required" });

    let accounts;

    if (Number.isInteger(accountId)) {
      const sql =
        "SELECT id, account_code FROM accounts WHERE id = ? AND user_id = ? LIMIT 1";
      const params = [accountId, req.userId];
        [accounts] = await db.execute(sql, params);
    } else {
      // Fetch all user's accounts using numeric user_id matching (works reliably).
      const [allAccounts] = await db.execute(
        "SELECT id, account_code FROM accounts WHERE user_id = ?",
        [req.userId],
      );

      // Match account_code in JavaScript to avoid MySQL string-parameter collation issues.
      accounts = allAccounts.filter(
        (a) => a.account_code === accountCode,
      );

      if (!accounts.length) {
        const normalizedCode = accountCode
          .normalize("NFKC")
          .trim()
          .replace(/[–—−]/g, "-")
          .replace(/[^\x00-\x7F]/g, "");

        const fallback = allAccounts.filter(
          (a) => a.account_code === normalizedCode,
        );

        if (fallback.length) {
          accounts.push(...fallback);
        }
      }
    }

    if (!accounts.length) {
      return res
        .status(404)
        .json({ success: false, error: "Account not found" });
    }

    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE account_id = ? ORDER BY COALESCE(entry_time, created_at) DESC, id DESC",
      [accounts[0].id],
    );

    res.json({
      success: true,
      account_code: accounts[0].account_code,
      account_id: accounts[0].id,
      trades
    });
  } catch (e) {
    console.error("Trade fetch error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== TRADE ENGINE ==========
const instruments = {
  EURUSD: { pip: 0.0001, size: 100000 },
  GBPUSD: { pip: 0.0001, size: 100000 },
  USDCHF: { pip: 0.0001, size: 100000 },
  AUDUSD: { pip: 0.0001, size: 100000 },
  USDCAD: { pip: 0.0001, size: 100000 },
  NZDUSD: { pip: 0.0001, size: 100000 },
  EURGBP: { pip: 0.0001, size: 100000 },
  EURJPY: { pip: 0.01, size: 100000 },
  EURAUD: { pip: 0.0001, size: 100000 },
  EURCHF: { pip: 0.0001, size: 100000 },
  EURNZD: { pip: 0.0001, size: 100000 },
  GBPJPY: { pip: 0.01, size: 100000 },
  GBPCHF: { pip: 0.0001, size: 100000 },
  GBPAUD: { pip: 0.0001, size: 100000 },
  GBPNZD: { pip: 0.0001, size: 100000 },
  AUDJPY: { pip: 0.01, size: 100000 },
  AUDNZD: { pip: 0.0001, size: 100000 },
  AUDCAD: { pip: 0.0001, size: 100000 },
  AUDCHF: { pip: 0.0001, size: 100000 },
  CADJPY: { pip: 0.01, size: 100000 },
  CADCHF: { pip: 0.0001, size: 100000 },
  CHFJPY: { pip: 0.01, size: 100000 },
  NZDJPY: { pip: 0.01, size: 100000 },
  NZDCHF: { pip: 0.0001, size: 100000 },
  NZDCAD: { pip: 0.0001, size: 100000 },
  USDJPY: { pip: 0.01, size: 100000 },
  XAUUSD: { pip: 0.01, size: 100 },
  XAGUSD: { pip: 0.001, size: 5000 },
};

// Helper: safely get the mid rate for a symbol from the live price cache
function getMidRate(symbol) {
  const quote = global.priceCache && global.priceCache[symbol];
  if (!quote) return null;
  const mid = Number(quote.mid);
  if (Number.isFinite(mid) && mid > 0) return mid;
  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0) {
    return (bid + ask) / 2;
  }
  return null;
}

// Calculate realized / floating P/L in USD for any supported symbol
function calculatePL(symbol, side, entry, current, volume) {
  const inst = instruments[symbol];
  if (!inst) return 0;

  const entryNum = Number(entry);
  const currentNum = Number(current);
  const volumeNum = Number(volume);

  if (
    !Number.isFinite(entryNum) ||
    !Number.isFinite(currentNum) ||
    !Number.isFinite(volumeNum) ||
    entryNum <= 0 ||
    currentNum <= 0 ||
    volumeNum <= 0
  ) {
    return 0;
  }

  let diff = currentNum - entryNum;
  if (side === "SELL") diff = -diff;

  // P/L in the pair's quote currency
  const rawPL = diff * inst.size * volumeNum;
  const quoteCurrency = symbol.slice(-3);

  // USD-quoted pairs (EURUSD, GBPUSD, AUDUSD, XAUUSD, XAGUSD) — already USD
  if (quoteCurrency === "USD") {
    return rawPL;
  }

  // JPY-quoted pairs — divide by USD/JPY to convert JPY → USD
  if (quoteCurrency === "JPY") {
    const usdjpyRate =
      symbol === "USDJPY" ? currentNum : getMidRate("USDJPY");
    if (Number.isFinite(usdjpyRate) && usdjpyRate > 0) {
      return rawPL / usdjpyRate;
    }
    return rawPL;
  }

  // CHF-quoted pairs — divide by USD/CHF
  if (quoteCurrency === "CHF") {
    const usdchfRate =
      symbol === "USDCHF" ? currentNum : getMidRate("USDCHF");
    if (Number.isFinite(usdchfRate) && usdchfRate > 0) {
      return rawPL / usdchfRate;
    }
    return rawPL;
  }

  // CAD-quoted pairs — divide by USD/CAD
  if (quoteCurrency === "CAD") {
    const usdcadRate =
      symbol === "USDCAD" ? currentNum : getMidRate("USDCAD");
    if (Number.isFinite(usdcadRate) && usdcadRate > 0) {
      return rawPL / usdcadRate;
    }
    return rawPL;
  }

  // GBP-quoted cross pairs — multiply by GBP/USD
  if (quoteCurrency === "GBP") {
    const gbpusdRate = getMidRate("GBPUSD");
    if (Number.isFinite(gbpusdRate) && gbpusdRate > 0) {
      return rawPL * gbpusdRate;
    }
    return rawPL;
  }

  // EUR-quoted cross pairs — multiply by EUR/USD
  if (quoteCurrency === "EUR") {
    const eurusdRate = getMidRate("EURUSD");
    if (Number.isFinite(eurusdRate) && eurusdRate > 0) {
      return rawPL * eurusdRate;
    }
    return rawPL;
  }

  return rawPL;
}

// ========== STEP 1: TRADING ENGINE & RISK MANAGEMENT ==========

// 1. BREACH SETTLEMENT (Atomically close all open trades and settle account)
async function settleBreachedAccount(accountId, reason) {
  let connection;

  console.log("[BREACH SETTLE] Starting for account", accountId, "reason", reason);

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [accounts] = await connection.execute(
      "SELECT * FROM accounts WHERE id = ? FOR UPDATE",
      [accountId],
    );

    if (!accounts.length || accounts[0].status === "BREACHED") {
      await connection.rollback();
      return {
        success: true,
        skipped: true,
      };
    }

    const account = accounts[0];

    const [openTrades] = await connection.execute(
      "SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN' FOR UPDATE",
      [account.id],
    );

    let totalRealizedCents = 0;
    let closedCount = 0;
    let winCount = 0;
    let lossCount = 0;

    for (const trade of openTrades) {
      const price = global.priceCache?.[trade.symbol];

      if (!price) {
        throw new Error(`Price not available for ${trade.symbol}.`);
      }

      const exitPrice =
        trade.side === "BUY"
          ? Number(price.bid)
          : Number(price.ask);

      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        throw new Error(`Exit price unavailable for ${trade.symbol}.`);
      }

      const realizedCents = Math.round(
        calculatePL(
          trade.symbol,
          trade.side,
          trade.entry_price,
          exitPrice,
          trade.volume,
        ) * 100,
      );

      const [closeResult] = await connection.execute(
        "UPDATE trades SET status = 'CLOSED', exit_price = ?, exit_time = NOW(), current_price = ?, floating_profit_cents = 0, realized_profit_cents = ?, close_reason = 'BREACH', updated_at = NOW() WHERE id = ? AND status = 'OPEN'",
        [
          exitPrice,
          exitPrice,
          realizedCents,
          trade.id,
        ],
      );

      if (closeResult.affectedRows !== 1) {
        throw new Error(`Trade settlement failed for ${trade.id}.`);
      }

      totalRealizedCents += realizedCents;
      closedCount += 1;

      if (realizedCents > 0) {
        winCount += 1;
      } else if (realizedCents < 0) {
        lossCount += 1;
      }
    }

    let newBalanceCents =
      Number(account.balance_cents || 0) + totalRealizedCents;
    // A.4.1 — Cap balance at $0 to protect user from negative balance.
    // Trading result (realized_pnl_cents) preserves full loss for audit.
    // Firm absorbs any surplus below zero.
    if (newBalanceCents < 0) {
      newBalanceCents = 0;
    }

    const newEquityCents = newBalanceCents;  // all trades closed, no floating

    const [accountResult] = await connection.execute(
      "UPDATE accounts SET balance_cents = ?, equity_cents = ?, realized_pnl_cents = COALESCE(realized_pnl_cents, 0) + ?, total_closed_trades = COALESCE(total_closed_trades, 0) + ?, winning_trades = COALESCE(winning_trades, 0) + ?, losing_trades = COALESCE(losing_trades, 0) + ?, status = 'BREACHED', breached_at = NOW(), breach_reason = ?, end_date = NOW(), updated_at = NOW() WHERE id = ?",
      [
        newBalanceCents,
        newEquityCents,
        totalRealizedCents,
        closedCount,
        winCount,
        lossCount,
        reason,
        account.id,
      ],
    );

    if (accountResult.affectedRows !== 1) {
      throw new Error("Breach account settlement failed.");
    }

    console.log(
      "[BREACH SETTLE] Closed",
      closedCount,
      "trades, total P/L =",
      totalRealizedCents,
      "cents",
    );

    await connection.commit();

    console.log("[BREACH SETTLE] Committed");

    return {
      success: true,
      closed_trades: closedCount,
      winning_trades: winCount,
      losing_trades: lossCount,
      realized_profit_cents: totalRealizedCents,
      balance_cents: newBalanceCents,
      equity_cents: newEquityCents,
    };
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => {});
    }

    console.error("[BREACH SETTLE] Error:", error.message);

    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function checkAccountRisk(account) {
  const parsed = parseChallengeModel(account.challenge_model);

  let config;
  let configSource = "legacy";
  let model = parsed ? parsed.model_key : null;
  let size = parsed ? parsed.size_key : null;
  let phase = account.phase || null;

  if (parsed && phase) {
    const phaseConfig = await getChallengePhaseConfig(parsed.model_key, phase);
    if (phaseConfig) {
      config = phaseConfig;
      configSource = "challenge_phase_rules";
    }
  }

  if (!config) {
    config = await getChallengeConfig(account.challenge_model);
  }

  const maxTrades = config.max_trades_per_day;
  const maxTradesUnlimited = maxTrades === null || maxTrades === undefined;
  const maxOpenPositions =
    config.max_open_positions == null ? 1 : Number(config.max_open_positions);
  const minLot = config.min_lot == null ? 0.01 : Number(config.min_lot);
  const maxLot = config.max_lot == null ? 2.0 : Number(config.max_lot);
  const leverage = config.leverage == null ? null : Number(config.leverage);
  const profitTargetBps =
    config.profit_target_bps == null ? null : Number(config.profit_target_bps);
  const consistencyBps =
    config.consistency_bps == null ? null : Number(config.consistency_bps);
  const dailyDdBasis = String(config.daily_dd_basis || "BALANCE").toUpperCase();
  const maxDdBasis = String(config.max_dd_basis || "BALANCE").toUpperCase();

  const equity = Number(account.equity_cents || 0);
  const balance = Number(account.balance_cents || 0);
  const dayStartBalance = Number(
    account.day_start_balance_cents || account.initial_balance_cents || 0
  );
  const dayStartEquity = Number(
    account.day_start_equity_cents || account.equity_cents || account.initial_balance_cents || 0
  );
  const initialBalance = Number(account.initial_balance_cents || 0);
  const equityHwm = Number(
    account.equity_hwm_cents || account.equity_cents || account.initial_balance_cents || 0
  );

  let dailyLossLimit;
  let maxDrawdownLimit;
  let currentDailyLoss;
  let currentMaxDrawdown;
  let breached = false;
  let reason = "";

  if (dailyDdBasis === "EQUITY") {
    dailyLossLimit = (Number(config.daily_dd_bps || 0) / 10000) * dayStartEquity;
    currentDailyLoss = dayStartEquity - equity;
  } else {
    dailyLossLimit = (Number(config.daily_dd_bps || 0) / 10000) * dayStartBalance;
    currentDailyLoss = dayStartBalance - balance;
  }

  if (maxDdBasis === "TRAILING_EQUITY_HWM") {
    maxDrawdownLimit = (Number(config.max_dd_bps || 0) / 10000) * equityHwm;
    currentMaxDrawdown = equityHwm - equity;
  } else if (maxDdBasis === "EQUITY") {
    maxDrawdownLimit =
      (Number(config.max_dd_bps || 0) / 10000) * initialBalance;
    currentMaxDrawdown = initialBalance - equity;
  } else if (maxDdBasis === "TRAILING_BALANCE_HWM") {
    const balanceHwm = Number(
      account.balance_hwm_cents ?? account.initial_balance_cents ?? 0
    );
    maxDrawdownLimit =
      (Number(config.max_dd_bps || 0) / 10000) * balanceHwm;
    currentMaxDrawdown = balanceHwm - balance;
  } else {
    // existing BALANCE fallback (legacy)
    maxDrawdownLimit =
      (Number(config.max_dd_bps || 0) / 10000) * initialBalance;
    currentMaxDrawdown = initialBalance - balance;
  }

  if (currentDailyLoss >= dailyLossLimit) {
    breached = true;
    reason = "DAILY_LOSS_BREACH";
  } else if (currentMaxDrawdown >= maxDrawdownLimit) {
    breached = true;
    reason = "MAX_DRAWDOWN_BREACH";
  }

  const [tradeCountRow] = await db.execute(
    "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE()",
    [account.id],
  );
  const tradesToday = Number(tradeCountRow[0].count || 0);
  const tradeLimitReached =
    !maxTradesUnlimited && tradesToday >= Number(maxTrades);

  const [openPositionRow] = await db.execute(
    "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND status = 'OPEN'",
    [account.id],
  );
  const openPositions = Number(openPositionRow[0].count || 0);
  const positionLimitReached = openPositions >= maxOpenPositions;

  if (breached) {
    // Settlement is performed explicitly by each breach trigger.
  }

  return {
    breached,
    reason,
    allowed: !breached && !tradeLimitReached && !positionLimitReached,
    tradesToday,
    maxTrades: maxTrades,
    maxTradesUnlimited,
    dailyLossLimit: dailyLossLimit / 100,
    maxDrawdownLimit: maxDrawdownLimit / 100,
    currentDailyLoss: currentDailyLoss / 100,
    currentMaxDrawdown: currentMaxDrawdown / 100,
    model,
    size,
    phase,
    configSource,
    openPositions,
    maxOpenPositions,
    dailyDdBasis,
    maxDdBasis,
    minLot,
    maxLot,
    leverage,
    profitTargetBps,
    consistencyBps,
  };
}


async function calculateConsistencyScore(accountId) {
  try {
    const [rows] = await db.execute(
      "SELECT trading_day, SUM(realized_profit_cents) AS daily_pnl FROM trades WHERE account_id = ? AND status = 'CLOSED' AND realized_profit_cents > 0 AND trading_day IS NOT NULL GROUP BY trading_day HAVING daily_pnl > 0 ORDER BY daily_pnl DESC",
      [accountId],
    );
    if (!rows.length) {
      return { scoreBps: 0, highestDayCents: 0, totalProfitCents: 0 };
    }
    const highestDayCents = Number(rows[0].daily_pnl || 0);
    const totalProfitCents = rows.reduce(
      (sum, row) => sum + Number(row.daily_pnl || 0),
      0,
    );
    if (totalProfitCents <= 0) {
      return { scoreBps: 0, highestDayCents, totalProfitCents: 0 };
    }
    const scoreBps = Math.round(
      (highestDayCents / totalProfitCents) * 10000,
    );
    return { scoreBps, highestDayCents, totalProfitCents };
  } catch (error) {
    console.error("Consistency score error:", error);
    return { scoreBps: 0, highestDayCents: 0, totalProfitCents: 0 };
  }
}


async function settleClosedTrade(
  connection,
  { trade, exitPrice, closeReason, overrideRealizedCents = null, account },
) {
  const volume = Math.round(Number(trade.volume) * 100) / 100;
  const realizedCents =
    overrideRealizedCents == null
      ? Math.round(
          calculatePL(
            trade.symbol,
            trade.side,
            Number(trade.entry_price),
            Number(exitPrice),
            volume,
          ) * 100,
        )
      : Number(overrideRealizedCents);

  const [closeResult] = await connection.execute(
    "UPDATE trades SET status = 'CLOSED', exit_price = ?, exit_time = NOW(), current_price = ?, floating_profit_cents = 0, realized_profit_cents = ?, close_reason = ?, updated_at = NOW() WHERE trade_id = ? AND status = 'OPEN' AND volume = ?",
    [Number(exitPrice), Number(exitPrice), realizedCents, closeReason, trade.trade_id, volume],
  );

  if (closeResult.affectedRows !== 1) {
    throw new Error(`Trade settlement failed for ${trade.trade_id}.`);
  }

  const [floatingRows] = await connection.execute(
    "SELECT COALESCE(SUM(floating_profit_cents), 0) AS floating_cents FROM trades WHERE account_id = ? AND status = 'OPEN'",
    [trade.account_id],
  );
  const floatingCents = Number(floatingRows[0]?.floating_cents || 0);

  const [accountResult] = await connection.execute(
    "UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = balance_cents + ?, realized_pnl_cents = COALESCE(realized_pnl_cents, 0) + ?, total_closed_trades = COALESCE(total_closed_trades, 0) + 1, winning_trades = COALESCE(winning_trades, 0) + ?, losing_trades = COALESCE(losing_trades, 0) + ?, updated_at = NOW() WHERE id = ?",
    [realizedCents, floatingCents, realizedCents, realizedCents > 0 ? 1 : 0, realizedCents < 0 ? 1 : 0, trade.account_id],
  );

  if (accountResult.affectedRows !== 1) {
    throw new Error("Account settlement failed.");
  }

  const [accountRows] = await connection.execute(
    "SELECT balance_cents, equity_cents, balance_hwm_cents, equity_hwm_cents FROM accounts WHERE id = ? LIMIT 1",
    [trade.account_id],
  );
  const updatedAccount = accountRows[0] || account || {};
  const newBalance = Number(updatedAccount.balance_cents || 0);
  const newEquity = Number(updatedAccount.equity_cents || 0);
  const newHwm = Math.max(
    Number(updatedAccount.balance_hwm_cents || 0),
    Number(updatedAccount.equity_hwm_cents || 0),
  );

  console.log("[TRADE SETTLE]", trade.trade_id, closeReason, "realized_cents=", realizedCents, "balance_cents=", newBalance, "equity_cents=", newEquity);

  return { realizedCents, newBalance, newEquity, newHwm };
}

async function settlePartialRealized(connection, { account, realizedCents }) {
  const realized = Number(realizedCents || 0);
  const [floatingRows] = await connection.execute(
    "SELECT COALESCE(SUM(floating_profit_cents), 0) AS floating_cents FROM trades WHERE account_id = ? AND status = 'OPEN'",
    [account.id],
  );
  const floatingCents = Number(floatingRows[0]?.floating_cents || 0);

  const [accountResult] = await connection.execute(
    "UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = balance_cents + ?, realized_pnl_cents = COALESCE(realized_pnl_cents, 0) + ?, total_closed_trades = COALESCE(total_closed_trades, 0) + 1, winning_trades = COALESCE(winning_trades, 0) + ?, losing_trades = COALESCE(losing_trades, 0) + ?, updated_at = NOW() WHERE id = ?",
    [realized, floatingCents, realized, realized > 0 ? 1 : 0, realized < 0 ? 1 : 0, account.id],
  );
  if (accountResult.affectedRows !== 1) {
    throw new Error("Partial account settlement failed.");
  }

  const [accountRows] = await connection.execute(
    "SELECT balance_cents, equity_cents, balance_hwm_cents, equity_hwm_cents FROM accounts WHERE id = ? LIMIT 1",
    [account.id],
  );
  const updatedAccount = accountRows[0] || account;
  const newBalance = Number(updatedAccount.balance_cents || 0);
  const newEquity = Number(updatedAccount.equity_cents || 0);
  console.log("[PARTIAL SETTLE]", account.id, "realized_cents=", realized, "balance_cents=", newBalance, "equity_cents=", newEquity);

  return {
    realizedCents: realized,
    newBalance,
    newEquity,
    newHwm: Math.max(Number(updatedAccount.balance_hwm_cents || 0), Number(updatedAccount.equity_hwm_cents || 0)),
  };
}

async function evaluateProfitTargetLocked(connection, account) {
  if (!account || account.status !== "ACTIVE") {
    return { passed: false, reviewId: null };
  }

  const phase = String(account.phase || "").toUpperCase();
  if (phase === "FUNDED") {
    return { passed: false, reviewId: null };
  }

  const [existingReviews] = await connection.execute(
    "SELECT id, review_ref FROM account_phase_reviews WHERE account_id = ? AND status IN ('PENDING','RETRY_PENDING') LIMIT 1",
    [account.id],
  );
  if (existingReviews.length) {
    console.log("[TARGET] Existing pending review; skipping duplicate:", account.id, existingReviews[0].review_ref);
    return { passed: true, reviewId: existingReviews[0].id, reviewRef: existingReviews[0].review_ref };
  }

  const parsed = parseChallengeModel(account.challenge_model);
  if (!parsed) {
    console.warn("[TARGET] Unable to parse challenge model:", account.challenge_model);
    return { passed: false, reviewId: null };
  }

  const phaseConfig = await getChallengePhaseConfig(parsed.model_key, phase);
  if (!phaseConfig) {
    console.warn("[TARGET] No phase config for", parsed.model_key, phase);
    return { passed: false, reviewId: null };
  }

  const profitTargetBps = phaseConfig.profit_target_bps == null ? 0 : Number(phaseConfig.profit_target_bps);
  if (profitTargetBps <= 0) {
    return { passed: false, reviewId: null };
  }

  const targetCents = Math.round(Number(account.initial_balance_cents || 0) * profitTargetBps / 10000);

  const [freshRows] = await connection.execute(
    "SELECT * FROM accounts WHERE id = ? LIMIT 1",
    [account.id],
  );
  if (!freshRows.length || freshRows[0].status !== "ACTIVE") {
    return { passed: false, reviewId: null };
  }

  const currentAccount = freshRows[0];
  const currentProfitCents = Number(currentAccount.realized_pnl_cents || 0);
  if (currentProfitCents < targetCents) {
    return { passed: false, reviewId: null };
  }

  console.log("[TARGET] Profit target reached:", currentAccount.account_code, "phase=", phase, "profit_cents=", currentProfitCents, "target_cents=", targetCents);

  const [openTrades] = await connection.execute(
    "SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN' FOR UPDATE",
    [currentAccount.id],
  );
  let passClosedCount = 0;

  for (const trade of openTrades) {
    const price = global.priceCache?.[trade.symbol];
    if (!price) {
      throw new Error(`Price not available for PASS_CLOSE on ${trade.symbol}.`);
    }
    const exitPrice = trade.side === "BUY" ? Number(price.bid) : Number(price.ask);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      throw new Error(`Exit price unavailable for PASS_CLOSE on ${trade.symbol}.`);
    }

    await settleClosedTrade(connection, {
      trade,
      exitPrice,
      closeReason: "PASS_CLOSE",
      account: currentAccount,
    });
    passClosedCount += 1;
  }

  const [pendingResult] = await connection.execute(
    "UPDATE trades SET status = 'CANCELLED', exit_time = NOW(), updated_at = NOW() WHERE account_id = ? AND status = 'PENDING'",
    [currentAccount.id],
  );
  const pendingOrdersCancelled = Number(pendingResult.affectedRows || 0);

  const [finalRows] = await connection.execute(
    "SELECT * FROM accounts WHERE id = ? LIMIT 1",
    [currentAccount.id],
  );
  if (!finalRows.length) {
    throw new Error("Account disappeared during profit-target settlement.");
  }

  const finalAccount = finalRows[0];
  const finalProfitCents = Number(finalAccount.realized_pnl_cents || 0);
  const toPhase = phase === "PHASE_1" ? "PHASE_2" : phase === "PHASE_2" ? "FUNDED" : null;
  if (!toPhase) {
    console.warn("[TARGET] No next phase mapping for:", phase);
    return { passed: false, reviewId: null };
  }

  const targetSnapshot = {
    profit_cents: finalProfitCents,
    target_cents: targetCents,
    balance_cents: Number(finalAccount.balance_cents || 0),
    equity_cents: Number(finalAccount.equity_cents || 0),
    initial_balance_cents: Number(finalAccount.initial_balance_cents || 0),
    realized_pnl_cents: finalProfitCents,
    balance_hwm_cents: Number(finalAccount.balance_hwm_cents || 0),
    equity_hwm_cents: Number(finalAccount.equity_hwm_cents || 0),
    consistency_bps: null,
    open_trades_closed: passClosedCount,
    pending_orders_cancelled: pendingOrdersCancelled,
  };

  const reviewRef = "PR-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const [reviewResult] = await connection.execute(
    "INSERT INTO account_phase_reviews (review_ref, account_id, user_id, from_phase, to_phase, status, target_snapshot) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)",
    [reviewRef, finalAccount.id, finalAccount.user_id, phase, toPhase, JSON.stringify(targetSnapshot)],
  );

  const [passResult] = await connection.execute(
    "UPDATE accounts SET status = 'PASSED', updated_at = NOW() WHERE id = ? AND status = 'ACTIVE'",
    [finalAccount.id],
  );
  if (passResult.affectedRows !== 1) {
    throw new Error("Failed to mark account PASSED.");
  }

  console.log("[TARGET] Account PASSED:", finalAccount.account_code, "review_ref=", reviewRef, "review_id=", reviewResult.insertId);

  return { passed: true, reviewId: reviewResult.insertId, reviewRef };
}

async function createPhaseAccount(connection, { sourceAccount, phase }) {
  if (!sourceAccount) {
    throw new Error("Source account is required.");
  }

  const parsed = parseChallengeModel(sourceAccount.challenge_model);
  if (!parsed) {
    throw new Error(`Invalid challenge model: ${sourceAccount.challenge_model}`);
  }

  const nextPhase = String(phase || "").toUpperCase();
  if (!["PHASE_2", "FUNDED"].includes(nextPhase)) {
    throw new Error(`Invalid next phase: ${nextPhase}`);
  }

  const size = await getChallengeSize(parsed.model_key, parsed.size_key);
  if (!size) {
    throw new Error(`Challenge size not found for ${parsed.model_key}_${parsed.size_key}.`);
  }

  const startingBalanceCents = Number(size.starting_balance_cents || 0);
  const accountCode = "ACC-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const [result] = await connection.execute(
    "INSERT INTO accounts (account_code, user_id, challenge_model, phase, initial_balance_cents, balance_cents, equity_cents, day_start_balance_cents, day_start_equity_cents, equity_hwm_cents, balance_hwm_cents, status, parent_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
    [
      accountCode,
      sourceAccount.user_id,
      sourceAccount.challenge_model,
      nextPhase,
      startingBalanceCents,
      startingBalanceCents,
      startingBalanceCents,
      startingBalanceCents,
      startingBalanceCents,
      startingBalanceCents,
      startingBalanceCents,
      sourceAccount.id,
    ],
  );

  console.log("[PHASE ACCOUNT] Created:", accountCode, "parent=", sourceAccount.account_code, "phase=", nextPhase);

  return { accountId: result.insertId, accountCode };
}


// 2. MANUAL CLOSE TRADE (Real-time P/L at market price)
app.post(
  "/api/trades/:tradeId/close",
  authenticateToken,
  tradeCloseRateLimiter,
  async (req, res) => {
    if (isForexWeekend()) {
      return res.status(403).json({
        error: "Forex market is closed on weekends. Trading resumes Monday 00:00 UTC.",
        is_weekend: true
      });
    }

    let connection;

    try {
      connection = await Promise.race([
        db.getConnection(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "DB connection timeout after 10s — pool likely exhausted",
                ),
              ),
            10000,
          ),
        ),
      ]);
      await connection.beginTransaction();

      const [tradeMetaRows] = await connection.execute(
        "SELECT account_id FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN' LIMIT 1",
        [req.params.tradeId, req.userId],
      );

      if (!tradeMetaRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Open trade not found" });
      }

      const [accounts] = await connection.execute(
        "SELECT * FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE",
        [tradeMetaRows[0].account_id, req.userId],
      );

      if (!accounts.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Account not found" });
      }

      const account = accounts[0];

      const [trades] = await connection.execute(
        "SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN' FOR UPDATE",
        [req.params.tradeId, req.userId],
      );

      if (!trades.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Open trade not found" });
      }

      const trade = trades[0];
      const price = global.priceCache?.[trade.symbol];

      if (!price) {
        await connection.rollback();
        return res.status(400).json({ error: "Price not available" });
      }

      const exitPrice = trade.side === "BUY" ? Number(price.bid) : Number(price.ask);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        await connection.rollback();
        return res.status(400).json({ error: "Exit price is unavailable" });
      }

      const settlement = await settleClosedTrade(connection, {
        trade,
        exitPrice,
        closeReason: "MANUAL",
        account,
      });

      const targetResult = await evaluateProfitTargetLocked(connection, account);
      await connection.commit();

      if (targetResult.passed && targetResult.reviewId) {
        notifyTargetPassed(targetResult.reviewId, account.id, req.userId).catch((err) => console.error("Phase notify error:", err));
      }

      return res.json({
        success: true,
        trade_id: trade.trade_id,
        closed_volume: Math.round(Number(trade.volume) * 100) / 100,
        exit_price: exitPrice,
        realized_profit: settlement.realizedCents / 100,
        passed: targetResult.passed,
        review_id: targetResult.reviewId || null,
        review_ref: targetResult.reviewRef || null,
      });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      console.error("Manual close error:", error);
      return res.status(500).json({ error: error.message });
    } finally {
      if (connection) connection.release();
    }
  },
);

/* 2A. PARTIAL CLOSE TRADE */
app.post(
  "/api/trades/:tradeId/partial-close",
  authenticateToken,
  async (req, res) => {
    if (isForexWeekend()) {
      return res.status(403).json({
        error: "Forex market is closed on weekends. Trading resumes Monday 00:00 UTC.",
        is_weekend: true
      });
    }

    const requestedVolume = Number(req.body?.volume);
    if (!Number.isFinite(requestedVolume) || requestedVolume <= 0) {
      return res.status(400).json({ error: "Enter a valid lot size." });
    }

    const closeVolume = Math.round(requestedVolume * 100) / 100;
    if (Math.abs(requestedVolume - closeVolume) > 0.000001 || closeVolume < 0.01) {
      return res.status(400).json({ error: "Lot size must use 0.01 steps." });
    }

    let connection;

    try {
      connection = await Promise.race([
        db.getConnection(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("DB connection timeout after 10s — pool likely exhausted")),
            10000,
          ),
        ),
      ]);
      await connection.beginTransaction();

      const [tradeMetaRows] = await connection.execute(
        "SELECT account_id FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN' LIMIT 1",
        [req.params.tradeId, req.userId],
      );

      if (!tradeMetaRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Open trade not found." });
      }

      const [accounts] = await connection.execute(
        "SELECT * FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE",
        [tradeMetaRows[0].account_id, req.userId],
      );

      if (!accounts.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Account not found." });
      }

      const account = accounts[0];

      const [rows] = await connection.execute(
        "SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN' FOR UPDATE",
        [req.params.tradeId, req.userId],
      );

      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Open trade not found." });
      }

      const trade = rows[0];
      const currentVolume = Math.round(Number(trade.volume) * 100) / 100;

      if (!Number.isFinite(currentVolume) || currentVolume < 0.01) {
        await connection.rollback();
        return res.status(400).json({ error: "Current position volume is invalid." });
      }

      if (closeVolume >= currentVolume) {
        await connection.rollback();
        return res.status(400).json({
          error: closeVolume === currentVolume
            ? "You cannot close the full position with Partial Close. Use Close."
            : "Lots to close cannot be greater than the current position size.",
          current_volume: currentVolume,
          requested_volume: closeVolume,
        });
      }

      const remainingVolume = Math.round((currentVolume - closeVolume) * 100) / 100;
      if (remainingVolume < 0.01) {
        await connection.rollback();
        return res.status(400).json({
          error: "At least 0.01 lot must remain open.",
          current_volume: currentVolume,
          requested_volume: closeVolume,
        });
      }

      const price = global.priceCache?.[trade.symbol];
      if (!price) {
        await connection.rollback();
        return res.status(400).json({ error: "Price not available." });
      }

      const exitPrice = trade.side === "BUY" ? Number(price.bid) : Number(price.ask);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        await connection.rollback();
        return res.status(400).json({ error: "Exit price is unavailable." });
      }

      const realizedCents = Math.round(
        calculatePL(trade.symbol, trade.side, trade.entry_price, exitPrice, closeVolume) * 100,
      );
      const remainingFloatingCents = Math.round(
        calculatePL(trade.symbol, trade.side, trade.entry_price, exitPrice, remainingVolume) * 100,
      );

      const [updateResult] = await connection.execute(
        "UPDATE trades SET volume = ?, current_price = ?, floating_profit_cents = ?, updated_at = NOW() WHERE trade_id = ? AND user_id = ? AND status = 'OPEN' AND volume = ?",
        [remainingVolume, exitPrice, remainingFloatingCents, req.params.tradeId, req.userId, currentVolume],
      );

      if (updateResult.affectedRows !== 1) {
        await connection.rollback();
        return res.status(409).json({
          error: "Position changed before the partial close could be completed.",
        });
      }

      const partialTradeId =
        "PC-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

      await connection.execute(
        "INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, exit_price, exit_time, trading_day, stop_loss, take_profit, current_price, floating_profit_cents, realized_profit_cents, status, close_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, 'CLOSED', 'PARTIAL_CLOSE')",
        [
          partialTradeId,
          trade.account_id,
          trade.account_code,
          trade.user_id,
          trade.symbol,
          trade.side,
          closeVolume,
          trade.entry_price,
          trade.entry_time,
          exitPrice,
          trade.trading_day,
          trade.stop_loss,
          trade.take_profit,
          exitPrice,
          0,
          realizedCents,
        ],
      );

      const settlement = await settlePartialRealized(connection, { account, realizedCents });
      const targetResult = await evaluateProfitTargetLocked(connection, account);

      await connection.commit();

      if (targetResult.passed && targetResult.reviewId) {
        notifyTargetPassed(targetResult.reviewId, account.id, req.userId).catch((err) => console.error("Phase notify error:", err));
      }

      return res.json({
        success: true,
        trade_id: trade.trade_id,
        closed_trade_id: partialTradeId,
        closed_volume: closeVolume,
        remaining_volume: remainingVolume,
        exit_price: exitPrice,
        realized_profit: settlement.realizedCents / 100,
        passed: targetResult.passed,
        review_id: targetResult.reviewId || null,
        review_ref: targetResult.reviewRef || null,
      });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      console.error("Partial close error:", error);
      return res.status(500).json({ error: error.message });
    } finally {
      if (connection) connection.release();
    }
  },
);

// 3. MODIFY SL/TP
// Rate-limit SL/TP and pending-order modifications per authenticated user.
app.patch("/api/trades/:tradeId", authenticateToken, tradeModifyRateLimiter, async (req, res) => {
  const {
    stop_loss,
    take_profit,
    side,
    order_type,
    entry_price,
    volume,
  } = req.body || {};

  try {
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE trade_id = ? AND user_id = ? LIMIT 1",
      [req.params.tradeId, req.userId],
    );

    if (!trades.length) {
      return res.status(404).json({
        error: "Trade not found",
      });
    }

    const trade = trades[0];

    if (trade.status === "OPEN") {
      const nextStopLoss =
        stop_loss === undefined
          ? trade.stop_loss
          : stop_loss === null || stop_loss === ""
            ? null
            : Number(stop_loss);

      const nextTakeProfit =
        take_profit === undefined
          ? trade.take_profit
          : take_profit === null || take_profit === ""
            ? null
            : Number(take_profit);

      if (
        (nextStopLoss !== null && !Number.isFinite(nextStopLoss))
        || (nextTakeProfit !== null && !Number.isFinite(nextTakeProfit))
      ) {
        return res.status(400).json({
          error: "Invalid TP/SL price",
        });
      }

      if (nextStopLoss !== null && (String(trade.side).toUpperCase() === "BUY" ? nextStopLoss >= Number(trade.entry_price) : nextStopLoss <= Number(trade.entry_price))) {
        return res.status(400).json({ error: "Invalid Stop Loss for this direction" });
      }

      if (nextTakeProfit !== null && (String(trade.side).toUpperCase() === "BUY" ? nextTakeProfit <= Number(trade.entry_price) : nextTakeProfit >= Number(trade.entry_price))) {
        return res.status(400).json({ error: "Invalid Take Profit for this direction" });
      }

      await db.execute(
        "UPDATE trades SET stop_loss = ?, take_profit = ? WHERE trade_id = ?",
        [nextStopLoss, nextTakeProfit, req.params.tradeId],
      );

      return res.json({
        success: true,
        status: "OPEN",
        editable: "TP_SL_ONLY",
      });
    }

    if (trade.status !== "PENDING") {
      return res.status(400).json({
        error: "Only pending orders can change entry, direction or order type",
      });
    }

    const nextSide = String(
      side === undefined
        ? trade.side
        : side,
    ).toUpperCase();

    const nextOrderType = String(
      order_type === undefined
        ? trade.order_type
        : order_type,
    ).toUpperCase();

    const nextEntry =
      entry_price === undefined
        ? Number(trade.entry_price)
        : Number(entry_price);

    const nextVolume =
      volume === undefined
        ? Number(trade.volume)
        : Number(volume);

    if (!["BUY", "SELL"].includes(nextSide)) {
      return res.status(400).json({
        error: "Invalid trade direction",
      });
    }

    if (
      ![
        "BUY_LIMIT",
        "SELL_LIMIT",
        "BUY_STOP",
        "SELL_STOP",
      ].includes(nextOrderType)
    ) {
      return res.status(400).json({
        error: "Invalid pending order type",
      });
    }

    if (
      (nextOrderType.startsWith("BUY_") && nextSide !== "BUY")
      || (nextOrderType.startsWith("SELL_") && nextSide !== "SELL")
    ) {
      return res.status(400).json({
        error: "Order type does not match trade direction",
      });
    }

    if (!Number.isFinite(nextEntry) || nextEntry <= 0) {
      return res.status(400).json({ error: "Invalid pending entry price" });
    }

    if (!Number.isFinite(nextVolume) || nextVolume < 0.01 || nextVolume > 2) {
      return res.status(400).json({ error: "Volume must be between 0.01 and 2.00" });
    }

    const price = global.priceCache?.[trade.symbol] || {};
    const bid = Number(price.bid);
    const ask = Number(price.ask);

    if (nextOrderType === "BUY_LIMIT" && Number.isFinite(ask) && nextEntry >= ask) {
      return res.status(400).json({ error: "BUY LIMIT entry must be below current ask" });
    }

    if (nextOrderType === "SELL_LIMIT" && Number.isFinite(bid) && nextEntry <= bid) {
      return res.status(400).json({ error: "SELL LIMIT entry must be above current bid" });
    }

    if (nextOrderType === "BUY_STOP" && Number.isFinite(ask) && nextEntry <= ask) {
      return res.status(400).json({ error: "BUY STOP entry must be above current ask" });
    }

    if (nextOrderType === "SELL_STOP" && Number.isFinite(bid) && nextEntry >= bid) {
      return res.status(400).json({ error: "SELL STOP entry must be below current bid" });
    }

    const nextStopLoss =
      stop_loss === undefined
        ? trade.stop_loss
        : stop_loss === null || stop_loss === ""
          ? null
          : Number(stop_loss);

    const nextTakeProfit =
      take_profit === undefined
        ? trade.take_profit
        : take_profit === null || take_profit === ""
          ? null
          : Number(take_profit);

    if (
      (nextStopLoss !== null && !Number.isFinite(nextStopLoss))
      || (nextTakeProfit !== null && !Number.isFinite(nextTakeProfit))
    ) {
      return res.status(400).json({
        error: "Invalid TP/SL price",
      });
    }

    if (nextStopLoss !== null && (nextSide === "BUY" ? nextStopLoss >= nextEntry : nextStopLoss <= nextEntry)) {
      return res.status(400).json({ error: "Invalid Stop Loss for this direction" });
    }

    if (nextTakeProfit !== null && (nextSide === "BUY" ? nextTakeProfit <= nextEntry : nextTakeProfit >= nextEntry)) {
      return res.status(400).json({ error: "Invalid Take Profit for this direction" });
    }

    await db.execute(
      "UPDATE trades SET side = ?, order_type = ?, volume = ?, entry_price = ?, stop_loss = ?, take_profit = ? WHERE trade_id = ? AND user_id = ? AND status = 'PENDING'",
      [nextSide, nextOrderType, nextVolume, nextEntry, nextStopLoss, nextTakeProfit, req.params.tradeId, req.userId],
    );

    return res.json({
      success: true,
      status: "PENDING",
      editable: "ENTRY_DIRECTION_VOLUME_TP_SL",
      trade_id: req.params.tradeId,
    });
  } catch (error) {
    console.error("Trade modify error:", error);
    return res.status(500).json({
      error: error.message,
    });
  }
});

// 4. PENDING ORDERS (Limit & Stop)
// Rate-limit pending-order creation per authenticated user.
app.post("/api/trades/pending", authenticateToken, tradePendingRateLimiter, async (req, res) => {
    if (isForexWeekend()) {
      return res.status(403).json({
        error: "Forex market is closed on weekends. Trading resumes Monday 00:00 UTC.",
        is_weekend: true
      });
    }


  const {
    account_code,
    symbol,
    side,
    volume,
    order_type,
    limit_price,
    sl,
    tp,
  } = req.body || {};

  try {
    const accountCode = String(account_code || "").trim();
    const tradeSymbol = String(symbol || "").trim().toUpperCase();
    const tradeSide = String(side || "").trim().toUpperCase();
    const pendingType = String(order_type || "").trim().toUpperCase();
    const entryPrice = Number(limit_price);
    const tradeVolume = Number(volume);

    const stopLoss =
      sl === null || sl === "" || sl === undefined
        ? null
        : Number(sl);

    const takeProfit =
      tp === null || tp === "" || tp === undefined
        ? null
        : Number(tp);

    const validPendingTypes = new Set([
      "BUY_LIMIT",
      "SELL_LIMIT",
      "BUY_STOP",
      "SELL_STOP",
    ]);

    if (!accountCode) {
      return res.status(400).json({
        error: "account_code is required",
      });
    }

    if (!Object.prototype.hasOwnProperty.call(instruments, tradeSymbol)) {
      return res.status(400).json({
        error: "Invalid symbol",
      });
    }

    if (!["BUY", "SELL"].includes(tradeSide)) {
      return res.status(400).json({
        error: "Invalid trade direction",
      });
    }

    if (!validPendingTypes.has(pendingType)) {
      return res.status(400).json({
        error: "Invalid pending order type",
      });
    }

    if (
      (pendingType.startsWith("BUY_") && tradeSide !== "BUY")
      || (pendingType.startsWith("SELL_") && tradeSide !== "SELL")
    ) {
      return res.status(400).json({
        error: "Order type does not match trade direction",
      });
    }

    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return res.status(400).json({
        error: "Invalid pending entry price",
      });
    }

    if (
      (stopLoss !== null && !Number.isFinite(stopLoss))
      || (takeProfit !== null && !Number.isFinite(takeProfit))
    ) {
      return res.status(400).json({
        error: "Invalid TP/SL price",
      });
    }

    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE account_code = ? AND user_id = ? LIMIT 1",
      [accountCode, req.userId],
    );

    if (!accounts.length) {
      return res.status(404).json({
        error: "Account not found",
      });
    }

    const account = accounts[0];

    if (account.status !== "ACTIVE") {
      return res.status(403).json({
        error: "Account is not active for trading",
      });
    }

    const risk = await checkAccountRisk(account);

    if (risk.breached) {
      await settleBreachedAccount(account.id, risk.reason);
      return res.status(403).json({
        error: "Account breached. Trading disabled",
      });
    }

    if (
      !Number.isFinite(tradeVolume)
      || tradeVolume < risk.minLot
      || tradeVolume > risk.maxLot
    ) {
      return res.status(400).json({
        error: `Volume must be between ${risk.minLot} and ${risk.maxLot.toFixed(2)}`,
      });
    }

    const price = global.priceCache?.[tradeSymbol] || {};
    const bid = Number(price.bid);
    const ask = Number(price.ask);

    if (
      pendingType === "BUY_LIMIT"
      && Number.isFinite(ask)
      && ask > 0
      && entryPrice >= ask
    ) {
      return res.status(400).json({
        error: "BUY LIMIT entry must be below current ask",
      });
    }

    if (
      pendingType === "SELL_LIMIT"
      && Number.isFinite(bid)
      && bid > 0
      && entryPrice <= bid
    ) {
      return res.status(400).json({
        error: "SELL LIMIT entry must be above current bid",
      });
    }

    if (
      pendingType === "BUY_STOP"
      && Number.isFinite(ask)
      && ask > 0
      && entryPrice <= ask
    ) {
      return res.status(400).json({
        error: "BUY STOP entry must be above current ask",
      });
    }

    if (
      pendingType === "SELL_STOP"
      && Number.isFinite(bid)
      && bid > 0
      && entryPrice >= bid
    ) {
      return res.status(400).json({
        error: "SELL STOP entry must be below current bid",
      });
    }

    if (
      stopLoss !== null
      && (tradeSide === "BUY" ? stopLoss >= entryPrice : stopLoss <= entryPrice)
    ) {
      return res.status(400).json({
        error: "Invalid Stop Loss for this direction",
      });
    }

    if (
      takeProfit !== null
      && (tradeSide === "BUY" ? takeProfit <= entryPrice : takeProfit >= entryPrice)
    ) {
      return res.status(400).json({
        error: "Invalid Take Profit for this direction",
      });
    }

    const tradeId =
      "PD-"
      + Date.now().toString(36).toUpperCase()
      + "-"
      + crypto.randomBytes(2).toString("hex").toUpperCase();

    await db.execute(
      "INSERT INTO trades ("
      + "trade_id, account_id, account_code, user_id, symbol, side, order_type, volume, "
      + "entry_price, entry_time, trading_day, stop_loss, take_profit, current_price, "
      + "floating_profit_cents, realized_profit_cents, status"
      + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURDATE(), ?, ?, NULL, 0, 0, 'PENDING')",
      [
        tradeId,
        account.id,
        accountCode,
        req.userId,
        tradeSymbol,
        tradeSide,
        pendingType,
        tradeVolume,
        entryPrice,
        stopLoss,
        takeProfit,
      ],
    );

    return res.json({
      success: true,
      trade_id: tradeId,
      status: "PENDING",
      order_type: pendingType,
      message: "Pending order placed",
    });
  } catch (error) {
    console.error("Pending order placement error:", error);

    return res.status(500).json({
      error: error.message,
    });
  }
});

app.get("/api/trades/pending", authenticateToken, async (req, res) => {
  const accountCode = String(req.query.account_code || "").trim();

  try {
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE account_code = ? AND user_id = ? AND status = 'PENDING' ORDER BY created_at DESC, id DESC",
      [accountCode, req.userId],
    );

    return res.json({
      success: true,
      trades,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Rate-limit pending-order cancellation per authenticated user.
app.delete("/api/trades/:tradeId", authenticateToken, tradeDeleteRateLimiter, async (req, res) => {
  try {
    const [result] = await db.execute(
      "UPDATE trades SET status = 'CANCELLED', exit_time = NOW() WHERE trade_id = ? AND user_id = ? AND status = 'PENDING'",
      [req.params.tradeId, req.userId],
    );

    return res.json({
      success: true,
      cancelled: result.affectedRows > 0,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// 5. FLATTEN ALL (Close all open trades for an account)
app.post("/api/accounts/:id/flatten", authenticateToken, async (req, res) => {
  if (isForexWeekend()) {
    return res.status(403).json({
      error: "Forex market is closed on weekends. Trading resumes Monday 00:00 UTC.",
      is_weekend: true
    });
  }

  let connection;

  try {
    console.log("[FLATTEN] acquiring connection for account", req.params.id);

    connection = await Promise.race([
      db.getConnection(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("DB connection timeout after 10s — pool likely exhausted")),
          10000,
        ),
      ),
    ]);
    await connection.beginTransaction();

    const [accounts] = await connection.execute(
      "SELECT * FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE",
      [req.params.id, req.userId],
    );
    if (!accounts.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Account not found" });
    }

    const account = accounts[0];
    const [openTrades] = await connection.execute(
      "SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN' FOR UPDATE",
      [account.id],
    );

    let closedTradeCount = 0;
    let winningTradeCount = 0;
    let losingTradeCount = 0;
    let totalRealizedCents = 0;

    for (const trade of openTrades) {
      const price = global.priceCache?.[trade.symbol];
      if (!price) throw new Error(`Price not available for ${trade.symbol}.`);

      const exitPrice = trade.side === "BUY" ? Number(price.bid) : Number(price.ask);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        throw new Error(`Exit price unavailable for ${trade.symbol}.`);
      }

      const settlement = await settleClosedTrade(connection, {
        trade,
        exitPrice,
        closeReason: "FLATTEN",
        account,
      });

      totalRealizedCents += settlement.realizedCents;
      closedTradeCount += 1;
      if (settlement.realizedCents > 0) winningTradeCount += 1;
      else if (settlement.realizedCents < 0) losingTradeCount += 1;
    }

    const targetResult = await evaluateProfitTargetLocked(connection, account);

    const [freshAccountRows] = await connection.execute(
      "SELECT balance_cents, equity_cents FROM accounts WHERE id = ? LIMIT 1",
      [account.id],
    );
    const freshAccount = freshAccountRows[0] || {};

    await connection.commit();

    if (targetResult.passed && targetResult.reviewId) {
      notifyTargetPassed(targetResult.reviewId, account.id, req.userId).catch((err) => console.error("Phase notify error:", err));
    }

    console.log("[FLATTEN] committed successfully; passed=", targetResult.passed);

    return res.json({
      success: true,
      account_id: account.id,
      closed_trades: closedTradeCount,
      winning_trades: winningTradeCount,
      losing_trades: losingTradeCount,
      realized_profit: totalRealizedCents / 100,
      balance_cents: Number(freshAccount.balance_cents || 0),
      equity_cents: Number(freshAccount.equity_cents || 0),
      passed: targetResult.passed,
      review_id: targetResult.reviewId || null,
      review_ref: targetResult.reviewRef || null,
    });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch {}
    }
    console.error("FLATTEN FAILED:", error.message);
    return res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

async function processLivePrices() {
  const priceCache = global.priceCache || {};
  const [trades] = await db.execute("SELECT * FROM trades WHERE status = 'OPEN'");

  for (const trade of trades) {
    const price = priceCache[trade.symbol];
    if (!price) continue;

    const currentPrice = trade.side === "BUY" ? Number(price.bid) : Number(price.ask);
    const snapshotVolume = Math.round(Number(trade.volume) * 100) / 100;

    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(snapshotVolume) || snapshotVolume < 0.01) {
      continue;
    }

    const floatingCents = Math.round(
      calculatePL(trade.symbol, trade.side, Number(trade.entry_price), currentPrice, snapshotVolume) * 100,
    );

    const [tradeUpdate] = await db.execute(
      "UPDATE trades SET current_price = ?, floating_profit_cents = ? WHERE trade_id = ? AND status = 'OPEN' AND volume = ?",
      [currentPrice, floatingCents, trade.trade_id, snapshotVolume],
    );
    if (tradeUpdate.affectedRows !== 1) continue;

    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE id = ? LIMIT 1",
      [trade.account_id],
    );
    if (!accounts.length) continue;

    const account = accounts[0];

    const [floatingRows] = await db.execute(
      "SELECT COALESCE(SUM(floating_profit_cents), 0) AS floating_cents FROM trades WHERE account_id = ? AND status = 'OPEN'",
      [account.id],
    );
    const totalFloatingCents = Number(floatingRows[0]?.floating_cents || 0);
    const newEquity = Number(account.balance_cents || 0) + totalFloatingCents;

    if (account.challenge_model === "prototype_5k" && newEquity > Number(account.equity_hwm_cents || 0)) {
      await db.execute(
        "UPDATE accounts SET equity_hwm_cents = ? WHERE id = ?",
        [newEquity, account.id],
      );
    }

    await db.execute(
      "UPDATE accounts SET equity_cents = ? WHERE id = ?",
      [newEquity, account.id],
    );

    const [freshAccounts] = await db.execute(
      "SELECT * FROM accounts WHERE id = ? LIMIT 1",
      [account.id],
    );
    if (!freshAccounts.length) continue;

    const freshAccount = freshAccounts[0];
    const risk = await checkAccountRisk(freshAccount);

    if (risk.breached) {
      await settleBreachedAccount(account.id, risk.reason);
      continue;
    }

    let closeReason = null;

    if (trade.side === "BUY") {
      if (trade.stop_loss && currentPrice <= Number(trade.stop_loss)) closeReason = "SL";
      if (trade.take_profit && currentPrice >= Number(trade.take_profit)) closeReason = "TP";
    } else {
      if (trade.stop_loss && currentPrice >= Number(trade.stop_loss)) closeReason = "SL";
      if (trade.take_profit && currentPrice <= Number(trade.take_profit)) closeReason = "TP";
    }

    if (!closeReason) continue;

    let connection;

    try {
      connection = await Promise.race([
        db.getConnection(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("DB connection timeout after 10s — pool likely exhausted")),
            10000,
          ),
        ),
      ]);
      await connection.beginTransaction();

      const [lockedAccounts] = await connection.execute(
        "SELECT * FROM accounts WHERE id = ? FOR UPDATE",
        [trade.account_id],
      );
      if (!lockedAccounts.length || lockedAccounts[0].status !== "ACTIVE") {
        await connection.rollback();
        continue;
      }

      const lockedAccount = lockedAccounts[0];
      const [lockedTrades] = await connection.execute(
        "SELECT * FROM trades WHERE trade_id = ? AND status = 'OPEN' FOR UPDATE",
        [trade.trade_id],
      );
      if (!lockedTrades.length) {
        await connection.rollback();
        continue;
      }

      const lockedTrade = lockedTrades[0];
      const latestPrice = global.priceCache?.[lockedTrade.symbol];
      if (!latestPrice) throw new Error(`Price not available for ${lockedTrade.symbol} during ${closeReason}.`);

      const executablePrice = lockedTrade.side === "BUY" ? Number(latestPrice.bid) : Number(latestPrice.ask);
      if (!Number.isFinite(executablePrice) || executablePrice <= 0) {
        throw new Error(`Exit price unavailable for ${lockedTrade.symbol}.`);
      }

      const settlement = await settleClosedTrade(connection, {
        trade: lockedTrade,
        exitPrice: executablePrice,
        closeReason,
        account: lockedAccount,
      });
      const targetResult = await evaluateProfitTargetLocked(connection, lockedAccount);

      await connection.commit();

      if (targetResult.passed && targetResult.reviewId) {
        notifyTargetPassed(targetResult.reviewId, lockedTrade.account_id, lockedTrade.user_id).catch((err) => console.error("Phase notify error:", err));
      }

      console.log("[TP/SL SETTLE]", lockedTrade.trade_id, closeReason, "realized_cents=", settlement.realizedCents, "passed=", targetResult.passed);
    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch {}
      }
      console.error("[TP/SL SETTLE] Failed:", trade.trade_id, error.message);
    } finally {
      if (connection) connection.release();
    }
  }
}

// ========== TRADE EXECUTION ==========
app.post(
  "/api/trade/execute",
  authenticateToken,
  tradeExecuteRateLimiter,
  async (req, res) => {
    if (isForexWeekend()) {
      return res.status(403).json({
        error: "Forex market is closed on weekends. Trading resumes Monday 00:00 UTC.",
        is_weekend: true
      });
    }


    const {
      account_code,
      symbol,
      side,
      volume,
      sl,
      tp,
      client_price,
    } = req.body;

    if (!Object.prototype.hasOwnProperty.call(instruments, symbol)) {
      return res.status(400).json({
        error: "Invalid symbol",
      });
    }

    if (!["BUY", "SELL"].includes(side)) {
      return res.status(400).json({
        error: "Invalid trade direction",
      });
    }

    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE account_code = ? AND user_id = ?",
      [
        account_code,
        req.userId,
      ],
    );

    if (!accounts.length) {
      return res.status(404).json({
        error: "Account not found",
      });
    }

    const account = accounts[0];

    if (account.status !== "ACTIVE") {
      return res.status(403).json({
        error: "Account is not active for trading",
      });
    }

    const risk = await checkAccountRisk(
      account,
    );

    if (risk.breached) {
      await settleBreachedAccount(account.id, risk.reason);
      return res.status(403).json({
        error: "Account breached. Trading disabled",
      });
    }

    const volumeNum = Number(volume);

    if (
      !Number.isFinite(volumeNum)
      || volumeNum < risk.minLot
      || volumeNum > risk.maxLot
    ) {
      return res.status(400).json({
        error: `Volume must be between ${risk.minLot} and ${risk.maxLot.toFixed(2)}`,
      });
    }

    if (risk.openPositions >= risk.maxOpenPositions) {
      return res.status(403).json({
        error: `Maximum ${risk.maxOpenPositions} open position(s) allowed. Currently: ${risk.openPositions}`,
      });
    }

    if (!risk.allowed) {
      return res.status(403).json({
        error: `Trade not allowed. ${risk.reason || "Limit reached"}`,
      });
    }

    const price = global.priceCache?.[symbol];

    if (!price) {
      return res.status(400).json({
        error: "Price not available",
      });
    }

    const serverPrice =
      side === "BUY"
        ? Number(price.ask)
        : Number(price.bid);

    if (
      !Number.isFinite(serverPrice)
      || serverPrice <= 0
    ) {
      return res.status(400).json({
        error: "Server price unavailable",
      });
    }

    let entry = serverPrice;

    if (
      Number.isFinite(Number(client_price))
      && Number(client_price) > 0
    ) {
      const requestedPrice = Number(
        client_price,
      );
      const instrument = instruments[symbol];

      let slippageUnit = instrument.pip;

      if (/JPY$/i.test(symbol)) {
        slippageUnit = 0.01;
      } else if (/^XAUUSD$/i.test(symbol)) {
        slippageUnit = 0.1;
      }

      const maxSlippagePips = 2;
      const maxSlippage =
        slippageUnit * maxSlippagePips;
      const difference =
        Math.abs(
          requestedPrice - serverPrice,
        );

      if (difference <= maxSlippage) {
        entry = requestedPrice;
      } else {
        return res.status(409).json({
          error: "PRICE_MOVED",
          message:
            "Price moved too much since you clicked. Please try again.",
          client_price: requestedPrice,
          server_price: serverPrice,
          max_slippage_pips: maxSlippagePips,
        });
      }
    }

    const tradeId =
      "TR-"
      + Date.now()
        .toString(36)
        .toUpperCase();

    const tradingDay =
      new Date()
        .toISOString()
        .split("T")[0];

    await db.execute(
      `INSERT INTO trades (
        trade_id,
        account_id,
        account_code,
        user_id,
        symbol,
        side,
        order_type,
        volume,
        entry_price,
        entry_time,
        trading_day,
        stop_loss,
        take_profit,
        status
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, 'MARKET', ?, ?, NOW(), ?, ?, ?, 'OPEN'
      )`,
      [
        tradeId,
        account.id,
        account_code,
        req.userId,
        symbol,
        side,
        volume,
        entry,
        tradingDay,
        sl || null,
        tp || null,
      ],
    );

    return res.json({
      success: true,
      trade_id: tradeId,
      entry_price: entry,
      server_price: serverPrice,
      slippage:
        entry - serverPrice,
    });
  },
);
// ========== WEBSOCKET SERVER ==========
const PORT = process.env.PORT || 3000;
let server;
let wss;

(async () => {
  try {
    await ensureAffiliateSchema();
    await ensureAffiliateSalesLedger();
  } catch (migrationError) {
    console.error('Affiliate schema repair failed:', migrationError.message);
  }

  server = app.listen(PORT, () =>
    console.log(`🚀 Server running on port ${PORT}`),
  );

  wss = new WebSocket.Server({ server, path: "/ws" });
  wss.on("connection", (client) => {
    console.log("Frontend WebSocket connected");
    client.send(JSON.stringify({ type: "price", data: global.prices || {} }));
  });
})();

setInterval(() => {
  if (wss && global.prices && Object.keys(global.prices).length > 0) {
    const msg = JSON.stringify({ type: "price", data: global.prices });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }
}, 1000);

// ========== SEED DEFAULT ADMIN ===============================================================================
(async () => {
  try {
    const [admins] = await db.execute("SELECT id FROM admin_users LIMIT 1");
    if (admins.length === 0) {
      const defaultEmail = process.env.ADMIN_EMAIL || "admin@fundfxt.com";
      const defaultPassword = process.env.ADMIN_PASSWORD || "Admin@123";
      const hashed = await bcrypt.hash(defaultPassword, 10);
      await db.execute(
        "INSERT INTO admin_users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
        [defaultEmail, "FundFXT Admin", hashed, "SUPER_ADMIN"],
      );
      console.log("✅ Default admin created:", defaultEmail);
    }
  } catch (err) {
    console.error("Admin seed error:", err.message);
  }
})();

// ========== ADMIN CREATE ACCOUNT ==========
app.post(
  "/api/admin/payment-orders/:id/create-account",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    let connection;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      // Lock the payment order so two admin requests
      // cannot create two accounts simultaneously.
      const [orders] = await connection.execute(
        "SELECT * FROM payment_requests WHERE id = ? FOR UPDATE",
        [id],
      );

      if (!orders.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orders[0];

      // Duplicate account protection.
      if (order.account_code) {
        await connection.rollback();
        return res.status(400).json({
          error: "Account already created for this request",
          account_code: order.account_code
        });
      }

      // Account should only be created after payment is done.
      if (order.status !== "PAYMENT_DONE") {
        await connection.rollback();
        return res.status(400).json({
          error: "Account can only be created after PAYMENT_DONE",
        });
      }

      const parsed = parseChallengeModel(order.model);

      let startingBalanceCents;
      let resolvedModel = order.model;
      let initialPhase = "PHASE_1";

      if (parsed) {
        const [sizes] = await connection.execute(
          "SELECT * FROM challenge_sizes WHERE model_key = ? AND size_key = ? AND is_active = 1 LIMIT 1",
          [parsed.model_key, parsed.size_key],
        );

        if (sizes.length) {
          const size = sizes[0];
          startingBalanceCents = Number(size.starting_balance_cents);
          resolvedModel = parsed.model_key + "_" + parsed.size_key;

          if (parsed.model_key === "prototype") {
            initialPhase = "FUNDED";
          } else {
            initialPhase = "PHASE_1";
          }
        }
      }

      if (startingBalanceCents === undefined) {
        const config = await getChallengeConfig(order.model);
        startingBalanceCents = Number(config.starting_balance_cents);

        if (order.model === "prototype_5k") {
          initialPhase = "FUNDED";
        } else {
          initialPhase = "PHASE_1";
        }
      }

      const accountCode =
        "ACC-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        crypto.randomBytes(3).toString("hex").toUpperCase();

      await connection.execute(
        `INSERT INTO accounts (
          account_code,
          user_id,
          challenge_model,
          phase,
          initial_balance_cents,
          balance_cents,
          equity_cents,
          day_start_balance_cents,
          day_start_equity_cents,
          equity_hwm_cents,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [
          accountCode,
          order.user_id,
          resolvedModel,
          initialPhase,
          startingBalanceCents,
          startingBalanceCents,
          startingBalanceCents,
          startingBalanceCents,
          startingBalanceCents,
          startingBalanceCents,
        ],
      );

      await connection.execute(
        `UPDATE payment_requests
         SET status = 'PAYMENT_DONE',
             account_code = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [accountCode, id],
      );

      // Affiliate commission is created only by PAYMENT_DONE.

      await connection.commit();

      return res.json({
        success: true,
        account_code: accountCode,
        status: "PAYMENT_DONE",
      });
    } catch (error) {
      await connection.rollback();

      console.error("Create account transaction failed:", error);

      return res.status(500).json({
        error: error.message,
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);
// ---------- GET USER ORDERS (Example) ----------
// GET User's Orders
app.get("/api/orders", authenticateToken, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT request_id, model, original_amount_cents, discount_amount_cents, final_amount_cents, currency, status, created_at
             FROM payment_requests
             WHERE user_id = ?
             ORDER BY created_at DESC`,
      [req.userId],
    );
    res.json({ success: true, orders });
  } catch (error) {
    console.error("Fetch user orders error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== GET DASHBOARD STATS (Complete Summary) ==========
app.get("/api/dashboard/stats", authenticateToken, async (req, res) => {
  try {
    // 1. User ke saare accounts fetch karo
    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE user_id = ?",
      [req.userId],
    );

    // 2. User ke saare orders fetch karo
    const [orders] = await db.execute(
      `SELECT request_id, model, final_amount_cents, status, created_at FROM payment_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [req.userId],
    );

    // 3. Statistics calculate karo
    const totalAccounts = accounts.length;
    const activeAccounts = accounts.filter((a) => a.status === "ACTIVE").length;
    const passedAccounts = accounts.filter((a) => a.status === "PASSED").length;
    const failedAccounts = accounts.filter((a) =>
      ["BREACHED", "EXPIRED", "CLOSED"].includes(a.status),
    ).length;
    const totalProfit =
      accounts.reduce(
        (sum, a) => sum + (a.equity_cents - a.initial_balance_cents),
        0,
      ) / 100;

    res.json({
      success: true,
      stats: {
        totalAccounts,
        activeAccounts,
        passedAccounts,
        failedAccounts,
        totalProfit: totalProfit.toFixed(2),
      },
      recentActivity: orders, // Last 5 orders
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== WITHDRAWAL RULES & REQUEST ==========

// 1. Get Challenge Rules for a selected Account's Model
// Public challenge catalog
app.get("/api/challenges/catalog", async (req, res) => {
  try {
    const [sizes] = await db.execute(
      "SELECT model_key, size_key, display_name, starting_balance_cents, price_cents, affiliate_discount_bps FROM challenge_sizes WHERE is_active = 1 ORDER BY model_key, starting_balance_cents ASC",
    );
    const [rules] = await db.execute(
      "SELECT model_key, phase, profit_target_bps, daily_dd_bps, max_dd_bps, consistency_bps, leverage, max_trades_per_day, max_open_positions, min_lot, max_lot FROM challenge_phase_rules WHERE is_active = 1 ORDER BY model_key, phase",
    );
    const rulesByModel = {};
    for (const r of rules) {
      if (!rulesByModel[r.model_key]) rulesByModel[r.model_key] = [];
      rulesByModel[r.model_key].push({
        phase:r.phase, profit_target_bps:r.profit_target_bps, daily_dd_bps:r.daily_dd_bps,
        max_dd_bps:r.max_dd_bps, consistency_bps:r.consistency_bps, leverage:r.leverage,
        max_trades_per_day:r.max_trades_per_day, max_open_positions:r.max_open_positions,
        min_lot:r.min_lot, max_lot:r.max_lot,
      });
    }
    const challenges = sizes.map(s => ({
      model:s.model_key, size:s.size_key, model_key:s.model_key + "_" + s.size_key,
      display_name:s.display_name, starting_balance_cents:s.starting_balance_cents,
      price_cents:s.price_cents, affiliate_discount_bps:s.affiliate_discount_bps,
      phases:rulesByModel[s.model_key] || [],
    }));
    res.json({ success:true, challenges });
  } catch (error) {
    console.error("Catalog error:", error);
    res.status(500).json({ error:error.message });
  }
});

app.get("/api/challenges/:model", async (req, res) => {
  try {
    const [config] = await db.execute(
      "SELECT * FROM challenge_configs WHERE model_key = ?",
      [req.params.model],
    );
    if (!config.length)
      return res.status(404).json({ error: "Challenge not found" });
    res.json({ success: true, config: config[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function sendWithdrawalEmail(
  customerEmail,
  customerName,
  traderId,
  status,
  amountCents,
  requestRef,
  reason,
) {
  try {
    const escapeHtml = (value) =>
      String(value || "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      );
    const supportEmail = process.env.SUPPORT_EMAIL || "support.fundfxt@gmail.com";
    if (!process.env.SUPPORT_EMAIL && !sendWithdrawalEmail.supportEmailWarningLogged) {
      console.warn("SUPPORT_EMAIL is not configured; using fallback support.fundfxt@gmail.com");
      sendWithdrawalEmail.supportEmailWarningLogged = true;
    }
    if (!supportEmail) return;
    const safeCustomerName = escapeHtml(customerName);
    const safeCustomerEmail = escapeHtml(customerEmail);
    const safeTraderId = escapeHtml(traderId);
    const safeStatus = escapeHtml(status);
    const safeRequestRef = escapeHtml(requestRef);
    const safeReason = escapeHtml(reason);
    const amount = (Number(amountCents || 0) / 100).toFixed(2);
    const subjectPrefix = status === "APPROVED"
      ? "[FundFXT] Withdrawal Approved"
      : status === "REJECTED"
        ? "[FundFXT] Withdrawal Rejected"
        : "[FundFXT] Withdrawal Request Received";
    const subject = `${subjectPrefix} — $${amount} — ${customerEmail}`;
    const reasonRow = status === "REJECTED"
      ? `<tr><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Reason</td><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeReason || "No reason provided."}</td></tr>`
      : "";
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0b0e14;color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0e14;width:100%;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;background:#151924;border:1px solid #252b3a;border-radius:12px;"><tr><td style="padding:28px 30px 12px;"><div style="font-size:24px;font-weight:700;letter-spacing:.4px;color:#f4f7fb;">Fund<span style="color:#00e59a;">FXT</span></div><div style="margin-top:6px;color:#8d96a8;font-size:13px;">Withdrawal Notification</div></td></tr><tr><td style="padding:12px 30px 24px;"><div style="font-size:20px;font-weight:700;color:#f4f7fb;">Withdrawal ${safeStatus}</div></td></tr><tr><td style="padding:0 30px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0e14;border:1px solid #252b3a;border-radius:8px;"><tr><td colspan="2" style="padding:14px 12px;color:#00e59a;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Withdrawal Details</td></tr><tr><td style="padding:10px 12px;border-top:1px solid #252b3a;color:#8d96a8;font-size:13px;width:38%;">Customer Name</td><td style="padding:10px 12px;border-top:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeCustomerName || safeTraderId || "Trader"}</td></tr><tr><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Customer Email</td><td style="padding:10px 12px;border-bottom:1px solid #252b3a;font-size:13px;"><a href="mailto:${safeCustomerEmail}" style="color:#00e59a;text-decoration:none;">${safeCustomerEmail}</a></td></tr><tr><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Trader ID</td><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeTraderId || "—"}</td></tr><tr><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Amount</td><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#00e59a;font-size:13px;font-weight:700;">$${amount}</td></tr><tr><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#8d96a8;font-size:13px;">Request Reference</td><td style="padding:10px 12px;border-bottom:1px solid #252b3a;color:#f4f7fb;font-size:13px;">${safeRequestRef}</td></tr><tr><td style="padding:10px 12px;${status === "REJECTED" ? "border-bottom:1px solid #252b3a;" : ""}color:#8d96a8;font-size:13px;">Status</td><td style="padding:10px 12px;${status === "REJECTED" ? "border-bottom:1px solid #252b3a;" : ""}color:#00e59a;font-size:13px;font-weight:700;">${safeStatus}</td></tr>${reasonRow}</table></td></tr></table></td></tr></table></body></html>`;
    await sendEmail(supportEmail, subject, html);
  } catch (error) {
    console.error("Withdrawal email failed:", error.message);
  }
}

// Rate-limit wallet withdrawal requests per authenticated user.
app.post("/api/user/wallet/withdrawals/request", authenticateToken, walletWithdrawalRateLimiter, async (req, res) => {
  const { amount_cents, method, details } = req.body;
  let connection;
  try {
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) return res.status(400).json({ error: "Withdrawal amount must be a positive integer in cents" });
    if (!["UPI", "CRYPTO"].includes(method)) return res.status(400).json({ error: "Withdrawal method must be UPI or CRYPTO" });
    if (method === "UPI" && !String(details?.upi_id || "").trim()) return res.status(400).json({ error: "UPI ID is required" });
    if (method === "CRYPTO" && (!String(details?.wallet_address || "").trim() || !String(details?.network || "").trim())) return res.status(400).json({ error: "Crypto wallet address and network are required" });

    const [pendingRow] = await db.execute(
      "SELECT id FROM withdrawal_request WHERE user_id = ? AND kind = 'WALLET' AND status = 'PENDING' LIMIT 1",
      [req.userId],
    );
    if (pendingRow.length) {
      return res.status(409).json({
        error: "You already have a pending withdrawal request. Wait for admin review.",
      });
    }

    const [cooldownRows] = await db.execute(
      "SELECT reviewed_at, TIMESTAMPADD(DAY, 14, reviewed_at) AS next_available_at, TIMESTAMPDIFF(SECOND, NOW(), TIMESTAMPADD(DAY, 14, reviewed_at)) AS seconds_remaining FROM withdrawal_request WHERE user_id = ? AND kind = 'WALLET' AND status = 'APPROVED' AND reviewed_at IS NOT NULL ORDER BY reviewed_at DESC LIMIT 1",
      [req.userId],
    );
    const cooldown = cooldownRows[0];
    const cooldownSeconds = Number(cooldown?.seconds_remaining || 0);
    if (cooldownSeconds > 0) {
      const daysRemaining = Math.ceil(cooldownSeconds / 86400);
      return res.status(429).json({
        error: "Withdrawal cooldown active. Next withdrawal available in " + daysRemaining + " day(s)",
        next_available_at: new Date(cooldown.next_available_at).toISOString(),
      });
    }

    const minCents = method === "UPI" ? 1000 : 2500;
    if (amount_cents < minCents) {
      return res.status(400).json({
        error: method === "UPI"
          ? "Minimum UPI withdrawal is $10.00"
          : "Minimum Crypto withdrawal is $25.00",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [walletRows] = await connection.execute("SELECT * FROM user_wallets WHERE user_id = ? FOR UPDATE", [req.userId]);
    if (!walletRows.length) {
      await connection.rollback();
      return res.status(400).json({ error: "FundFXT Wallet not found" });
    }
    const wallet = walletRows[0];
    const walletBalance = Number(wallet.balance_cents || 0);
    if (walletBalance < amount_cents) {
      await connection.rollback();
      return res.status(400).json({ error: "Insufficient wallet balance" });
    }
    const requestRef = "WD-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const payoutDetails = method === "UPI"
      ? { upi_id: String(details.upi_id).trim() }
      : { wallet_address: String(details.wallet_address).trim(), network: String(details.network).trim() };
    const eligibilitySnapshot = {};
    await connection.execute("UPDATE user_wallets SET balance_cents = balance_cents - ?, updated_at = NOW() WHERE user_id = ?", [amount_cents, req.userId]);
    const [withdrawalResult] = await connection.execute(
      "INSERT INTO withdrawal_request (request_ref, user_id, kind, account_id, amount_cents, currency, method, payout_details, eligibility_snapshot, status, created_at, updated_at) VALUES (?, ?, 'WALLET', NULL, ?, 'USD', ?, ?, ?, 'PENDING', NOW(), NOW())",
      [requestRef, req.userId, amount_cents, method, JSON.stringify(payoutDetails), JSON.stringify(eligibilitySnapshot)],
    );
    const newBalance = walletBalance - amount_cents;
    await connection.execute(
      "INSERT INTO user_wallet_transactions (user_id, txn_type, source, amount_cents, balance_after_cents, reference_type, reference_id, description) VALUES (?, 'DEBIT', 'WITHDRAWAL', ?, ?, 'withdrawal_request', ?, ?)",
      [req.userId, amount_cents, newBalance, withdrawalResult.insertId, "Withdrawal request " + requestRef],
    );
    await connection.commit();
    const [users] = await db.execute("SELECT legal_name, email, trader_id FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (users.length) void sendWithdrawalEmail(users[0].email, users[0].legal_name, users[0].trader_id, "PENDING", amount_cents, requestRef);
    res.json({ success: true, request_ref: requestRef, status: "PENDING" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Wallet withdrawal request error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});


app.post(
  "/api/user/wallet/account-payout/request",
  authenticateToken,
  accountPayoutRateLimiter,
  async (req, res) => {
    const accountId = Number(req.body?.account_id);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ error: "Valid account_id is required" });
    }
    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const [accountRows] = await connection.execute(
        "SELECT * FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE",
        [accountId, req.userId],
      );
      if (!accountRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Account not found" });
      }
      const account = accountRows[0];
      if (account.status !== "ACTIVE" || account.phase !== "FUNDED") {
        await connection.rollback();
        return res.status(400).json({ error: "Account must be ACTIVE and FUNDED for a profit transfer" });
      }
      const parsedModel = parseChallengeModel(account.challenge_model);
      const modelKey = parsedModel?.model_key;
      const sizeKey = parsedModel?.size_key;
      if (!modelKey) {
        await connection.rollback();
        return res.status(400).json({ error: "Unsupported challenge model" });
      }
      const profitCents = Number(account.balance_cents || 0) - Number(account.initial_balance_cents || 0);
      if (profitCents < 10000) {
        await connection.rollback();
        return res.status(400).json({ error: "Minimum profit transfer is $100.00" });
      }
      const [openTradeRows] = await connection.execute(
        "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND status = 'OPEN'",
        [account.id],
      );
      const openTradeCount = Number(openTradeRows[0]?.count || 0);
      if (openTradeCount > 0) {
        await connection.rollback();
        return res.status(400).json({ error: "All open trades must be closed before requesting a profit transfer" });
      }
      const [cooldownRows] = await connection.execute(
        "SELECT reviewed_at, TIMESTAMPADD(DAY, 7, reviewed_at) AS next_available_at, TIMESTAMPDIFF(SECOND, NOW(), TIMESTAMPADD(DAY, 7, reviewed_at)) AS seconds_remaining FROM withdrawal_request WHERE account_id = ? AND kind = 'TRADER_PROFIT' AND status = 'APPROVED' AND reviewed_at IS NOT NULL ORDER BY reviewed_at DESC LIMIT 1",
        [account.id],
      );
      const cooldown = cooldownRows[0];
      const cooldownSeconds = Number(cooldown?.seconds_remaining || 0);
      const cooldownOk = cooldownSeconds <= 0;
      if (!cooldownOk) {
        const daysRemaining = Math.ceil(cooldownSeconds / 86400);
        await connection.rollback();
        return res.status(429).json({
          error: "Profit transfer cooldown active. Next transfer available in " + daysRemaining + " day(s)",
          next_available_at: new Date(cooldown.next_available_at).toISOString(),
        });
      }
      const risk = await checkAccountRisk(account);
      if (risk.breached) {
        await connection.rollback();
        return res.status(400).json({ error: "Account is not eligible for profit transfer", reason: risk.reason });
      }
      const consistency = await calculateConsistencyScore(account.id);
      const consistencyOk = risk.consistencyBps != null && consistency.scoreBps <= Number(risk.consistencyBps);
      if (!consistencyOk) {
        await connection.rollback();
        return res.status(400).json({
          error: "Account consistency requirement not met",
          consistency_score_bps: consistency.scoreBps,
          consistency_limit_bps: risk.consistencyBps,
        });
      }

      let withdrawalNumber = 1;
      let tierRange = null;
      let tierMaxCents = 0;
      let amountToApproveCents = 0;

      if (modelKey === "prototype") {
        tierMaxCents = 10000;
        const [priorRows] = await connection.execute(
          "SELECT id FROM withdrawal_request WHERE account_id = ? AND kind = 'TRADER_PROFIT' AND status = 'APPROVED' LIMIT 1",
          [account.id],
        );
        if (priorRows.length) {
          await connection.rollback();
          return res.status(400).json({ error: "Prototype allows only one withdrawal" });
        }
        amountToApproveCents = Math.min(10000, profitCents);
      } else if (modelKey === "warrior") {
        const [countRows] = await connection.execute(
          "SELECT COUNT(*) AS approved_count FROM withdrawal_request WHERE account_id = ? AND kind = 'TRADER_PROFIT' AND status = 'APPROVED'",
          [account.id],
        );
        withdrawalNumber = Number(countRows[0]?.approved_count || 0) + 1;

        let [tierRows] = await connection.execute(
          "SELECT id, tier_start, tier_end, max_amount_bps FROM withdrawal_tier_rules WHERE model_key = ? AND phase = 'FUNDED' AND is_active = 1 AND tier_start <= ? AND tier_end >= ? ORDER BY tier_start DESC LIMIT 1",
          [modelKey, withdrawalNumber, withdrawalNumber],
        );
        if (!tierRows.length) {
          [tierRows] = await connection.execute(
            "SELECT id, tier_start, tier_end, max_amount_bps FROM withdrawal_tier_rules WHERE model_key = ? AND phase = 'FUNDED' AND is_active = 1 ORDER BY tier_end DESC LIMIT 1",
            [modelKey],
          );
        }
        if (!tierRows.length) {
          await connection.rollback();
          return res.status(400).json({ error: "No active withdrawal tier configured for this account" });
        }

        const tier = tierRows[0];
        tierRange = tier.tier_end == null
          ? String(tier.tier_start) + "+"
          : String(tier.tier_start) + "-" + String(tier.tier_end);
        tierMaxCents = Math.floor(
          (Number(account.initial_balance_cents || 0) * Number(tier.max_amount_bps || 0)) / 10000
        );
        amountToApproveCents = Math.min(tierMaxCents, profitCents);
      } else {
        await connection.rollback();
        return res.status(400).json({ error: "Unsupported challenge model for profit transfer" });
      }

      const requestRef =
        "TR-PAY-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        crypto.randomBytes(3).toString("hex").toUpperCase();
      const eligibilitySnapshot = {
        profit_at_request: profitCents,
        profit_cents: profitCents,
        balance_at_request: Number(account.balance_cents || 0),
        hwm_at_request: Number(account.balance_hwm_cents ?? account.initial_balance_cents ?? 0),
        consistency_score: consistency.scoreBps,
        funded_at: account.funded_at ?? null,
        model: modelKey,
        size: sizeKey,
        tier_number: withdrawalNumber,
        tier_range: tierRange,
        tier_max_cents: tierMaxCents,
        amount_to_approve: amountToApproveCents,
        extra_remaining: Math.max(0, profitCents - amountToApproveCents),
        is_prototype_one_time: modelKey === "prototype",
        rules_status: {
          open_trades: openTradeCount === 0,
          daily_dd_ok: Number(risk.currentDailyLoss || 0) < Number(risk.dailyLossLimit || 0),
          max_dd_ok: Number(risk.currentMaxDrawdown || 0) < Number(risk.maxDrawdownLimit || 0),
          consistency_ok: consistencyOk,
          cooldown_ok: cooldownOk,
        },
      };
      const [withdrawalResult] = await connection.execute(
        "INSERT INTO withdrawal_request (request_ref, user_id, kind, account_id, amount_cents, currency, method, payout_details, eligibility_snapshot, status, created_at, updated_at) VALUES (?, ?, 'TRADER_PROFIT', ?, ?, 'USD', 'INTERNAL', NULL, ?, 'PENDING', NOW(), NOW())",
        [
          requestRef,
          req.userId,
          account.id,
          amountToApproveCents,
          JSON.stringify(eligibilitySnapshot),
        ],
      );
      const [freezeResult] = await connection.execute(
        "UPDATE accounts SET status = 'FROZEN', updated_at = NOW() WHERE id = ? AND status = 'ACTIVE'",
        [account.id],
      );
      if (freezeResult.affectedRows !== 1 || !withdrawalResult.insertId) {
        throw new Error("Profit transfer request could not be created");
      }
      await connection.commit();
      const [users] = await db.execute(
        "SELECT legal_name, email, trader_id FROM users WHERE id = ? LIMIT 1",
        [req.userId],
      );
      if (users.length) {
        void sendWithdrawalEmail(users[0].email, users[0].legal_name, users[0].trader_id, "PENDING", profitCents, requestRef);
      }
      res.json({ success: true, request_ref: requestRef, status: "PENDING" });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Account payout request error:", error);
      res.status(500).json({ error: error.message });
    } finally {
      if (connection) connection.release();
    }
  },
);

app.post(
  "/api/admin/account-payouts/:id/approve",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const [requestRows] = await connection.execute(
        "SELECT wr.*, u.legal_name, u.email AS user_email, u.trader_id FROM withdrawal_request wr JOIN users u ON u.id = wr.user_id WHERE wr.id = ? AND wr.kind = 'TRADER_PROFIT' FOR UPDATE",
        [id],
      );
      if (!requestRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Account payout request not found" });
      }
      const request = requestRows[0];
      if (request.status !== "PENDING") {
        await connection.rollback();
        return res.status(400).json({ error: "Only pending account payout requests can be approved" });
      }
      const [accountRows] = await connection.execute(
        "SELECT * FROM accounts WHERE id = ? FOR UPDATE",
        [request.account_id],
      );
      if (!accountRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Account not found" });
      }
      const account = accountRows[0];
      if (account.status !== "FROZEN" || account.phase !== "FUNDED") {
        await connection.rollback();
        return res.status(409).json({ error: "Account is not in the expected frozen funded state" });
      }
      await connection.execute(
        "INSERT INTO user_wallets (user_id, balance_cents, total_received_cents) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance_cents = balance_cents + VALUES(balance_cents), total_received_cents = total_received_cents + VALUES(total_received_cents)",
        [request.user_id, request.amount_cents, request.amount_cents],
      );
      const [walletRows] = await connection.execute(
        "SELECT * FROM user_wallets WHERE user_id = ? FOR UPDATE",
        [request.user_id],
      );
      if (!walletRows.length) throw new Error("FundFXT Wallet could not be created");
      const walletBalanceAfter = Number(walletRows[0].balance_cents || 0);
      const accountCode = account.account_code || ("ACC-" + account.id);
      await connection.execute(
        "INSERT INTO user_wallet_transactions (user_id, txn_type, source, amount_cents, balance_after_cents, reference_type, reference_id, description) VALUES (?, 'CREDIT', 'PROFIT_TRANSFER', ?, ?, 'withdrawal_request', ?, ?)",
        [request.user_id, request.amount_cents, walletBalanceAfter, request.id, "Profit from " + accountCode],
      );
      const W = Number(request.amount_cents || 0);
      const HWM_REDUCTION = Math.round((W * 100) / 90);
      const DD_REDUCTION = Math.round((W * 100) / 95);
      const newBalance = Math.max(0, Number(account.balance_cents || 0) - W);
      const newEquity = Math.max(0, Number(account.equity_cents || 0) - W);
      const oldBalanceHwm = Number(account.balance_hwm_cents ?? account.initial_balance_cents ?? 0);
      const oldEquityHwm = Number(account.equity_hwm_cents ?? account.balance_hwm_cents ?? account.initial_balance_cents ?? 0);
      const newHWM = Math.max(Number(account.initial_balance_cents || 0), oldBalanceHwm - HWM_REDUCTION);
      const newDayStartBal = Math.max(0, Number(account.day_start_balance_cents || 0) - DD_REDUCTION);
      const newDayStartEq = Math.max(0, Number(account.day_start_equity_cents || 0) - DD_REDUCTION);
      const newEqHWM = Math.max(Number(account.initial_balance_cents || 0), oldEquityHwm - HWM_REDUCTION);
      const isPrototype = parseChallengeModel(account.challenge_model)?.model_key === "prototype";
      const newStatus = isPrototype ? "PASSED" : "ACTIVE";

      await connection.execute(
        "UPDATE accounts SET balance_cents = ?, equity_cents = ?, balance_hwm_cents = ?, equity_hwm_cents = ?, day_start_balance_cents = ?, day_start_equity_cents = ?, status = ?, force_hwm_reset = 1, updated_at = NOW() WHERE id = ?",
        [newBalance, newEquity, newHWM, newEqHWM, newDayStartBal, newDayStartEq, newStatus, account.id],
      );
      const [requestUpdate] = await connection.execute(
        "UPDATE withdrawal_request SET status = 'APPROVED', reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'PENDING'",
        [req.adminId, request.id],
      );
      if (requestUpdate.affectedRows !== 1) throw new Error("Account payout request was already processed");
      await connection.commit();
      void sendWithdrawalEmail(request.user_email, request.legal_name, request.trader_id, "APPROVED", request.amount_cents, request.request_ref);
      res.json({ success: true, request_ref: request.request_ref, status: "APPROVED", wallet_balance_cents: walletBalanceAfter });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Account payout approval error:", error);
      res.status(500).json({ error: error.message });
    } finally {
      if (connection) connection.release();
    }
  },
);

app.post(
  "/api/admin/account-payouts/:id/reject",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const rejectionReason = String(req.body?.rejection_reason || "").trim();
    if (!rejectionReason) return res.status(400).json({ error: "Rejection reason is required" });
    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const [requestRows] = await connection.execute(
        "SELECT wr.*, u.legal_name, u.email AS user_email, u.trader_id FROM withdrawal_request wr JOIN users u ON u.id = wr.user_id WHERE wr.id = ? AND wr.kind = 'TRADER_PROFIT' FOR UPDATE",
        [id],
      );
      if (!requestRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Account payout request not found" });
      }
      const request = requestRows[0];
      if (request.status !== "PENDING") {
        await connection.rollback();
        return res.status(400).json({ error: "Only pending account payout requests can be rejected" });
      }
      const [accountRows] = await connection.execute(
        "SELECT id, status FROM accounts WHERE id = ? FOR UPDATE",
        [request.account_id],
      );
      if (!accountRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Account not found" });
      }
      await connection.execute(
        "UPDATE withdrawal_request SET status = 'REJECTED', admin_note = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'PENDING'",
        [rejectionReason.slice(0, 255), req.adminId, request.id],
      );
      await connection.execute(
        "UPDATE accounts SET status = 'ACTIVE', updated_at = NOW() WHERE id = ?",
        [request.account_id],
      );
      await connection.commit();
      void sendWithdrawalEmail(request.user_email, request.legal_name, request.trader_id, "REJECTED", request.amount_cents, request.request_ref, rejectionReason);
      res.json({ success: true, request_ref: request.request_ref, status: "REJECTED" });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Account payout rejection error:", error);
      res.status(500).json({ error: error.message });
    } finally {
      if (connection) connection.release();
    }
  },
);

app.get(
  "/api/admin/account-payouts",
  authenticateAdmin,
  async (req, res) => {
    try {
      const status = String(req.query.status || "").toUpperCase();
      const allowedStatuses = ["PENDING", "APPROVED", "REJECTED"];
      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid account payout status" });
      }
      const where = status ? "AND wr.status = ?" : "";
      const params = status ? [status] : [];
      const [rows] = await db.execute(
        "SELECT wr.id, wr.request_ref, wr.user_id, u.legal_name, u.email, u.trader_id, a.id AS account_id, a.account_code, a.challenge_model, a.initial_balance_cents, a.balance_cents, a.equity_cents, a.balance_hwm_cents, a.equity_hwm_cents, a.day_start_balance_cents, a.day_start_equity_cents, a.status AS account_status, a.phase, wr.amount_cents, wr.status, wr.reviewed_at, wr.admin_note AS rejection_reason, wr.eligibility_snapshot, wr.created_at FROM withdrawal_request wr JOIN users u ON u.id = wr.user_id JOIN accounts a ON a.id = wr.account_id WHERE wr.kind = 'TRADER_PROFIT' " + where + " ORDER BY wr.created_at DESC",
        params,
      );
      const payouts = [];
      for (const row of rows) {
        const parsed = parseChallengeModel(row.challenge_model);
        let snapshot = {};
        try {
          snapshot = row.eligibility_snapshot
            ? (typeof row.eligibility_snapshot === "string" ? JSON.parse(row.eligibility_snapshot) : row.eligibility_snapshot)
            : {};
        } catch {}
        const [priorRows] = await db.execute(
          "SELECT COUNT(*) AS approved_count FROM withdrawal_request WHERE account_id = ? AND kind = 'TRADER_PROFIT' AND status = 'APPROVED' AND id < ?",
          [row.account_id, row.id],
        );
        const withdrawalNumber = Number(snapshot.tier_number || priorRows[0]?.approved_count || 0) || 1;
        const [trades] = await db.execute(
          "SELECT id, symbol, side, order_type, volume, entry_price, exit_price, realized_profit_cents, status, entry_time, exit_time, close_reason, trading_day FROM trades WHERE account_id = ? ORDER BY COALESCE(exit_time, entry_time) DESC, id DESC",
          [row.account_id],
        );
        payouts.push({
          id: row.id,
          request_ref: row.request_ref,
          user: { id: row.user_id, name: row.legal_name, email: row.email, trader_id: row.trader_id },
          account: {
            id: row.account_id,
            code: row.account_code,
            challenge_model: row.challenge_model,
            initial_balance_cents: Number(row.initial_balance_cents || 0),
            balance_cents: Number(row.balance_cents || 0),
            balance_hwm_cents: Number(row.balance_hwm_cents || 0),
          },
          model_key: parsed?.model_key || snapshot.model || null,
          size_key: parsed?.size_key || snapshot.size || null,
          withdrawal_number: withdrawalNumber,
          tier_range: snapshot.tier_range || null,
          tier_max_cents: Number(snapshot.tier_max_cents || 0),
          profit_cents: Number(snapshot.profit_at_request ?? snapshot.profit_cents ?? 0),
          amount_to_approve: Number(row.amount_cents || 0),
          extra_remaining: Number(snapshot.extra_remaining ?? 0),
          rules_status: snapshot.rules_status || {
            open_trades: !trades.some((t) => String(t.status).toUpperCase() === "OPEN"),
            daily_dd_ok: true,
            max_dd_ok: true,
            consistency_ok: true,
            cooldown_ok: true,
          },
          trades,
          status: row.status,
          rejection_reason: row.rejection_reason,
          created_at: row.created_at,
          reviewed_at: row.reviewed_at,
        });
      }
      res.json({ success: true, payouts });
    } catch (error) {
      console.error("Admin account payout list error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

app.get(
  "/api/user/account-payouts",
  authenticateToken,
  async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
      const offset = (page - 1) * limit;
      const [rows] = await db.execute(
        "SELECT id, request_ref, account_id, amount_cents, currency, status, admin_note AS rejection_reason, eligibility_snapshot, created_at, reviewed_at FROM withdrawal_request WHERE user_id = ? AND kind = 'TRADER_PROFIT' ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [req.userId, limit, offset],
      );
      const [countRows] = await db.execute(
        "SELECT COUNT(*) AS total FROM withdrawal_request WHERE user_id = ? AND kind = 'TRADER_PROFIT'",
        [req.userId],
      );
      const total = Number(countRows[0]?.total || 0);
      res.json({
        success: true,
        payouts: rows,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      console.error("User account payout list error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

app.get("/api/user/wallet/withdrawals", authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const status = String(req.query.status || "").toUpperCase();
    const allowedStatuses = ["PENDING", "APPROVED", "PAID", "REJECTED"];
    if (status && !allowedStatuses.includes(status)) return res.status(400).json({ error: "Invalid withdrawal status" });
    const where = status ? "AND status = ?" : "";
    const params = status ? [req.userId, status] : [req.userId];
    const [rows] = await db.execute(`SELECT id, request_ref, amount_cents, currency, method, payout_details, status, admin_note, created_at, updated_at, reviewed_at FROM withdrawal_request WHERE user_id = ? AND kind = 'WALLET' ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [countRows] = await db.execute(`SELECT COUNT(*) AS total FROM withdrawal_request WHERE user_id = ? AND kind = 'WALLET' ${where}`, params);
    res.json({ success: true, withdrawals: rows, pagination: { page, limit, total: Number(countRows[0]?.total || 0) } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/withdrawals/:id/approve", authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT wr.*, u.legal_name, u.email AS user_email, u.trader_id FROM withdrawal_request wr JOIN users u ON u.id = wr.user_id WHERE wr.id = ? AND wr.kind = 'WALLET' FOR UPDATE",
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Withdrawal request not found" });
    }
    const withdrawal = rows[0];
    if (withdrawal.status !== "PENDING") {
      await connection.rollback();
      return res.status(400).json({ error: "Only pending withdrawals can be approved" });
    }
    await connection.execute("UPDATE withdrawal_request SET status = 'APPROVED', reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ?", [req.adminId, id]);
    await connection.execute("UPDATE user_wallets SET total_withdrawn_cents = COALESCE(total_withdrawn_cents, 0) + ?, updated_at = NOW() WHERE user_id = ?", [withdrawal.amount_cents, withdrawal.user_id]);
    await connection.commit();
    void sendWithdrawalEmail(withdrawal.user_email, withdrawal.legal_name, withdrawal.trader_id, "APPROVED", withdrawal.amount_cents, withdrawal.request_ref);
    res.json({ success: true, request_ref: withdrawal.request_ref, status: "APPROVED" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/withdrawals/:id/reject", authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Rejection reason is required" });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT wr.*, u.legal_name, u.email AS user_email, u.trader_id FROM withdrawal_request wr JOIN users u ON u.id = wr.user_id WHERE wr.id = ? AND wr.kind = 'WALLET' FOR UPDATE",
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Withdrawal request not found" });
    }
    const withdrawal = rows[0];
    if (withdrawal.status !== "PENDING") {
      await connection.rollback();
      return res.status(400).json({ error: "Only pending withdrawals can be rejected" });
    }
    const [walletRows] = await connection.execute("SELECT * FROM user_wallets WHERE user_id = ? FOR UPDATE", [withdrawal.user_id]);
    if (!walletRows.length) {
      await connection.rollback();
      return res.status(400).json({ error: "FundFXT Wallet not found" });
    }
    const wallet = walletRows[0];
    const newBalance = Number(wallet.balance_cents || 0) + Number(withdrawal.amount_cents || 0);
    await connection.execute("UPDATE withdrawal_request SET status = 'REJECTED', admin_note = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ?", [reason, req.adminId, id]);
    await connection.execute("UPDATE user_wallets SET balance_cents = balance_cents + ?, updated_at = NOW() WHERE user_id = ?", [withdrawal.amount_cents, withdrawal.user_id]);
    await connection.execute(
      "INSERT INTO user_wallet_transactions (user_id, txn_type, source, amount_cents, balance_after_cents, reference_type, reference_id, description) VALUES (?, 'CREDIT', 'WITHDRAWAL_REFUND', ?, ?, 'withdrawal_request', ?, ?)",
      [withdrawal.user_id, withdrawal.amount_cents, newBalance, withdrawal.id, "Withdrawal refund " + withdrawal.request_ref],
    );
    await connection.commit();
    void sendWithdrawalEmail(withdrawal.user_email, withdrawal.legal_name, withdrawal.trader_id, "REJECTED", withdrawal.amount_cents, withdrawal.request_ref, reason);
    res.json({ success: true, request_ref: withdrawal.request_ref, status: "REJECTED" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/accounts/:id/summary
app.get("/api/accounts/:id/summary", authenticateToken, async (req, res) => {
  const accountId = req.params.id;
  const [accounts] = await db.execute(
    "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
    [accountId, req.userId],
  );
  if (!accounts.length)
    return res.status(404).json({ error: "Account not found" });

  const account = accounts[0];
  const config = await getChallengeConfig(account.challenge_model);
  const risk = await checkAccountRisk(account);
  const consistency = await calculateConsistencyScore(accountId);
  if (risk.breached) {
    await settleBreachedAccount(account.id, risk.reason);
  }
  const profitTargetCents =
    risk.profitTargetBps == null
      ? 0
      : Math.round(
          Number(account.initial_balance_cents || 0) *
            Number(risk.profitTargetBps) /
            10000,
        );
  const consistencyLimitPercent =
    risk.consistencyBps == null ? 0 : Number(risk.consistencyBps) / 100;

  res.json({
    success: true,
    summary: {
      balance: account.balance_cents / 100,
      equity: account.equity_cents / 100,
      balanceHwmCents: account.balance_hwm_cents,
      currentDailyLoss: risk.currentDailyLoss,
      dailyLossLimit: risk.dailyLossLimit,
      currentMaxDrawdown: risk.currentMaxDrawdown,
      maxDrawdownLimit: risk.maxDrawdownLimit,
      tradesToday: risk.tradesToday,
      maxTrades: risk.maxTrades,
      maxTradesUnlimited: risk.maxTradesUnlimited,
      breached: risk.breached,
      phase: account.phase,
      configSource: risk.configSource,
      model: risk.model,
      size: risk.size,
      openPositions: risk.openPositions,
      maxOpenPositions: risk.maxOpenPositions,
      minLot: risk.minLot,
      maxLot: risk.maxLot,
      leverage: risk.leverage,
      profitTargetBps: risk.profitTargetBps,
      profitTargetCents,
      consistencyBps: risk.consistencyBps,
      consistencyLimitPercent,
      consistencyScoreBps: consistency.scoreBps,
      dailyDdBasis: risk.dailyDdBasis,
      maxDdBasis: risk.maxDdBasis,
    },
  });
});

// GET /api/accounts/:id/passbook
app.get("/api/accounts/:id/passbook", authenticateToken, async (req, res) => {
  const accountId = req.params.id;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

  try {
    const [accounts] = await db.execute(
      "SELECT id, account_code, initial_balance_cents, balance_cents FROM accounts WHERE id = ? AND user_id = ?",
      [accountId, req.userId],
    );
    if (!accounts.length)
      return res.status(404).json({ error: "Account not found" });

    const account = accounts[0];
    const [trades] = await db.execute(
      "SELECT id, trade_id, account_id, symbol, side, volume, realized_profit_cents, status, close_reason, exit_time, entry_time, created_at FROM trades WHERE account_id = ? AND status = 'CLOSED' ORDER BY COALESCE(entry_time, created_at) ASC, id ASC",
      [accountId],
    );
    const [transfers] = await db.execute(
      "SELECT id, request_ref, account_id, amount_cents, status, created_at, reviewed_at FROM withdrawal_request WHERE account_id = ? AND kind = 'TRADER_PROFIT' AND status = 'APPROVED' ORDER BY COALESCE(reviewed_at, created_at) ASC, id ASC",
      [accountId],
    );

    const events = [
      ...trades.map((trade) => ({
        id: "TRADE-" + trade.id,
        type: "TRADE",
        timestamp: trade.entry_time || trade.created_at,
        amount_cents: Number(trade.realized_profit_cents || 0),
        trade_id: trade.trade_id,
        symbol: trade.symbol,
        side: trade.side,
        volume: Number(trade.volume || 0),
        close_reason: trade.close_reason,
      })),
      ...transfers.map((transfer) => ({
        id: "TRANSFER-" + transfer.id,
        type: "TRANSFER",
        timestamp: transfer.reviewed_at || transfer.created_at,
        amount_cents: -Math.abs(Number(transfer.amount_cents || 0)),
        request_ref: transfer.request_ref,
        status: transfer.status,
      })),
    ];

    events.sort((a, b) => {
      const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return timeDiff || String(a.id).localeCompare(String(b.id));
    });

    let runningBalance = Number(account.initial_balance_cents || 0);
    for (const event of events) {
      runningBalance += event.amount_cents;
      event.balance_after_cents = runningBalance;
      event.description =
        event.type === "TRADE"
          ? (event.symbol || "Trade") + " " + (event.side || "") + " " + event.volume.toFixed(2) + " — " + (event.amount_cents >= 0 ? "Profit" : "Loss")
          : "Transfer to FundFXT Wallet — " + (event.request_ref || "—");
    }

    events.reverse();
    const total = events.length;
    const start = (page - 1) * limit;
    const entries = events.slice(start, start + limit);

    res.json({
      success: true,
      account: {
        id: account.id,
        account_code: account.account_code,
        initial_balance_cents: Number(account.initial_balance_cents || 0),
        current_balance_cents: Number(account.balance_cents || 0),
      },
      entries,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("Account passbook error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== TRADE MANAGEMENT API ==========

// 2. Modify SL/TP
app.patch("/api/trades/:tradeId", authenticateToken, async (req, res) => {
  const { stop_loss, take_profit } = req.body;
  try {
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'",
      [req.params.tradeId, req.userId],
    );
    if (!trades.length)
      return res.status(404).json({ error: "Open trade not found" });

    await db.execute(
      "UPDATE trades SET stop_loss = ?, take_profit = ? WHERE trade_id = ?",
      [stop_loss || null, take_profit || null, req.params.tradeId],
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== NOTIFICATION SYSTEM ==========

// 1. Get User Notifications (with unread count)
app.get("/api/notifications", authenticateToken, async (req, res) => {
  try {
    const [notifications] = await db.execute(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.userId],
    );
    const [unreadCount] = await db.execute(
      "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL",
      [req.userId],
    );
    res.json({
      success: true,
      notifications,
      unreadCount: unreadCount[0].count,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Mark Single Notification as Read
app.post("/api/notifications/:id/read", authenticateToken, async (req, res) => {
  try {
    await db.execute(
      "UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ?",
      [req.params.id, req.userId],
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Mark All Notifications as Read
app.post("/api/notifications/read-all", authenticateToken, async (req, res) => {
  try {
    await db.execute(
      "UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL",
      [req.userId],
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Helper Function to Create Notification (for internal use)
async function createNotification(userId, type, title, message, link = null) {
  try {
    await db.execute(
      "INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)",
      [userId, type, title, message, link],
    );
  } catch (error) {
    console.error("Create notification error:", error.message);
  }
}


app.get("/api/admin/phase-reviews", authenticateAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "PENDING").toUpperCase();
    if (!["PENDING","APPROVED","REJECTED"].includes(status)) return res.status(400).json({ error: "Invalid phase review status" });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const [[countRow]] = await db.query("SELECT COUNT(*) AS total FROM account_phase_reviews WHERE status = ?", [status]);
    const [reviews] = await db.query(`SELECT r.id, r.review_ref, r.account_id, r.user_id, r.from_phase, r.to_phase, r.status, r.target_snapshot, r.created_at, r.reviewed_by, r.reviewed_at, r.admin_note, r.new_account_id, u.legal_name AS user_name, u.email AS user_email, u.trader_id, a.account_code, a.challenge_model, a.initial_balance_cents, a.balance_cents, a.equity_cents FROM account_phase_reviews r JOIN users u ON u.id = r.user_id JOIN accounts a ON a.id = r.account_id WHERE r.status = ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [status, limit, offset]);
    const normalized = reviews.map((row) => ({ ...row, user: { id: row.user_id, name: row.user_name, email: row.user_email, trader_id: row.trader_id }, account: { id: row.account_id, code: row.account_code, challenge_model: row.challenge_model, initial_balance_cents: Number(row.initial_balance_cents || 0), balance_cents: Number(row.balance_cents || 0), equity_cents: Number(row.equity_cents || 0) }, target_snapshot: typeof row.target_snapshot === "string" ? (() => { try { return JSON.parse(row.target_snapshot); } catch { return {}; } })() : (row.target_snapshot || {}) }));
    res.json({ success: true, reviews: normalized, pagination: { page, limit, total: Number(countRow?.total || 0), total_pages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / limit)) } });
  } catch (error) { console.error("Admin phase review list error:", error); res.status(500).json({ error: error.message }); }
});

app.get("/api/admin/phase-reviews/:id", authenticateAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT r.*, u.legal_name AS user_name, u.email AS user_email, u.trader_id, a.account_code, a.challenge_model, a.initial_balance_cents, a.balance_cents, a.equity_cents FROM account_phase_reviews r JOIN users u ON u.id = r.user_id JOIN accounts a ON a.id = r.account_id WHERE r.id = ? LIMIT 1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Phase review not found" });
    const review = rows[0];
    const [trades] = await db.query(`SELECT id, trade_id, symbol, side, order_type, volume, entry_price, exit_price, entry_time, exit_time, realized_profit_cents, status, close_reason, stop_loss, take_profit FROM trades WHERE account_id = ? AND status = 'CLOSED' AND close_reason IN ('PASS_CLOSE','MANUAL','TP','SL','FLATTEN') AND exit_time <= ? ORDER BY exit_time ASC, id ASC`, [review.account_id, review.created_at]);
    const snapshot = typeof review.target_snapshot === "string" ? (() => { try { return JSON.parse(review.target_snapshot); } catch { return {}; } })() : (review.target_snapshot || {});
    res.json({ success: true, review: { id: review.id, review_ref: review.review_ref, account_id: review.account_id, user_id: review.user_id, from_phase: review.from_phase, to_phase: review.to_phase, status: review.status, target_snapshot: snapshot, created_at: review.created_at, reviewed_by: review.reviewed_by, reviewed_at: review.reviewed_at, admin_note: review.admin_note, new_account_id: review.new_account_id }, user: { id: review.user_id, name: review.user_name, email: review.user_email, trader_id: review.trader_id }, account: { id: review.account_id, code: review.account_code, challenge_model: review.challenge_model, initial_balance_cents: Number(review.initial_balance_cents || 0), balance_cents: Number(review.balance_cents || 0), equity_cents: Number(review.equity_cents || 0) }, trades });
  } catch (error) { console.error("Admin phase review detail error:", error); res.status(500).json({ error: error.message }); }
});

app.post("/api/admin/phase-reviews/:id/approve", authenticateAdmin, async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [reviewRows] = await connection.execute("SELECT * FROM account_phase_reviews WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!reviewRows.length) { await connection.rollback(); return res.status(404).json({ error: "Phase review not found" }); }
    const review = reviewRows[0];
    if (review.status !== "PENDING") { await connection.rollback(); return res.status(409).json({ error: `Phase review is already ${review.status.toLowerCase()}.` }); }
    const [accountRows] = await connection.execute("SELECT * FROM accounts WHERE id = ? FOR UPDATE", [review.account_id]);
    if (!accountRows.length) { await connection.rollback(); return res.status(404).json({ error: "Source account not found" }); }
    const sourceAccount = accountRows[0];
    if (sourceAccount.status !== "PASSED") { await connection.rollback(); return res.status(409).json({ error: "Source account is not PASSED." }); }
    const fromPhase = String(review.from_phase || "").toUpperCase();
    const toPhase = fromPhase === "PHASE_1" ? "PHASE_2" : fromPhase === "PHASE_2" ? "FUNDED" : null;
    if (!toPhase) { await connection.rollback(); return res.status(400).json({ error: "Invalid phase transition." }); }
    const newAccount = await createPhaseAccount(connection, { sourceAccount, phase: toPhase });
    await connection.execute("UPDATE account_phase_reviews SET status = 'APPROVED', reviewed_by = ?, reviewed_at = NOW(), new_account_id = ? WHERE id = ?", [req.adminId, newAccount.accountId, review.id]);
    await connection.commit();
    try {
      const [userRows] = await db.query("SELECT legal_name, email, trader_id FROM users WHERE id = ? LIMIT 1", [review.user_id]);
      const user = userRows[0] || {};
      const sourceSnapshot = typeof review.target_snapshot === "string" ? (() => { try { return JSON.parse(review.target_snapshot); } catch { return {}; } })() : (review.target_snapshot || {});
      await sendPhaseEmail(user.email, user.legal_name, user.trader_id, review.account_code, fromPhase, toPhase, "APPROVED", "", sourceSnapshot.profit_cents, sourceSnapshot.target_cents);
      await createNotification(review.user_id, "phase_approved", `Phase ${fromPhase} approved — new account ready`, `Your ${toPhase} account is ready for trading.`, null);
    } catch (notifyError) { console.error("Phase approval notification failed:", notifyError.message); }
    res.json({ success: true, new_account_id: newAccount.accountId, new_account_code: newAccount.accountCode });
  } catch (error) { if (connection) { try { await connection.rollback(); } catch {} } console.error("Approve phase review error:", error); res.status(500).json({ error: error.message }); }
  finally { if (connection) connection.release(); }
});

app.post("/api/admin/phase-reviews/:id/reject", authenticateAdmin, async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [reviewRows] = await connection.execute("SELECT * FROM account_phase_reviews WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!reviewRows.length) { await connection.rollback(); return res.status(404).json({ error: "Phase review not found" }); }
    const review = reviewRows[0];
    if (review.status !== "PENDING") { await connection.rollback(); return res.status(409).json({ error: `Phase review is already ${review.status.toLowerCase()}.` }); }
    const adminNote = String(req.body?.admin_note || "").trim();
    if (!adminNote) { await connection.rollback(); return res.status(400).json({ error: "Admin note is required." }); }
    await connection.execute("UPDATE account_phase_reviews SET status = 'REJECTED', admin_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?", [adminNote, req.adminId, review.id]);
    await connection.commit();
    try {
      const [userRows] = await db.query("SELECT legal_name, email, trader_id FROM users WHERE id = ? LIMIT 1", [review.user_id]);
      const user = userRows[0] || {};
      const sourceSnapshot = typeof review.target_snapshot === "string" ? (() => { try { return JSON.parse(review.target_snapshot); } catch { return {}; } })() : (review.target_snapshot || {});
      await sendPhaseEmail(user.email, user.legal_name, user.trader_id, review.account_code, review.from_phase, review.to_phase, "REJECTED", adminNote, sourceSnapshot.profit_cents, sourceSnapshot.target_cents);
      await createNotification(review.user_id, "phase_rejected", `Phase ${review.from_phase} rejected`, `Your ${review.from_phase} phase review was rejected.`, null);
    } catch (notifyError) { console.error("Phase rejection notification failed:", notifyError.message); }
    res.json({ success: true });
  } catch (error) { if (connection) { try { await connection.rollback(); } catch {} } console.error("Reject phase review error:", error); res.status(500).json({ error: error.message }); }
  finally { if (connection) connection.release(); }
});

app.get("/api/user/phase-reviews", authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const [[countRow]] = await db.query("SELECT COUNT(*) AS total FROM account_phase_reviews WHERE user_id = ?", [req.userId]);
    const [reviews] = await db.query(`SELECT r.id, r.review_ref, r.account_id, r.from_phase, r.to_phase, r.status, r.target_snapshot, r.created_at, r.reviewed_at, r.admin_note, r.new_account_id, a.account_code, a.challenge_model FROM account_phase_reviews r JOIN accounts a ON a.id = r.account_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [req.userId, limit, offset]);
    res.json({ success: true, reviews: reviews.map((row) => ({ ...row, target_snapshot: typeof row.target_snapshot === "string" ? (() => { try { return JSON.parse(row.target_snapshot); } catch { return {}; } })() : (row.target_snapshot || {}), account: { id: row.account_id, code: row.account_code, challenge_model: row.challenge_model } })), pagination: { page, limit, total: Number(countRow?.total || 0), total_pages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / limit)) } });
  } catch (error) { console.error("User phase review list error:", error); res.status(500).json({ error: error.message }); }
});

// ========== ADMIN ADVANCED CONTROLS (STEP 4) ==========

// 1. Add/Subtract Funds Manually
app.post(
  "/api/admin/accounts/:id/add-funds",
  authenticateAdmin,
  async (req, res) => {
    const { amount_cents, reason } = req.body;
    try {
      const [accounts] = await db.execute(
        "SELECT * FROM accounts WHERE id = ?",
        [req.params.id],
      );
      if (!accounts.length)
        return res.status(404).json({ error: "Account not found" });
      const account = accounts[0];

      const newBalance = account.balance_cents + amount_cents;
      await db.execute(
        "UPDATE accounts SET balance_cents = ?, equity_cents = ? WHERE id = ?",
        [newBalance, newBalance, req.params.id],
      );

      // Log audit
      await db.execute(
        "INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        [
          req.adminId,
          "ADMIN",
          "FUND_ADJUST",
          "ACCOUNT",
          req.params.id,
          JSON.stringify({ amount_cents, reason }),
        ],
      );

      res.json({ success: true, new_balance: newBalance / 100 });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// 2. Unbreach Account & Reset
app.post(
  "/api/admin/accounts/:id/unbreach",
  authenticateAdmin,
  async (req, res) => {
    const { new_balance_cents, reset_drawdown } = req.body;
    try {
      const [accounts] = await db.execute(
        "SELECT * FROM accounts WHERE id = ?",
        [req.params.id],
      );
      if (!accounts.length)
        return res.status(404).json({ error: "Account not found" });
      const account = accounts[0];

      const newBalance = new_balance_cents || account.initial_balance_cents;
      await db.execute(
        `UPDATE accounts SET status = 'ACTIVE', balance_cents = ?, equity_cents = ?, equity_hwm_cents = ?, 
             day_start_balance_cents = ?, day_start_equity_cents = ?, current_daily_loss_cents = 0, 
             current_max_drawdown_cents = 0, breached_at = NULL, breach_reason = NULL WHERE id = ?`,
        [
          newBalance,
          newBalance,
          newBalance,
          newBalance,
          newBalance,
          req.params.id,
        ],
      );

      res.json({ success: true, message: "Account unbreached & reset" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// 3. Place Manual Trade on Behalf of User
app.post(
  "/api/admin/accounts/:id/manual-trade",
  authenticateAdmin,
  async (req, res) => {
    const { symbol, side, volume, entry_price, sl, tp } = req.body;
    try {
      const [accounts] = await db.execute(
        "SELECT * FROM accounts WHERE id = ?",
        [req.params.id],
      );
      if (!accounts.length)
        return res.status(404).json({ error: "Account not found" });
      const account = accounts[0];

      const tradeId = "ADM-" + Date.now().toString(36).toUpperCase();
      const tradingDay = new Date().toISOString().split("T")[0];

      await db.execute(
        `INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, trading_day, stop_loss, take_profit, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'OPEN')`,
        [
          tradeId,
          account.id,
          account.account_code,
          account.user_id,
          symbol,
          side,
          volume,
          entry_price,
          tradingDay,
          sl || null,
          tp || null,
        ],
      );

      res.json({ success: true, trade_id: tradeId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// 4. Allocate New Account to User
app.post(
  "/api/admin/users/:id/allocate-account",
  authenticateAdmin,
  async (req, res) => {
    const { model_key } = req.body;
    try {
      const [configs] = await db.execute(
        "SELECT * FROM challenge_configs WHERE model_key = ?",
        [model_key],
      );
      if (!configs.length)
        return res.status(404).json({ error: "Invalid challenge model" });
      const config = configs[0];

      const accountCode =
        "ACC-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        crypto.randomBytes(3).toString("hex").toUpperCase();

      await db.execute(
        `INSERT INTO accounts (account_code, user_id, challenge_model, phase, initial_balance_cents, balance_cents, equity_cents, status)
             VALUES (?, ?, ?, 'PHASE_1', ?, ?, ?, 'ACTIVE')`,
        [
          accountCode,
          req.params.id,
          model_key,
          config.starting_balance_cents,
          config.starting_balance_cents,
          config.starting_balance_cents,
        ],
      );

      res.json({ success: true, account_code: accountCode });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ========== SYSTEM SETTINGS API ==========

// Get all settings
app.get("/api/settings", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM settings");
    const settings = {};
    rows.forEach((row) => {
      settings[row.setting_key] = JSON.parse(row.setting_value);
    });
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings (admin only)
app.post("/api/admin/settings", authenticateAdmin, async (req, res) => {
  const { settings } = req.body;
  try {
    for (const [key, value] of Object.entries(settings)) {
      await db.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
        [key, JSON.stringify(value)],
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to get payment mode (used in payment request route)
async function getPaymentMode() {
  const [rows] = await db.query(
    'SELECT setting_value FROM settings WHERE setting_key = "payment_mode"',
  );
  if (rows.length > 0) {
    return JSON.parse(rows[0].setting_value).mode || "MANUAL";
  }
  return "MANUAL"; // default
}

// ========== AFFILIATE SCHEMA SELF-HEAL ==========
async function ensureAffiliateSchema() {
  const addColumnIfMissing = async (table, column, definition) => {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if (!Number(rows[0]?.n)) {
      await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  };

  await addColumnIfMissing('affiliates', 'wallet_balance_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliates', 'total_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliates', 'pending_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliates', 'paid_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'original_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'discount_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'final_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'commission_rate_bps', 'INT NOT NULL DEFAULT 2000');
  await addColumnIfMissing('affiliate_commissions', 'fixed_bonus_cents', 'BIGINT NOT NULL DEFAULT 100');
  await addColumnIfMissing('affiliate_commissions', 'paid_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'paid_at', 'DATETIME NULL');
  const [walletTableRows] = await db.execute("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'affiliate_wallet_transactions'");
  if (!Number(walletTableRows[0]?.n)) {
    await db.execute("CREATE TABLE affiliate_wallet_transactions (id BIGINT AUTO_INCREMENT PRIMARY KEY, affiliate_id BIGINT NOT NULL, txn_type ENUM('CREDIT','DEBIT') NOT NULL, source ENUM('COMMISSION','WITHDRAWAL','ADJUSTMENT') NOT NULL, amount_cents BIGINT NOT NULL, balance_after_cents BIGINT NOT NULL DEFAULT 0, order_id BIGINT NULL, withdrawal_id BIGINT NULL, sale_status VARCHAR(50) NULL, commission_status ENUM('EARNED','PAID','PENDING') DEFAULT 'EARNED', customer_email VARCHAR(255) NULL, account_code VARCHAR(50) NULL, description VARCHAR(255) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_commission_credit (order_id, source), KEY idx_awt_affiliate_time (affiliate_id, created_at DESC), KEY idx_awt_type (affiliate_id, txn_type))");
  }

  await db.execute(
    `UPDATE affiliate_commissions
     SET paid_amount_cents = commission_amount_cents, paid_at = COALESCE(paid_at, created_at)
     WHERE status = 'PAID' AND COALESCE(paid_amount_cents, 0) = 0`
  );

  await db.execute(
    `UPDATE affiliate_commissions ac
     JOIN payment_requests po ON po.id = ac.order_id
     SET ac.original_amount_cents = COALESCE(po.original_amount_cents, 0),
         ac.discount_amount_cents = COALESCE(po.discount_amount_cents, 0),
         ac.final_amount_cents = COALESCE(po.final_amount_cents, 0)
     WHERE COALESCE(ac.final_amount_cents, 0) = 0`
  );

  await db.execute(
    `UPDATE affiliates a
     LEFT JOIN (
       SELECT affiliate_id,
              COUNT(*) AS sales,
              COALESCE(SUM(commission_amount_cents), 0) AS total_earnings,
              COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents, 0), 0)), 0) AS pending_earnings,
              COALESCE(SUM(COALESCE(paid_amount_cents, 0)), 0) AS paid_earnings
       FROM affiliate_commissions
       GROUP BY affiliate_id
     ) c ON c.affiliate_id = a.id
     SET a.total_sales = COALESCE(c.sales, 0),
         a.total_earnings_cents = COALESCE(c.total_earnings, 0),
         a.pending_earnings_cents = COALESCE(c.pending_earnings, 0),
         a.paid_earnings_cents = COALESCE(c.paid_earnings, 0)`
  );

  console.log('Affiliate schema/ledger repair completed');
}

// ========== AFFILIATE STATS (Frontend Dashboard) ==========
app.get("/api/affiliate/stats", authenticateToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      "SELECT affiliate_code FROM users WHERE id = ? LIMIT 1",
      [req.userId]
    );
    if (!users.length) return res.status(404).json({ error: "User not found" });
    const affiliateCode = users[0].affiliate_code;

    const [affiliates] = await db.execute(
      "SELECT * FROM affiliates WHERE user_id = ? LIMIT 1",
      [req.userId]
    );

    if (!affiliates.length) {
      await ensureAffiliateSalesLedger();
      const [repairedAffiliates] = await db.execute(
        "SELECT * FROM affiliates WHERE user_id = ? LIMIT 1",
        [req.userId]
      );
      if (!repairedAffiliates.length) {
        return res.json({
          success: true,
          affiliate_code: affiliateCode,
          total_referrals: 0,
          total_sales: 0,
          total_earnings_cents: 0,
          pending_earnings_cents: 0,
          paid_earnings_cents: 0
        });
      }
      affiliates.push(repairedAffiliates[0]);
    }

    const affiliate = affiliates[0];

    const [refRows] = await db.execute(
      "SELECT COUNT(*) AS n FROM users WHERE referred_by_code = ?",
      [affiliateCode]
    );

    const [earnedRows] = await db.execute(
      `SELECT 
        COALESCE(SUM(commission_amount_cents), 0) AS total,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN commission_amount_cents ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'PAID' THEN commission_amount_cents ELSE 0 END), 0) AS paid
       FROM affiliate_commissions 
       WHERE affiliate_id = ?`,
      [affiliate.id]
    );

    res.json({
      success: true,
      affiliate_code: affiliateCode,
      total_referrals: Number(refRows[0]?.n || 0),
      total_sales: affiliate.total_sales || 0,
      total_earnings_cents: Number(earnedRows[0]?.total || 0),
      pending_earnings_cents: Number(earnedRows[0]?.pending || 0),
      paid_earnings_cents: Number(earnedRows[0]?.paid || 0)
    });
  } catch (error) {
    console.error("Affiliate stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== AFFILIATE DASHBOARD (Rich Data) ==========
app.get("/api/affiliate/dashboard", authenticateToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      "SELECT id, affiliate_code FROM users WHERE id = ? LIMIT 1",
      [req.userId]
    );
    if (!users.length) return res.status(404).json({ error: "User not found" });
    const affiliateCode = users[0].affiliate_code;

    const [affiliates] = await db.execute(
      "SELECT * FROM affiliates WHERE user_id = ? LIMIT 1",
      [req.userId]
    );

    if (!affiliates.length) {
      await ensureAffiliateSalesLedger();
      const [repairedAffiliates] = await db.execute(
        "SELECT * FROM affiliates WHERE user_id = ? LIMIT 1",
        [req.userId]
      );
      if (!repairedAffiliates.length) {
        return res.json({
          success: true,
          affiliate_code: affiliateCode,
          total_referrals: 0,
          verified_sales: 0,
          total_earnings_cents: 0,
          available_earnings_cents: 0,
          commissions: []
        });
      }
      affiliates.push(repairedAffiliates[0]);
    }

    const affiliate = affiliates[0];

    const [refRows] = await db.execute(
      "SELECT COUNT(*) AS n FROM users WHERE referred_by_code = ?",
      [affiliateCode]
    );

    const [commissions] = await db.execute(
      `SELECT
        s.id,
        s.request_id AS order_ref,
        s.model,
        s.original_amount_cents,
        s.discount_amount_cents,
        s.final_amount_cents,
        s.commission_amount_cents AS commission_cents,
        s.commission_rate_bps,
        s.fixed_bonus_cents,
        s.status,
        s.created_at,
        po.account_code AS account_code,
        u.email AS customer_email
       FROM affiliate_sales s
       LEFT JOIN payment_requests po ON po.id = s.order_id
       LEFT JOIN users u ON u.id = po.user_id
       WHERE s.affiliate_id = ?
       ORDER BY s.created_at DESC`,
      [affiliate.id]
    );

    const [commissionTotals] = await db.execute(
      `SELECT
        COALESCE(SUM(commission_amount_cents), 0) AS total_earnings_cents,
        COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents, 0), 0)), 0) AS pending_earnings_cents,
        COALESCE(SUM(COALESCE(paid_amount_cents, 0)), 0) AS paid_earnings_cents
       FROM affiliate_commissions
       WHERE affiliate_id = ?`,
      [affiliate.id]
    );
    const totalEarnings = Number(commissionTotals[0]?.total_earnings_cents || 0);
    const pendingEarnings = Number(commissionTotals[0]?.pending_earnings_cents || 0);
    const paidEarnings = Number(commissionTotals[0]?.paid_earnings_cents || 0);

    res.json({
      success: true,
      affiliate_code: affiliateCode,
      total_referrals: Number(refRows[0]?.n || 0),
      verified_sales: commissions.length,
      total_earnings_cents: totalEarnings,
      available_earnings_cents: pendingEarnings,
      pending_earnings_cents: pendingEarnings,
      paid_earnings_cents: paidEarnings,
      commissions: commissions
    });
  } catch (error) {
    console.error("Affiliate dashboard error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/affiliate/wallet", authenticateToken, async (req, res) => {
  try {
    await ensureAffiliateSalesLedger();
    const [affiliates] = await db.execute("SELECT * FROM affiliates WHERE user_id = ? LIMIT 1", [req.userId]);
    if (!affiliates.length) return res.status(404).json({ error: "Affiliate account not found" });
    const affiliate = affiliates[0];

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 50);
    const orderId = req.query.order_id ? String(req.query.order_id).trim() : "";
    const saleStatus = req.query.sale_status ? String(req.query.sale_status).trim() : "";
    const commissionStatus = req.query.commission_status ? String(req.query.commission_status).trim() : "";

    const filters = ["affiliate_id = ?"];
    const params = [affiliate.id];
    if (orderId) { filters.push("order_id = ?"); params.push(orderId); }
    if (saleStatus) { filters.push("sale_status = ?"); params.push(saleStatus); }
    if (commissionStatus) { filters.push("commission_status = ?"); params.push(commissionStatus); }
    const where = filters.join(" AND ");

    const [[countRow]] = await db.query("SELECT COUNT(*) AS total_count FROM affiliate_wallet_transactions WHERE " + where, params);
    const totalCount = Number(countRow?.total_count || 0);
    const totalPages = Math.ceil(totalCount / limit);
    const safePage = totalPages ? Math.min(page, totalPages) : 1;
    const offset = (safePage - 1) * limit;

    const [transactions] = await db.query(
      "SELECT id, txn_type, source, amount_cents, balance_after_cents, order_id, withdrawal_id, sale_status, commission_status, customer_email, account_code, description, created_at FROM affiliate_wallet_transactions WHERE " + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
      [...params, limit, offset]
    );
    const [[pendingRow]] = await db.query(
      "SELECT COALESCE(SUM(amount_cents),0) AS pending_withdrawal_cents FROM affiliate_wallet_transactions WHERE affiliate_id = ? AND txn_type = 'DEBIT' AND commission_status = 'PENDING'",
      [affiliate.id]
    );
    const [[statsRow]] = await db.query(
      "SELECT COALESCE(SUM(CASE WHEN source = 'COMMISSION' AND txn_type = 'CREDIT' THEN amount_cents ELSE 0 END),0) AS total_earnings_cents, COUNT(CASE WHEN source = 'COMMISSION' AND txn_type = 'CREDIT' THEN 1 END) AS total_sales FROM affiliate_wallet_transactions WHERE affiliate_id = ?",
      [affiliate.id]
    );
    const [[refRow]] = await db.query("SELECT COUNT(*) AS total_referrals FROM users WHERE referred_by_code = ?", [affiliate.affiliate_code]);

    res.json({
      success: true,
      affiliate_code: affiliate.affiliate_code,
      wallet_balance_cents: Number(affiliate.wallet_balance_cents || 0),
      total_earnings_cents: Number(statsRow?.total_earnings_cents || 0),
      total_sales: Number(statsRow?.total_sales || 0),
      total_referrals: Number(refRow?.total_referrals || 0),
      pending_withdrawal_cents: Number(pendingRow?.pending_withdrawal_cents || 0),
      page: safePage, limit, total_count: totalCount, total_pages: totalPages, transactions
    });
  } catch (error) {
    console.error("Affiliate wallet error:", error);
    res.status(500).json({ error: error.message });
  }
});


app.get("/api/user/wallet", authenticateToken, async (req, res) => {
  try {
    await db.execute(
      `INSERT INTO user_wallets (user_id)
       VALUES (?)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [req.userId],
    );

    const [rows] = await db.execute(
      `SELECT
         balance_cents,
         currency,
         total_received_cents,
         total_withdrawn_cents,
         created_at,
         updated_at
       FROM user_wallets
       WHERE user_id = ?
       LIMIT 1`,
      [req.userId],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const wallet = rows[0];
    const [cooldownRows] = await db.execute(
      "SELECT reviewed_at, TIMESTAMPADD(DAY, 14, reviewed_at) AS next_available_at, TIMESTAMPDIFF(SECOND, NOW(), TIMESTAMPADD(DAY, 14, reviewed_at)) AS seconds_remaining FROM withdrawal_request WHERE user_id = ? AND kind = 'WALLET' AND status = 'APPROVED' AND reviewed_at IS NOT NULL ORDER BY reviewed_at DESC LIMIT 1",
      [req.userId],
    );
    const cooldown = cooldownRows[0];
    const cooldownSeconds = Number(cooldown?.seconds_remaining || 0);
    const nextWithdrawalAt = cooldown && cooldownSeconds > 0
      ? new Date(cooldown.next_available_at).toISOString()
      : null;
    const daysUntilNextWithdrawal = cooldownSeconds > 0
      ? Math.ceil(cooldownSeconds / 86400)
      : 0;

    res.json({
      success: true,
      wallet: {
        balance_cents: Number(wallet.balance_cents || 0),
        currency: wallet.currency,
        total_received_cents: Number(wallet.total_received_cents || 0),
        total_withdrawn_cents: Number(wallet.total_withdrawn_cents || 0),
        display_name: "FundFXT Wallet",
        created_at: wallet.created_at,
        updated_at: wallet.updated_at,
        next_withdrawal_at: nextWithdrawalAt,
        days_until_next_withdrawal: daysUntilNextWithdrawal,
      },
    });
  } catch (error) {
    console.error("User wallet error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get(
  "/api/user/wallet/passbook",
  authenticateToken,
  async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 15, 1),
        50,
      );

      const txnType = req.query.txn_type
        ? String(req.query.txn_type).trim().toUpperCase()
        : "";

      const source = req.query.source
        ? String(req.query.source).trim().toUpperCase()
        : "";

      const filters = ["user_id = ?"];
      const params = [req.userId];

      if (txnType) {
        if (!["CREDIT", "DEBIT"].includes(txnType)) {
          return res.status(400).json({ error: "Invalid txn_type" });
        }
        filters.push("txn_type = ?");
        params.push(txnType);
      }

      if (source) {
        filters.push("source = ?");
        params.push(source);
      }

      const where = filters.join(" AND ");

      const [[countRow]] = await db.query(
        `SELECT COUNT(*) AS total_count
         FROM user_wallet_transactions
         WHERE ${where}`,
        params,
      );

      const totalCount = Number(countRow?.total_count || 0);
      const totalPages = Math.ceil(totalCount / limit);
      const safePage = totalPages ? Math.min(page, totalPages) : 1;
      const offset = (safePage - 1) * limit;

      const [transactions] = await db.query(
        `SELECT
           id,
           txn_type,
           source,
           amount_cents,
           balance_after_cents,
           reference_type,
           reference_id,
           description,
           created_at
         FROM user_wallet_transactions
         WHERE ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      const [[walletRow]] = await db.query(
        `SELECT balance_cents
         FROM user_wallets
         WHERE user_id = ?
         LIMIT 1`,
        [req.userId],
      );

      res.json({
        success: true,
        wallet_balance_cents: Number(walletRow?.balance_cents || 0),
        page: safePage,
        limit,
        total_count: totalCount,
        total_pages: totalPages,
        transactions,
      });
    } catch (error) {
      console.error("User wallet passbook error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

async function getAffiliateTransferMode() {
  try {
    const [rows] = await db.execute(
      "SELECT setting_value FROM admin_settings WHERE setting_key = 'affiliate_transfer_mode' LIMIT 1",
    );
    const mode = String(rows[0]?.setting_value || "MANUAL").trim().toUpperCase();
    return mode === "AUTO" || mode === "MANUAL" ? mode : "MANUAL";
  } catch (error) {
    console.error("Affiliate transfer mode read error:", error.message);
    return "MANUAL";
  }
}

app.get(
  "/api/admin/settings/affiliate-transfer-mode",
  authenticateAdmin,
  async (req, res) => {
    try {
      const mode = await getAffiliateTransferMode();
      res.json({ success: true, mode });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.post(
  "/api/admin/settings/affiliate-transfer-mode",
  authenticateAdmin,
  async (req, res) => {
    try {
      const mode = String(req.body?.mode || "").trim().toUpperCase();
      if (!["AUTO", "MANUAL"].includes(mode)) {
        return res.status(400).json({ error: "Mode must be AUTO or MANUAL" });
      }

      await db.execute(
        "INSERT INTO admin_settings (setting_key, setting_value) VALUES ('affiliate_transfer_mode', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
        [mode],
      );

      res.json({ success: true, mode });
    } catch (error) {
      console.error("Affiliate transfer mode save error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

app.post(
  "/api/user/wallet/request-affiliate-transfer",
  authenticateToken,
  async (req, res) => {
    const { amount_cents, reason } = req.body;

    try {
      const amount = Number(amount_cents);

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          error: "amount_cents must be a positive integer",
        });
      }

      const minimumTransfer = 1000;

      if (amount < minimumTransfer) {
        return res.status(400).json({
          error: "Minimum affiliate transfer is $10.00",
        });
      }

      const transferMode = await getAffiliateTransferMode();

      const [affiliates] = await db.execute(
        `SELECT id, wallet_balance_cents
         FROM affiliates
         WHERE user_id = ?
         LIMIT 1`,
        [req.userId],
      );

      if (!affiliates.length) {
        return res.status(404).json({
          error: "Affiliate account not found",
        });
      }

      const affiliate = affiliates[0];
      const affiliateBalance = Number(
        affiliate.wallet_balance_cents || 0,
      );

      if (affiliateBalance < amount) {
        return res.status(400).json({
          error: "Insufficient affiliate wallet balance",
        });
      }

      const [[pendingRow]] = await db.query(
        `SELECT id
         FROM affiliate_wallet_transfers
         WHERE user_id = ?
           AND status = 'PENDING'
         LIMIT 1`,
        [req.userId],
      );

      if (pendingRow) {
        return res.status(409).json({
          error: "A wallet transfer is already pending",
        });
      }

      const transferRef =
        "AWT-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        crypto.randomBytes(3).toString("hex").toUpperCase();

      const cleanReason =
        reason == null
          ? null
          : String(reason).trim().slice(0, 255);

      if (transferMode === "AUTO") {
        const connection = await db.getConnection();

        try {
          await connection.beginTransaction();

          const [affiliateRows] = await connection.query(
            `SELECT id, wallet_balance_cents
             FROM affiliates
             WHERE id = ?
             FOR UPDATE`,
            [affiliate.id],
          );

          if (!affiliateRows.length) {
            await connection.rollback();
            return res.status(404).json({ error: "Affiliate account not found" });
          }

          const lockedAffiliate = affiliateRows[0];
          const lockedAffiliateBalance = Number(
            lockedAffiliate.wallet_balance_cents || 0,
          );

          if (lockedAffiliateBalance < amount) {
            await connection.rollback();
            return res.status(400).json({
              error: "Insufficient affiliate wallet balance",
            });
          }

          const [[pendingRow]] = await connection.query(
            `SELECT id
             FROM affiliate_wallet_transfers
             WHERE user_id = ?
               AND status = 'PENDING'
             LIMIT 1
             FOR UPDATE`,
            [req.userId],
          );

          if (pendingRow) {
            await connection.rollback();
            return res.status(409).json({
              error: "A wallet transfer is already pending",
            });
          }

          const autoTransferRef =
            "AWT-" +
            Date.now().toString(36).toUpperCase() +
            "-" +
            crypto.randomBytes(3).toString("hex").toUpperCase();

          const [transferResult] = await connection.execute(
            `INSERT INTO affiliate_wallet_transfers
             (
               transfer_ref,
               user_id,
               affiliate_id,
               amount_cents,
               status,
               reason,
               processed_at,
               processed_by_admin_id
             )
             VALUES (?, ?, ?, ?, 'APPROVED', ?, NOW(), NULL)`,
            [
              autoTransferRef,
              req.userId,
              affiliate.id,
              amount,
              cleanReason,
            ],
          );

          const affiliateBalanceAfter = lockedAffiliateBalance - amount;

          await connection.execute(
            `UPDATE affiliates
             SET wallet_balance_cents = wallet_balance_cents - ?
             WHERE id = ?
               AND wallet_balance_cents >= ?`,
            [amount, affiliate.id, amount],
          );

          const [affiliateTxnResult] = await connection.execute(
            `INSERT INTO affiliate_wallet_transactions
             (
               affiliate_id,
               txn_type,
               source,
               amount_cents,
               balance_after_cents,
               reference_type,
               reference_id,
               description
             )
             VALUES (?, 'DEBIT', 'MOVE_TO_WALLET', ?, ?, 'WALLET_TRANSFER', ?, ?)`,
            [
              affiliate.id,
              amount,
              affiliateBalanceAfter,
              transferResult.insertId,
              "Moved to FundFXT Wallet",
            ],
          );

          await connection.execute(
            `INSERT INTO user_wallets
             (
               user_id,
               balance_cents,
               total_received_cents
             )
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
               balance_cents = balance_cents + VALUES(balance_cents),
               total_received_cents =
                 total_received_cents + VALUES(total_received_cents)`,
            [req.userId, amount, amount],
          );

          const [walletRows] = await connection.query(
            `SELECT id, balance_cents
             FROM user_wallets
             WHERE user_id = ?
             FOR UPDATE`,
            [req.userId],
          );

          if (!walletRows.length) {
            throw new Error("User wallet could not be created");
          }

          const walletBalanceAfter = Number(walletRows[0].balance_cents || 0);

          const [userTxnResult] = await connection.execute(
            `INSERT INTO user_wallet_transactions
             (
               user_id,
               txn_type,
               source,
               amount_cents,
               balance_after_cents,
               reference_type,
               reference_id,
               description
             )
             VALUES (?, 'CREDIT', 'AFFILIATE_TRANSFER', ?, ?, 'WALLET_TRANSFER', ?, 'Transferred from affiliate earnings')`,
            [
              req.userId,
              amount,
              walletBalanceAfter,
              transferResult.insertId,
            ],
          );

          await connection.execute(
            `UPDATE affiliate_wallet_transfers
             SET user_wallet_txn_id = ?, affiliate_txn_id = ?
             WHERE id = ?`,
            [
              userTxnResult.insertId,
              affiliateTxnResult.insertId,
              transferResult.insertId,
            ],
          );

          await connection.commit();

          const [userRows] = await db.execute(
            `SELECT email, trader_id, legal_name
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [req.userId],
          );
          const user = userRows[0];

          await sendWalletTransferEmail(
            user?.email,
            user?.legal_name || user?.trader_id,
            user?.trader_id,
            "APPROVED",
            amount,
            autoTransferRef,
          );

          return res.json({
            success: true,
            transfer_ref: autoTransferRef,
            amount_cents: amount,
            status: "APPROVED",
            new_wallet_balance: walletBalanceAfter,
          });
        } catch (error) {
          await connection.rollback().catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
      }

      await db.execute(
        `INSERT INTO affiliate_wallet_transfers
         (
           transfer_ref,
           user_id,
           affiliate_id,
           amount_cents,
           status,
           reason
         )
         VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        [
          transferRef,
          req.userId,
          affiliate.id,
          amount,
          cleanReason,
        ],
      );

      res.json({
        success: true,
        transfer_ref: transferRef,
        amount_cents: amount,
        status: "PENDING",
      });
    } catch (error) {
      console.error("Affiliate wallet transfer request error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

app.get(
  "/api/user/wallet/affiliate-transfers",
  authenticateToken,
  async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 15, 1),
        50,
      );

      const [[countRow]] = await db.query(
        `SELECT COUNT(*) AS total_count
         FROM affiliate_wallet_transfers
         WHERE user_id = ?`,
        [req.userId],
      );

      const totalCount = Number(countRow?.total_count || 0);
      const totalPages = Math.ceil(totalCount / limit);
      const safePage = totalPages ? Math.min(page, totalPages) : 1;
      const offset = (safePage - 1) * limit;

      const [transfers] = await db.query(
        `SELECT
           id,
           transfer_ref,
           amount_cents,
           status,
           reason,
           requested_at,
           processed_at,
           rejection_reason,
           user_wallet_txn_id,
           affiliate_txn_id
         FROM affiliate_wallet_transfers
         WHERE user_id = ?
         ORDER BY requested_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [req.userId, limit, offset],
      );

      res.json({
        success: true,
        page: safePage,
        limit,
        total_count: totalCount,
        total_pages: totalPages,
        transfers,
      });
    } catch (error) {
      console.error("Affiliate transfer history error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

app.get(
  "/api/admin/wallet-transfers",
  authenticateAdmin,
  async (req, res) => {
    try {
      const status = req.query.status
        ? String(req.query.status).trim().toUpperCase()
        : "PENDING";

      const validStatuses = ["PENDING", "APPROVED", "REJECTED"];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: "Invalid transfer status",
        });
      }

      const [transfers] = await db.query(
        `SELECT
           awt.id,
           awt.transfer_ref,
           awt.user_id,
           u.legal_name,
           u.email,
           awt.affiliate_id,
           a.affiliate_code,
           a.wallet_balance_cents AS affiliate_wallet_balance_cents,
           awt.amount_cents,
           awt.status,
           awt.reason,
           awt.requested_at,
           awt.processed_at,
           awt.processed_by_admin_id,
           awt.rejection_reason,
           awt.user_wallet_txn_id,
           awt.affiliate_txn_id
         FROM affiliate_wallet_transfers awt
         JOIN users u ON u.id = awt.user_id
         JOIN affiliates a ON a.id = awt.affiliate_id
         WHERE awt.status = ?
         ORDER BY awt.requested_at DESC, awt.id DESC`,
        [status],
      );

      res.json({
        success: true,
        status,
        transfers,
      });
    } catch (error) {
      console.error("Admin wallet transfers error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

app.post(
  "/api/admin/wallet-transfers/:id/approve",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [transferRows] = await connection.query(
        `SELECT *
         FROM affiliate_wallet_transfers
         WHERE id = ?
         FOR UPDATE`,
        [id],
      );

      if (!transferRows.length) {
        await connection.rollback();
        return res.status(404).json({
          error: "Wallet transfer not found",
        });
      }

      const transfer = transferRows[0];

      if (transfer.status !== "PENDING") {
        await connection.rollback();
        return res.status(409).json({
          error: "Wallet transfer has already been processed",
          status: transfer.status,
        });
      }

      const amount = Number(transfer.amount_cents || 0);

      if (!Number.isInteger(amount) || amount <= 0) {
        await connection.rollback();
        return res.status(400).json({
          error: "Invalid transfer amount",
        });
      }

      const [affiliateRows] = await connection.query(
        `SELECT *
         FROM affiliates
         WHERE id = ?
         FOR UPDATE`,
        [transfer.affiliate_id],
      );

      if (!affiliateRows.length) {
        await connection.rollback();
        return res.status(404).json({
          error: "Affiliate account not found",
        });
      }

      const affiliate = affiliateRows[0];
      const affiliateBalance = Number(
        affiliate.wallet_balance_cents || 0,
      );

      if (affiliateBalance < amount) {
        await connection.rollback();
        return res.status(400).json({
          error: "Insufficient affiliate wallet balance",
        });
      }

      const affiliateBalanceAfter = affiliateBalance - amount;

      await connection.execute(
        `UPDATE affiliates
         SET wallet_balance_cents = wallet_balance_cents - ?
         WHERE id = ?
           AND wallet_balance_cents >= ?`,
        [amount, transfer.affiliate_id, amount],
      );

      const [affiliateTxnResult] = await connection.execute(
        `INSERT INTO affiliate_wallet_transactions
         (
           affiliate_id,
           txn_type,
           source,
           amount_cents,
           balance_after_cents,
           reference_type,
           reference_id,
           description
         )
         VALUES (?, 'DEBIT', 'MOVE_TO_WALLET', ?, ?, 'WALLET_TRANSFER', ?, ?)`,
        [
          transfer.affiliate_id,
          amount,
          affiliateBalanceAfter,
          transfer.id,
          "Moved to FundFXT Wallet",
        ],
      );

      await connection.execute(
        `INSERT INTO user_wallets
         (
           user_id,
           balance_cents,
           total_received_cents
         )
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           balance_cents = balance_cents + VALUES(balance_cents),
           total_received_cents =
             total_received_cents + VALUES(total_received_cents)`,
        [transfer.user_id, amount, amount],
      );

      const [walletRows] = await connection.query(
        `SELECT id, balance_cents
         FROM user_wallets
         WHERE user_id = ?
         FOR UPDATE`,
        [transfer.user_id],
      );

      if (!walletRows.length) {
        throw new Error("User wallet could not be created");
      }

      const wallet = walletRows[0];
      const walletBalanceAfter = Number(wallet.balance_cents || 0);

      const [userTxnResult] = await connection.execute(
        `INSERT INTO user_wallet_transactions
         (
           user_id,
           txn_type,
           source,
           amount_cents,
           balance_after_cents,
           reference_type,
           reference_id,
           description
         )
         VALUES
         (
           ?,
           'CREDIT',
           'AFFILIATE_TRANSFER',
           ?,
           ?,
           'WALLET_TRANSFER',
           ?,
           'Transferred from affiliate earnings'
         )`,
        [
          transfer.user_id,
          amount,
          walletBalanceAfter,
          transfer.id,
        ],
      );

      await connection.execute(
        `UPDATE affiliate_wallet_transfers
         SET
           status = 'APPROVED',
           processed_at = NOW(),
           processed_by_admin_id = ?,
           user_wallet_txn_id = ?,
           affiliate_txn_id = ?
         WHERE id = ?
           AND status = 'PENDING'`,
        [
          req.adminId,
          userTxnResult.insertId,
          affiliateTxnResult.insertId,
          transfer.id,
        ],
      );

      await connection.commit();

      const [userEmailRows] = await db.execute(
        `SELECT id, email, trader_id
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [transfer.user_id],
      );
      const user = userEmailRows[0];

      if (!user || !user.email) {
        console.warn(
          "Skipping transfer email — no email for user",
          transfer.user_id,
        );
        return res.json({
          success: true,
          new_wallet_balance: walletBalanceAfter,
        });
      }

      const [legalNameColumns] = await db.execute(
        "SHOW COLUMNS FROM users LIKE 'legal_name'",
      );
      let customerName = user.trader_id;
      if (legalNameColumns.length) {
        const [legalNameRows] = await db.execute(
          `SELECT legal_name
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [transfer.user_id],
        );
        customerName = legalNameRows[0]?.legal_name || user.trader_id;
      }

      void sendWalletTransferEmail(
        user.email,
        customerName,
        user.trader_id,
        "APPROVED",
        amount,
        transfer.transfer_ref,
      );

      res.json({
        success: true,
        new_wallet_balance: walletBalanceAfter,
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_) {}

      console.error(
        "Admin wallet transfer approval error:",
        error,
      );

      res.status(500).json({
        error: error.message,
      });
    } finally {
      connection.release();
    }
  },
);

app.post(
  "/api/admin/wallet-transfers/:id/reject",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const rejectionReason =
      req.body?.rejection_reason == null
        ? null
        : String(req.body.rejection_reason)
            .trim()
            .slice(0, 255);

    try {
      const [transfers] = await db.execute(
        `SELECT id, status, user_id, amount_cents, transfer_ref
         FROM affiliate_wallet_transfers
         WHERE id = ?
         LIMIT 1`,
        [id],
      );

      if (!transfers.length) {
        return res.status(404).json({
          error: "Wallet transfer not found",
        });
      }

      if (transfers[0].status !== "PENDING") {
        return res.status(409).json({
          error: "Wallet transfer has already been processed",
          status: transfers[0].status,
        });
      }

      const [result] = await db.execute(
        `UPDATE affiliate_wallet_transfers
         SET
           status = 'REJECTED',
           processed_at = NOW(),
           processed_by_admin_id = ?,
           rejection_reason = ?
         WHERE id = ?
           AND status = 'PENDING'`,
        [req.adminId, rejectionReason, id],
      );

      if (result.affectedRows === 0) {
        return res.status(409).json({
          error: "Wallet transfer has already been processed",
        });
      }

      const transfer = transfers[0];
      const [userEmailRows] = await db.execute(
        `SELECT id, email, trader_id
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [transfer.user_id],
      );
      const user = userEmailRows[0];

      if (!user || !user.email) {
        console.warn(
          "Skipping transfer email — no email for user",
          transfer.user_id,
        );
        return res.json({ success: true });
      }

      const [legalNameColumns] = await db.execute(
        "SHOW COLUMNS FROM users LIKE 'legal_name'",
      );
      let customerName = user.trader_id;
      if (legalNameColumns.length) {
        const [legalNameRows] = await db.execute(
          `SELECT legal_name
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [transfer.user_id],
        );
        customerName = legalNameRows[0]?.legal_name || user.trader_id;
      }

      void sendWalletTransferEmail(
        user.email,
        customerName,
        user.trader_id,
        "REJECTED",
        transfer.amount_cents,
        transfer.transfer_ref,
        rejectionReason,
      );

      res.json({ success: true });
    } catch (error) {
      console.error(
        "Admin wallet transfer rejection error:",
        error,
      );

      res.status(500).json({
        error: error.message,
      });
    }
  },
);

// ========== AFFILIATE LEDGER & PAYOUT SYSTEM ==========
// ========== AFFILIATE LEDGER & PAYOUT SYSTEM ==========

// 1. User: Request Affiliate Payout (Min $100)
app.post(
  "/api/affiliate/payout/request",
  authenticateToken,
  async (req, res) => {
    const { amount_cents } = req.body;
    try {
      const [affiliates] = await db.execute("SELECT * FROM affiliates WHERE user_id = ?", [req.userId]);
      if (!affiliates.length) return res.status(404).json({ error: "Affiliate account not found" });
      const affiliate = affiliates[0];
      const minimumPayout = 10000;
      if (!amount_cents || amount_cents < minimumPayout) return res.status(400).json({ error: "Minimum payout is $100.00" });
      const walletBalance = Number(affiliate.wallet_balance_cents || 0);
      if (amount_cents > walletBalance) return res.status(400).json({ error: "Insufficient wallet balance" });

      const requestRef = "AF-PAY-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
      const [withdrawalResult] = await db.execute(
        "INSERT INTO withdrawal_request (request_ref, user_id, kind, amount_cents, currency, method, payout_details, status, created_at) VALUES (?, ?, 'AFFILIATE', ?, 'USD', 'BANK', ?, 'PENDING', NOW())",
        [requestRef, req.userId, amount_cents, JSON.stringify({ type: "AFFILIATE_COMMISSION" })]
      );

      const [holdResult] = await db.execute(
        "UPDATE affiliates SET wallet_balance_cents = wallet_balance_cents - ? WHERE id = ? AND wallet_balance_cents >= ?",
        [amount_cents, affiliate.id, amount_cents]
      );
      if (!holdResult.affectedRows) {
        await db.execute("DELETE FROM withdrawal_request WHERE id = ?", [withdrawalResult.insertId]);
        return res.status(400).json({ error: "Insufficient wallet balance" });
      }

      const [[userRow]] = await db.query("SELECT email, legal_name FROM users WHERE id = ?", [req.userId]);
      try {
        await db.execute(
          "INSERT INTO affiliate_wallet_transactions (affiliate_id, txn_type, source, amount_cents, balance_after_cents, withdrawal_id, commission_status, description) VALUES (?, 'DEBIT', 'WITHDRAWAL', ?, ?, ?, 'PENDING', ?)",
          [affiliate.id, amount_cents, walletBalance - amount_cents, withdrawalResult.insertId, "Withdrawal request " + requestRef]
        );
      } catch (walletError) {
        await db.execute("UPDATE affiliates SET wallet_balance_cents = wallet_balance_cents + ? WHERE id = ?", [amount_cents, affiliate.id]);
        await db.execute("DELETE FROM withdrawal_request WHERE id = ?", [withdrawalResult.insertId]);
        throw walletError;
      }

      if (userRow) {
        await sendEmail(
          "support.fundfxt@gmail.com",
          "New Affiliate Payout Request: " + requestRef,
          "<h3>Affiliate Payout Request</h3><p>User: " + userRow.legal_name + "</p><p>Amount: $" + (amount_cents / 100).toFixed(2) + "</p>"
        ).catch((err) => console.log("Affiliate payout email failed:", err.message));
      }
      res.json({ success: true, request_ref: requestRef });
    } catch (error) {
      console.error("Affiliate payout request error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// 2. User: View Affiliate Payout History
app.get("/api/affiliate/payouts", authenticateToken, async (req, res) => {
  try {
    const [payouts] = await db.execute(
      "SELECT * FROM withdrawal_request WHERE user_id = ? AND kind = 'AFFILIATE' ORDER BY created_at DESC",
      [req.userId],
    );
    res.json({ success: true, payouts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Admin: List All Affiliate Payout Requests
app.get("/api/admin/affiliate-payouts", authenticateAdmin, async (req, res) => {
  try {
    const [payouts] = await db.query(`
            SELECT pr.*, u.legal_name, u.email, a.affiliate_code
            FROM withdrawal_request pr
            JOIN users u ON pr.user_id = u.id
            LEFT JOIN affiliates a ON a.user_id = pr.user_id
            WHERE pr.kind = 'AFFILIATE'
            ORDER BY pr.created_at DESC
        `);
    res.json({ success: true, payouts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Admin: Update Affiliate Payout Status (Approve/Reject/Paid)
app.post(
  "/api/admin/affiliate-payouts/:id/status",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
      const [payouts] = await db.execute("SELECT * FROM withdrawal_request WHERE id = ? AND kind = 'AFFILIATE'", [id]);
      if (!payouts.length) return res.status(404).json({ error: "Payout not found" });
      const payout = payouts[0];
      if (payout.status === status) return res.json({ success: true });

      await db.execute("UPDATE withdrawal_request SET status = ? WHERE id = ?", [status, id]);

      if (status === "PAID") {
        await db.execute("UPDATE affiliate_wallet_transactions SET commission_status = 'PAID' WHERE withdrawal_id = ? AND txn_type = 'DEBIT' AND source = 'WITHDRAWAL'", [id]);

        let remaining = Number(payout.amount_cents || 0);
        const [pendingCommissions] = await db.execute(
          "SELECT id, commission_amount_cents, COALESCE(paid_amount_cents,0) AS paid_amount_cents FROM affiliate_commissions WHERE affiliate_id = (SELECT id FROM affiliates WHERE user_id = ?) AND status IN ('PENDING','PARTIALLY_PAID') ORDER BY created_at ASC, id ASC",
          [payout.user_id]
        );
        for (const commission of pendingCommissions) {
          if (remaining <= 0) break;
          const outstanding = Math.max(0, Number(commission.commission_amount_cents || 0) - Number(commission.paid_amount_cents || 0));
          if (!outstanding) continue;
          const allocation = Math.min(remaining, outstanding);
          const newPaid = Number(commission.paid_amount_cents || 0) + allocation;
          const newStatus = newPaid >= Number(commission.commission_amount_cents || 0) ? 'PAID' : 'PARTIALLY_PAID';
          await db.execute("UPDATE affiliate_commissions SET paid_amount_cents = ?, status = ?, paid_at = CASE WHEN ? = 'PAID' THEN NOW() ELSE paid_at END WHERE id = ?", [newPaid, newStatus, newStatus, commission.id]);
          remaining -= allocation;
        }
        await db.execute("UPDATE affiliates SET paid_earnings_cents = COALESCE(paid_earnings_cents,0) + ? WHERE user_id = ?", [Number(payout.amount_cents || 0) - remaining, payout.user_id]);
      }

      if (status === "REJECTED") {
        await db.execute("DELETE FROM affiliate_wallet_transactions WHERE withdrawal_id = ? AND txn_type = 'DEBIT' AND source = 'WITHDRAWAL'", [id]);
        await db.execute("UPDATE affiliates SET wallet_balance_cents = COALESCE(wallet_balance_cents,0) + ? WHERE user_id = ?", [Number(payout.amount_cents || 0), payout.user_id]);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Affiliate payout status error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// 5. Admin: Manually Adjust Affiliate Commission
app.post(
  "/api/admin/affiliates/:id/adjust-commission",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { amount_cents, type } = req.body; // type: 'ADD' or 'SUBTRACT'

    try {
      const [affiliates] = await db.execute(
        "SELECT * FROM affiliates WHERE id = ?",
        [id],
      );
      if (!affiliates.length)
        return res.status(404).json({ error: "Affiliate not found" });
      const affiliate = affiliates[0];

      let newTotal = affiliate.total_earnings_cents;
      let newPending = affiliate.pending_earnings_cents;

      if (type === "ADD") {
        newTotal += amount_cents;
        newPending += amount_cents;
      } else {
        if (amount_cents > newPending)
          return res
            .status(400)
            .json({ error: "Cannot subtract more than pending balance" });
        newTotal -= amount_cents;
        newPending -= amount_cents;
      }

      await db.execute(
        "UPDATE affiliates SET total_earnings_cents = ?, pending_earnings_cents = ? WHERE id = ?",
        [newTotal, newPending, id],
      );

      res.json({ success: true, new_total: newTotal, new_pending: newPending });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ========== CUSTOMER SUPPORT TICKETS ==========

// 1. User: Create Support Ticket
app.post("/api/support/ticket", authenticateToken, async (req, res) => {
  const { subject, message } = req.body;
  try {
    if (!subject || !message)
      return res.status(400).json({ error: "Subject and message required" });

    const ticketRef =
      "TKT-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    await db.execute(
      "INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)",
      [
        req.userId,
        "SUPPORT_TICKET",
        subject,
        message,
        `/support?ticket=${ticketRef}`,
      ],
    );

    // Create ticket in a support_tickets table (if exists, else create)
    // Assuming table already exists - if not, you'll need to create it manually
    // For now, we'll just store as notification and return ref
    res.json({ success: true, ticket_ref: ticketRef });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. User: Get My Tickets (via notifications or dedicated table)
app.get("/api/support/tickets", authenticateToken, async (req, res) => {
  try {
    const [tickets] = await db.execute(
      "SELECT * FROM notifications WHERE user_id = ? AND type = 'SUPPORT_TICKET' ORDER BY created_at DESC",
      [req.userId],
    );
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Admin: Get All Support Tickets
app.get("/api/admin/support/tickets", authenticateAdmin, async (req, res) => {
  try {
    const [tickets] = await db.query(`
            SELECT n.*, u.legal_name, u.email 
            FROM notifications n 
            JOIN users u ON n.user_id = u.id 
            WHERE n.type = 'SUPPORT_TICKET' 
            ORDER BY n.created_at DESC
        `);
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Admin: Resolve Ticket (mark as read/resolved)
app.post(
  "/api/admin/support/tickets/:id/resolve",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      await db.execute(
        'UPDATE notifications SET read_at = NOW() WHERE id = ? AND type = "SUPPORT_TICKET"',
        [id],
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ========== CERTIFICATES (User View) ==========

// 5. User: Get My Certificates
app.get("/api/certificates/my", authenticateToken, async (req, res) => {
  try {
    const [certificates] = await db.execute(
      `SELECT c.*, a.account_code 
             FROM certificates c 
             LEFT JOIN accounts a ON c.account_id = a.id 
             WHERE c.user_id = ? 
             ORDER BY c.issued_on DESC`,
      [req.userId],
    );
    res.json({ success: true, certificates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Verify Certificate (Public - used for verification page)
app.get("/api/certificates/verify/:certRef", async (req, res) => {
  try {
    const [cert] = await db.execute(
      `SELECT c.*, u.legal_name, a.account_code 
             FROM certificates c 
             JOIN users u ON c.user_id = u.id 
             LEFT JOIN accounts a ON c.account_id = a.id 
             WHERE c.certificate_ref = ?`,
      [req.params.certRef],
    );
    if (!cert.length)
      return res.status(404).json({ error: "Certificate not found" });
    res.json({ success: true, certificate: cert[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

