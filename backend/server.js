const WebSocket = require("ws");
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// ========== DATABASE ==========
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 10,
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

ensureAffiliateSalesLedger().catch((error) => console.error('Affiliate ledger startup error:', error.message));

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


// ========== AFFILIATE SALES LEDGER ==========
// Sale history is stored separately and contains no customer PII.
async function ensureAffiliateSalesLedger() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS affiliate_sales (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      affiliate_id BIGINT NOT NULL,
      order_id BIGINT NOT NULL,
      request_id VARCHAR(100) NOT NULL,
      affiliate_code VARCHAR(100) NULL,
      model VARCHAR(100) NULL,
      original_amount_cents BIGINT NOT NULL DEFAULT 0,
      discount_amount_cents BIGINT NOT NULL DEFAULT 0,
      final_amount_cents BIGINT NOT NULL DEFAULT 0,
      commission_rate_bps INT NOT NULL DEFAULT 2000,
      fixed_bonus_cents BIGINT NOT NULL DEFAULT 100,
      commission_amount_cents BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_affiliate_sales_order (affiliate_id, order_id),
      KEY idx_affiliate_sales_affiliate (affiliate_id, created_at)
    )`);

    // Rebuild missing historical affiliate sales from successful payments.
    // IMPORTANT: affiliate_code identifies the referrer, not the buyer.
    await db.execute(`
      INSERT IGNORE INTO affiliate_sales
        (affiliate_id, order_id, request_id, affiliate_code, model,
         original_amount_cents, discount_amount_cents, final_amount_cents,
         commission_rate_bps, fixed_bonus_cents, commission_amount_cents, status, created_at)
      SELECT
        a.id, po.id, po.request_id, po.affiliate_code, po.model,
        COALESCE(po.original_amount_cents,0),
        COALESCE(po.discount_amount_cents,0),
        COALESCE(po.final_amount_cents,0),
        2000, 100,
        FLOOR(COALESCE(po.final_amount_cents,0) * 0.20 + 100),
        'PENDING', COALESCE(po.created_at, NOW())
      FROM payment_orders po
      JOIN affiliates a ON a.affiliate_code = po.affiliate_code
      WHERE po.affiliate_code IS NOT NULL
        AND TRIM(po.affiliate_code) <> ''
        AND po.status IN ('PAYMENT_DONE','PAYMENT_APPROVED')
    `);

    // Keep the existing commission table compatible with the live schema.
    // Do not assume optional reporting columns exist there.
    await db.execute(`
      INSERT INTO affiliate_commissions
        (affiliate_id, order_id, referred_user_id, model, commission_amount_cents, status)
      SELECT
        s.affiliate_id, s.order_id, po.user_id, s.model, s.commission_amount_cents, 'PENDING'
      FROM affiliate_sales s
      JOIN payment_orders po ON po.id = s.order_id
      LEFT JOIN affiliate_commissions ac ON ac.order_id = s.order_id
      WHERE ac.id IS NULL
    `);

    // Reconcile totals using only stable commission columns.
    await db.execute(`
      UPDATE affiliates a
      LEFT JOIN (
        SELECT affiliate_id,
               COUNT(*) AS sales_count,
               COALESCE(SUM(commission_amount_cents),0) AS total_earnings
        FROM affiliate_commissions
        GROUP BY affiliate_id
      ) x ON x.affiliate_id = a.id
      SET a.total_sales = COALESCE(x.sales_count,0),
          a.total_earnings_cents = COALESCE(x.total_earnings,0),
          a.pending_earnings_cents = COALESCE(x.total_earnings,0)
    `);

    console.log('Affiliate sales ledger ready and historical sales reconciled.');
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
app.post("/api/register", async (req, res) => {
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
      "INSERT INTO affiliates (user_id, affiliate_code) VALUES (?, ?)",
      [result.insertId, newAffiliateCode],
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
app.post("/api/login", async (req, res) => {
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
app.post("/api/forgot-password", async (req, res) => {
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
app.post("/api/verify-otp", async (req, res) => {
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
app.post("/api/reset-password", async (req, res) => {
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

// ========== UPDATED RISK ENGINE ==========
async function checkAccountRisk(account) {
  const config = await getChallengeConfig(account.challenge_model);

  const equity = account.equity_cents;
  const balance = account.balance_cents;
  const dayStartBalance = account.day_start_balance_cents;
  const initialBalance = account.initial_balance_cents;
  const equityHwm = account.equity_hwm_cents;

  let dailyLossLimit = 0;
  let maxDrawdownLimit = 0;
  let currentDailyLoss = 0;
  let currentMaxDrawdown = 0;
  let breached = false;
  let reason = "";

  if (account.challenge_model === "prototype_5k") {
    dailyLossLimit = (config.daily_dd_bps / 10000) * dayStartBalance;
    currentDailyLoss = dayStartBalance - balance;

    maxDrawdownLimit = (config.max_dd_bps / 10000) * equityHwm;
    currentMaxDrawdown = equityHwm - equity;

    if (currentDailyLoss >= dailyLossLimit) {
      breached = true;
      reason = "DAILY_LOSS_BREACH";
    } else if (currentMaxDrawdown >= maxDrawdownLimit) {
      breached = true;
      reason = "MAX_DRAWDOWN_BREACH";
    }
  } else if (account.challenge_model === "warrior_5k") {
    dailyLossLimit = (config.daily_dd_bps / 10000) * dayStartBalance;
    currentDailyLoss = dayStartBalance - balance;

    maxDrawdownLimit = (config.max_dd_bps / 10000) * initialBalance;
    currentMaxDrawdown = initialBalance - balance;

    if (currentDailyLoss >= dailyLossLimit) {
      breached = true;
      reason = "DAILY_LOSS_BREACH";
    } else if (currentMaxDrawdown >= maxDrawdownLimit) {
      breached = true;
      reason = "MAX_DRAWDOWN_BREACH";
    }
  }

  const [tradeCountRow] = await db.execute(
    "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE() AND status = 'OPEN'",
    [account.id],
  );
  const tradesToday = tradeCountRow[0].count;

  if (breached) {
    await db.execute(
      "UPDATE accounts SET status = 'BREACHED', breached_at = NOW(), breach_reason = ? WHERE id = ?",
      [reason, account.id],
    );
    await db.execute(
      "UPDATE trades SET status = 'CLOSED', exit_time = NOW(), close_reason = 'BREACH' WHERE account_id = ? AND status = 'OPEN'",
      [account.id],
    );
  }

  return {
    breached,
    reason,
    allowed: !breached && tradesToday < config.max_trades_per_day,
    tradesToday,
    maxTrades: config.max_trades_per_day,
    dailyLossLimit: dailyLossLimit / 100,
    maxDrawdownLimit: maxDrawdownLimit / 100,
    currentDailyLoss: currentDailyLoss / 100,
    currentMaxDrawdown: currentMaxDrawdown / 100,
  };
}
// ========== ACCOUNTS ==========
app.get("/api/accounts", authenticateToken, async (req, res) => {
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

async function calculateServerPrice(model, affiliateCode) {
  const mappedModel = MODEL_MAP[model] || model;
  const config = await getChallengeConfig(mappedModel);
  const original = config.price_cents;
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
        original * (config.affiliate_discount_bps / 10000),
      );
      affiliateApplied = true;
    }
  }

  const finalAmount = Math.max(original - discountAmountCents, 0);
  return {
    model: mappedModel,
    originalAmountCents: original,
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

// ========== PAYMENT REQUEST (NEW) ==========
function generateRequestRef() {
  return (
    "REQ-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase()
  );
}

// ========== PAYMENT REQUEST ==========

app.post("/api/payments/request", authenticateToken, async (req, res) => {
  const { model, affiliate_code } = req.body || {};

  try {
    const pricing = await calculateServerPrice(model, affiliate_code);
    const [users] = await db.execute(
      "SELECT id, legal_name, email, phone FROM users WHERE id = ? LIMIT 1",
      [req.userId],
    );

    if (!users.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = users[0];
    const requestId = generateRequestRef();
    const affiliateId = pricing.affiliate_user_id || null;

    await db.execute(
      `INSERT INTO payment_orders (
                request_id, user_id, provider, razorpay_link, model, affiliate_code,
                affiliate_id, original_amount_cents, discount_amount_cents,
                final_amount_cents, paid_amount_cents, currency, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        requestId,
        user.id,
        "RAZORPAY",
        null,
        pricing.model,
        pricing.affiliateApplied ? affiliate_code : null,
        affiliateId,
        pricing.originalAmountCents,
        pricing.discountAmountCents,
        pricing.finalAmountCents,
        0,
        pricing.currency,
        "REQUESTED",
      ],
    );

    await sendEmail(
      "support.fundfxt@gmail.com",
      `FundFXT Payment Request ${requestId}`,
      `<h2>New FundFXT Payment Request</h2><p><strong>Request ID:</strong> ${requestId}</p><p><strong>Name:</strong> ${user.legal_name}</p><p><strong>Email:</strong> ${user.email}</p><p><strong>Challenge:</strong> ${pricing.model}</p><p><strong>Payable:</strong> ${(pricing.finalAmountCents / 100).toFixed(2)} ${pricing.currency}</p><p><strong>Affiliate:</strong> ${affiliate_code || "None"}</p><p>Please create and send a Razorpay Payment Link.</p>`,
    ).catch((error) =>
      console.error("Payment request email failed:", error.message),
    );

    return res.json({
      success: true,
      request_id: requestId,
      request_ref: requestId,
      status: "REQUESTED",
      manual_payment: true,
      pricing,
    });
  } catch (error) {
    console.error("Payment request error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ========== ADMIN AUTH ==========
app.post("/api/admin/login", async (req, res) => {
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
  let query = `SELECT po.*, u.legal_name, u.email as user_email FROM payment_orders po JOIN users u ON po.user_id = u.id`;
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

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.execute(
        "SELECT * FROM payment_orders WHERE id = ? FOR UPDATE",
        [id],
      );
      if (!orders.length) throw new Error("Order not found");
      const order = orders[0];

      await connection.execute(
        "UPDATE payment_orders SET status = ? WHERE id = ?",
        [status, id],
      );

      // If payment done/approved, add affiliate commission
      
      if (
        (status === "PAYMENT_DONE" || status === "PAYMENT_APPROVED") &&
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
      connection.release();
    }
  },
);

// Get withdrawals
app.get("/api/admin/withdrawals", authenticateAdmin, async (req, res) => {
  try {
    const [withdrawals] = await db.query(`
            SELECT pr.*, u.legal_name, u.email as user_email, a.account_code 
            FROM withdrawal_request pr 
            JOIN users u ON pr.user_id = u.id 
            LEFT JOIN accounts a ON pr.account_id = a.id 
            ORDER BY pr.created_at DESC
        `);
    res.json({ success: true, withdrawals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update withdrawal status
app.post(
  "/api/admin/withdrawals/:id/status",
  authenticateAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
      await db.execute(
        "UPDATE withdrawal_request SET status = ? WHERE id = ?",
        [status, id],
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

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

// Terminal market-data endpoint. Authenticated because the terminal is account-bound.
app.get("/api/prices", authenticateToken, (req, res) => {
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
    if (!accountCode)
      return res
        .status(400)
        .json({ success: false, error: "account_code is required" });
    const [accounts] = await db.execute(
      "SELECT id, account_code FROM accounts WHERE account_code = ? AND user_id = ? LIMIT 1",
      [accountCode, req.userId],
    );
    if (!accounts.length)
      return res
        .status(404)
        .json({ success: false, error: "Account not found" });
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE account_id = ? ORDER BY COALESCE(entry_time, created_at) DESC, id DESC",
      [accounts[0].id],
    );
    res.json({ success: true, account_code: accountCode, trades });
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

function calculatePL(symbol, side, entry, current, volume) {
  const inst = instruments[symbol];
  if (!inst) return 0;
  let diff = current - entry;
  if (side === "SELL") diff = -diff;
  return (diff / inst.pip) * (inst.size * inst.pip) * volume;
}

// ========== STEP 1: TRADING ENGINE & RISK MANAGEMENT ==========

// 1. RISK ENGINE (Strict Rules Enforcement)
async function checkAccountRisk(account) {
  const config = await getChallengeConfig(account.challenge_model);
  const equity = account.equity_cents;
  const balance = account.balance_cents;
  const dayStartBalance = account.day_start_balance_cents;
  const initialBalance = account.initial_balance_cents;
  const equityHwm = account.equity_hwm_cents;

  let dailyLossLimit, maxDrawdownLimit, currentDailyLoss, currentMaxDrawdown;
  let breached = false,
    reason = "";

  if (account.challenge_model === "prototype_5k") {
    // Direct: Daily 2% (Balance based), Max 5% (Floating/Trailing based on HWM)
    dailyLossLimit = (config.daily_dd_bps / 10000) * dayStartBalance;
    currentDailyLoss = dayStartBalance - balance;
    maxDrawdownLimit = (config.max_dd_bps / 10000) * equityHwm;
    currentMaxDrawdown = equityHwm - equity;
  } else if (account.challenge_model === "warrior_5k") {
    // Warrior: Daily 5% (Balance based), Max 8% (Balance based - Static)
    dailyLossLimit = (config.daily_dd_bps / 10000) * dayStartBalance;
    currentDailyLoss = dayStartBalance - balance;
    maxDrawdownLimit = (config.max_dd_bps / 10000) * initialBalance;
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
    "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE() AND status = 'OPEN'",
    [account.id],
  );
  const tradesToday = tradeCountRow[0].count;

  if (breached) {
    await db.execute(
      "UPDATE accounts SET status = 'BREACHED', breached_at = NOW(), breach_reason = ? WHERE id = ?",
      [reason, account.id],
    );
    await db.execute(
      "UPDATE trades SET status = 'CLOSED', exit_time = NOW(), close_reason = 'BREACH' WHERE account_id = ? AND status = 'OPEN'",
      [account.id],
    );
  }

  return {
    breached,
    reason,
    allowed: !breached && tradesToday < config.max_trades_per_day,
    tradesToday,
    maxTrades: config.max_trades_per_day,
    dailyLossLimit: dailyLossLimit / 100,
    maxDrawdownLimit: maxDrawdownLimit / 100,
    currentDailyLoss: currentDailyLoss / 100,
    currentMaxDrawdown: currentMaxDrawdown / 100,
  };
}

// 2. MANUAL CLOSE TRADE (Real-time P/L at market price)
app.post("/api/trades/:tradeId/close", authenticateToken, async (req, res) => {
  try {
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE trade_id = ? AND user_id = ?",
      [req.params.tradeId, req.userId],
    );
    if (!trades.length)
      return res.status(404).json({ error: "Trade not found" });
    const trade = trades[0];
    if (trade.status !== "OPEN")
      return res.status(400).json({ error: "Trade already closed" });

    const priceCache = global.priceCache || {};
    const price = priceCache[trade.symbol];
    if (!price) return res.status(400).json({ error: "Price not available" });

    const exitPrice = trade.side === "BUY" ? price.bid : price.ask;
    const realizedCents = Math.round(
      calculatePL(
        trade.symbol,
        trade.side,
        trade.entry_price,
        exitPrice,
        trade.volume,
      ) * 100,
    );

    await db.execute(
      `UPDATE trades SET status = 'CLOSED', exit_price = ?, exit_time = NOW(), realized_profit_cents = ?, close_reason = 'MANUAL' WHERE trade_id = ?`,
      [exitPrice, realizedCents, req.params.tradeId],
    );
    await db.execute(
      "UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?",
      [realizedCents, trade.account_id],
    );

    res.json({
      success: true,
      exit_price: exitPrice,
      realized_profit: realizedCents / 100,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. MODIFY SL/TP
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

// 4. PENDING ORDERS (Limit & Stop)
app.post("/api/trades/pending", authenticateToken, async (req, res) => {
  const {
    account_code,
    symbol,
    side,
    volume,
    order_type,
    limit_price,
    sl,
    tp,
  } = req.body;
  try {
    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE account_code = ? AND user_id = ?",
      [account_code, req.userId],
    );
    if (!accounts.length)
      return res.status(404).json({ error: "Account not found" });
    const account = accounts[0];
    const tradeId = "PD-" + Date.now().toString(36).toUpperCase();
    await db.execute(
      `INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, trading_day, stop_loss, take_profit, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), CURDATE(), ?, ?, 'PENDING')`,
      [
        tradeId,
        account.id,
        account_code,
        req.userId,
        symbol,
        side,
        volume,
        limit_price,
        sl || null,
        tp || null,
      ],
    );
    res.json({
      success: true,
      trade_id: tradeId,
      message: "Pending order placed",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/trades/pending", authenticateToken, async (req, res) => {
  const { account_code } = req.query;
  try {
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE account_code = ? AND user_id = ? AND status = 'PENDING'",
      [account_code, req.userId],
    );
    res.json({ success: true, trades });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/trades/:tradeId", authenticateToken, async (req, res) => {
  try {
    await db.execute(
      "UPDATE trades SET status = 'CANCELLED' WHERE trade_id = ? AND user_id = ? AND status = 'PENDING'",
      [req.params.tradeId, req.userId],
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. FLATTEN ALL (Close all open trades for an account)
app.post("/api/accounts/:id/flatten", authenticateToken, async (req, res) => {
  try {
    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
      [req.params.id, req.userId],
    );
    if (!accounts.length)
      return res.status(404).json({ error: "Account not found" });
    const account = accounts[0];

    const [openTrades] = await db.execute(
      "SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN'",
      [account.id],
    );
    for (const trade of openTrades) {
      const price = global.priceCache[trade.symbol];
      if (price) {
        const exitPrice = trade.side === "BUY" ? price.bid : price.ask;
        const realizedCents = Math.round(
          calculatePL(
            trade.symbol,
            trade.side,
            trade.entry_price,
            exitPrice,
            trade.volume,
          ) * 100,
        );
        await db.execute(
          "UPDATE trades SET status = 'CLOSED', exit_price = ?, realized_profit_cents = ?, close_reason = 'FLATTEN' WHERE trade_id = ?",
          [exitPrice, realizedCents, trade.trade_id],
        );
        await db.execute(
          "UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?",
          [realizedCents, account.id],
        );
      }
    }
    res.json({ success: true, message: "All trades flattened" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
async function processLivePrices() {
  const priceCache = global.priceCache || {};
  const [trades] = await db.execute(
    "SELECT * FROM trades WHERE status = 'OPEN'",
  );
  for (const trade of trades) {
    const price = priceCache[trade.symbol];
    if (!price) continue;
    const currentPrice = trade.side === "BUY" ? price.bid : price.ask;
    const floatingCents = Math.round(
      calculatePL(
        trade.symbol,
        trade.side,
        trade.entry_price,
        currentPrice,
        trade.volume,
      ) * 100,
    );
    await db.execute(
      "UPDATE trades SET current_price = ?, floating_profit_cents = ? WHERE trade_id = ?",
      [currentPrice, floatingCents, trade.trade_id],
    );
    // Ye code processLivePrices function ke andar, trade loop ke andar paste karo
    const [accounts] = await db.execute("SELECT * FROM accounts WHERE id = ?", [
      trade.account_id,
    ]);
    if (accounts.length > 0) {
      const account = accounts[0];
      const newEquity = account.balance_cents + floatingCents; // Balance + Floating P/L

      // ✅ ONLY for Direct Funded (Trailing): Update Equity HWM
      if (
        account.challenge_model === "prototype_5k" &&
        newEquity > account.equity_hwm_cents
      ) {
        await db.execute(
          "UPDATE accounts SET equity_hwm_cents = ? WHERE id = ?",
          [newEquity, account.id],
        );
      }

      // ✅ Update Current Equity
      await db.execute("UPDATE accounts SET equity_cents = ? WHERE id = ?", [
        newEquity,
        account.id,
      ]);

      // Check Risk
      const risk = await checkAccountRisk(account); // Reload updated account info if needed
      if (risk.breached) {
        await db.execute(
          "UPDATE trades SET status = 'CLOSED', exit_time = NOW(), close_reason = 'BREACH' WHERE account_id = ? AND status = 'OPEN'",
          [account.id],
        );
      }
    }
    let closeReason = null;
    if (trade.side === "BUY") {
      if (trade.stop_loss && currentPrice <= trade.stop_loss)
        closeReason = "SL";
      if (trade.take_profit && currentPrice >= trade.take_profit)
        closeReason = "TP";
    } else {
      if (trade.stop_loss && currentPrice >= trade.stop_loss)
        closeReason = "SL";
      if (trade.take_profit && currentPrice <= trade.take_profit)
        closeReason = "TP";
    }
    if (closeReason) {
      const realizedCents = Math.round(
        calculatePL(
          trade.symbol,
          trade.side,
          trade.entry_price,
          currentPrice,
          trade.volume,
        ) * 100,
      );
      await db.execute(
        `UPDATE trades SET status = 'CLOSED', exit_price = ?, exit_time = NOW(), realized_profit_cents = ?, close_reason = ? WHERE trade_id = ?`,
        [currentPrice, realizedCents, closeReason, trade.trade_id],
      );
      await db.execute(
        "UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?",
        [realizedCents, trade.account_id],
      );
    }
  }
}

// ========== TRADE EXECUTION ==========
app.post("/api/trade/execute", authenticateToken, async (req, res) => {
  const { account_code, symbol, side, volume, sl, tp } = req.body;

  // 1. Symbol validation
  if (!Object.prototype.hasOwnProperty.call(instruments, symbol)) {
    return res.status(400).json({ error: "Invalid symbol" });
  }

  // 2. Volume validation (strict server-side)
  if (!volume || volume < 0.01 || volume > 2.0) {
    return res
      .status(400)
      .json({ error: "Volume must be between 0.01 and 2.00" });
  }

  // 3. Fetch Account
  const [accounts] = await db.execute(
    "SELECT * FROM accounts WHERE account_code = ? AND user_id = ?",
    [account_code, req.userId],
  );
  if (!accounts.length)
    return res.status(404).json({ error: "Account not found" });
  const account = accounts[0];

  // 4. Check Account Status
  if (account.status !== "ACTIVE") {
    return res.status(403).json({ error: "Account is not active for trading" });
  }

  // 5. Check One-Position Rule
  const [openTrades] = await db.execute(
    "SELECT id FROM trades WHERE account_id = ? AND status = 'OPEN'",
    [account.id],
  );
  if (openTrades.length > 0) {
    return res.status(403).json({ error: "Only one open position allowed" });
  }

  // 6. Check Trades Today Limit
  const [tradesToday] = await db.execute(
    "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE() AND status = 'OPEN'",
    [account.id],
  );
  const config = await getChallengeConfig(account.challenge_model);
  if (tradesToday[0].count >= config.max_trades_per_day) {
    return res
      .status(403)
      .json({
        error: `Max ${config.max_trades_per_day} trades per day reached`,
      });
  }

  // 7. Check Risk Engine (Breached or not)
  const risk = await checkAccountRisk(account);
  if (risk.breached) {
    return res
      .status(403)
      .json({ error: "Account breached. Trading disabled" });
  }

  // 8. Execute Trade
  if (!global.priceCache[symbol])
    return res.status(400).json({ error: "Price not available" });
  const entry =
    side === "BUY"
      ? global.priceCache[symbol].ask
      : global.priceCache[symbol].bid;

  const tradeId = "TR-" + Date.now().toString(36).toUpperCase();
  const tradingDay = new Date().toISOString().split("T")[0];

  await db.execute(
    `INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, trading_day, stop_loss, take_profit, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'OPEN')`,
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

  res.json({ success: true, trade_id: tradeId, entry_price: entry });
});
// ========== WEBSOCKET SERVER ==========
const PORT = process.env.PORT || 3000;
let server;
let wss;

(async () => {
  try {
    await ensureAffiliateSchema();
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

// ========== SEED DEFAULT ADMIN ==================
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
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Lock the payment order so two admin requests
      // cannot create two accounts simultaneously.
      const [orders] = await connection.execute(
        "SELECT * FROM payment_orders WHERE id = ? FOR UPDATE",
        [id],
      );

      if (!orders.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orders[0];

      // Duplicate account protection.
      if (order.status === "ACCOUNT_CREATED") {
        await connection.rollback();
        return res.status(400).json({
          error: "Account already created",
          account_code: order.account_code || null,
        });
      }

      // Account should only be created after payment is done.
      if (order.status !== "PAYMENT_DONE") {
        await connection.rollback();
        return res.status(400).json({
          error: "Account can only be created after PAYMENT_DONE",
        });
      }

      const [configs] = await connection.execute(
        "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
        [order.model],
      );

      if (!configs.length) {
        throw new Error("Challenge config not found");
      }

      const config = configs[0];

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
          status
        )
        VALUES (?, ?, ?, 'PHASE_1', ?, ?, ?, 'ACTIVE')`,
        [
          accountCode,
          order.user_id,
          order.model,
          config.starting_balance_cents,
          config.starting_balance_cents,
          config.starting_balance_cents,
        ],
      );

      await connection.execute(
        `UPDATE payment_orders
         SET status = 'ACCOUNT_CREATED',
             account_code = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [accountCode, id],
      );

      // Affiliate commission is created only by PAYMENT_DONE/PAYMENT_APPROVED.

      await connection.commit();

      return res.json({
        success: true,
        account_code: accountCode,
        status: "ACCOUNT_CREATED",
      });
    } catch (error) {
      await connection.rollback();

      console.error("Create account transaction failed:", error);

      return res.status(500).json({
        error: error.message,
      });
    } finally {
      connection.release();
    }
  },
);
// ---------- GET USER ORDERS (Example) ----------
// GET User's Orders
app.get("/api/orders", authenticateToken, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT request_id, model, original_amount_cents, discount_amount_cents, final_amount_cents, currency, status, created_at
             FROM payment_orders
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
      `SELECT request_id, model, final_amount_cents, status, created_at FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
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

// 2. Request Withdrawal (User submits form)
app.post("/api/withdrawals/request", authenticateToken, async (req, res) => {
  const { account_id, amount_cents, method, payment_address } = req.body;

  try {
    // Validate inputs
    if (!account_id || !amount_cents || !method || !payment_address) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Fetch Account and verify ownership
    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
      [account_id, req.userId],
    );
    if (!accounts.length)
      return res.status(404).json({ error: "Account not found" });
    const account = accounts[0];

    // Check Account Status
    if (account.status !== "ACTIVE") {
      return res
        .status(400)
        .json({ error: "Account is not active for withdrawal" });
    }

    // Fetch Challenge Rules
    const [configs] = await db.execute(
      "SELECT * FROM challenge_configs WHERE model_key = ?",
      [account.challenge_model],
    );
    if (!configs.length)
      return res.status(404).json({ error: "Challenge rules not found" });
    const config = configs[0];

    // Check Payout Eligibility (Max Payout Count)
    if (
      config.max_payout_count &&
      account.payout_count >= config.max_payout_count
    ) {
      return res
        .status(400)
        .json({ error: "Max payout limit reached for this account" });
    }

    // Check Amount vs Equity (Can only withdraw profit)
    const profitCents = account.equity_cents - account.initial_balance_cents;
    if (amount_cents > profitCents) {
      return res
        .status(400)
        .json({ error: "Withdrawal amount exceeds current profit" });
    }

    // Generate Request Reference
    const requestRef =
      "WD-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    // Create Payout Request
    await db.execute(
      `INSERT INTO withdrawal_request 
             (request_ref, user_id, kind, account_id, amount_cents, currency, method, payout_details, status, eligibility_snapshot, created_at) 
             VALUES (?, ?, 'TRADER_PROFIT', ?, ?, 'USD', ?, ?, 'PENDING', ?, NOW())`,
      [
        requestRef,
        req.userId,
        account_id,
        amount_cents,
        method,
        JSON.stringify({ payment_address }),
        JSON.stringify({
          profit: profitCents,
          equity: account.equity_cents,
          balance: account.balance_cents,
        }),
      ],
    );

    // Notify Admin via Email (Optional)
    const [users] = await db.execute(
      "SELECT legal_name, email FROM users WHERE id = ?",
      [req.userId],
    );
    if (users.length) {
      await sendEmail(
        "support.fundfxt@gmail.com",
        `New Withdrawal Request: ${requestRef}`,
        `<h2>Withdrawal Request</h2><p>User: ${users[0].legal_name}</p><p>Account: ${account.account_code}</p><p>Amount: $${(amount_cents / 100).toFixed(2)}</p><p>Method: ${method}</p>`,
      ).catch((err) => console.log("Withdrawal email failed:", err.message));
    }

    res.json({ success: true, request_ref: requestRef });
  } catch (error) {
    console.error("Withdrawal request error:", error);
    res.status(500).json({ error: error.message });
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

  res.json({
    success: true,
    summary: {
      balance: account.balance_cents / 100,
      equity: account.equity_cents / 100,
      currentDailyLoss: risk.currentDailyLoss,
      dailyLossLimit: risk.dailyLossLimit,
      currentMaxDrawdown: risk.currentMaxDrawdown,
      maxDrawdownLimit: risk.maxDrawdownLimit,
      tradesToday: risk.tradesToday,
      maxTrades: risk.maxTrades,
      breached: risk.breached,
    },
  });
});

// ========== TRADE MANAGEMENT API ==========

// 1. Manual Close Trade
app.post("/api/trades/:tradeId/close", authenticateToken, async (req, res) => {
  try {
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE trade_id = ? AND user_id = ?",
      [req.params.tradeId, req.userId],
    );
    if (!trades.length)
      return res.status(404).json({ error: "Trade not found" });

    const trade = trades[0];
    if (trade.status !== "OPEN")
      return res.status(400).json({ error: "Trade already closed" });

    // Get current price from cache
    const priceCache = global.priceCache || {};
    const price = priceCache[trade.symbol];
    if (!price) return res.status(400).json({ error: "Price not available" });

    const exitPrice = trade.side === "BUY" ? price.bid : price.ask;
    const realizedCents = Math.round(
      calculatePL(
        trade.symbol,
        trade.side,
        trade.entry_price,
        exitPrice,
        trade.volume,
      ) * 100,
    );

    // Update trade
    await db.execute(
      `UPDATE trades SET status = 'CLOSED', exit_price = ?, exit_time = NOW(), realized_profit_cents = ?, close_reason = 'MANUAL' WHERE trade_id = ?`,
      [exitPrice, realizedCents, req.params.tradeId],
    );

    // Update account balance
    await db.execute(
      "UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?",
      [realizedCents, trade.account_id],
    );

    res.json({
      success: true,
      exit_price: exitPrice,
      realized_profit: realizedCents / 100,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// 3. Pending Orders (Limit/Stop)
app.post("/api/trades/pending", authenticateToken, async (req, res) => {
  const {
    account_code,
    symbol,
    side,
    volume,
    order_type,
    limit_price,
    sl,
    tp,
  } = req.body;

  try {
    const [accounts] = await db.execute(
      "SELECT * FROM accounts WHERE account_code = ? AND user_id = ?",
      [account_code, req.userId],
    );
    if (!accounts.length)
      return res.status(404).json({ error: "Account not found" });
    const account = accounts[0];

    const tradeId = "PD-" + Date.now().toString(36).toUpperCase();
    await db.execute(
      `INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, trading_day, stop_loss, take_profit, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), CURDATE(), ?, ?, 'PENDING')`,
      [
        tradeId,
        account.id,
        account_code,
        req.userId,
        symbol,
        side,
        volume,
        limit_price,
        sl || null,
        tp || null,
      ],
    );

    res.json({
      success: true,
      trade_id: tradeId,
      message: "Pending order placed",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Get Pending Orders
app.get("/api/trades/pending", authenticateToken, async (req, res) => {
  const { account_code } = req.query;
  try {
    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE account_code = ? AND user_id = ? AND status = 'PENDING'",
      [account_code, req.userId],
    );
    res.json({ success: true, trades });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Cancel Pending Order
app.delete("/api/trades/:tradeId", authenticateToken, async (req, res) => {
  try {
    await db.execute(
      "UPDATE trades SET status = 'CANCELLED' WHERE trade_id = ? AND user_id = ? AND status = 'PENDING'",
      [req.params.tradeId, req.userId],
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

  await db.execute(
    `UPDATE affiliate_commissions
     SET paid_amount_cents = commission_amount_cents, paid_at = COALESCE(paid_at, created_at)
     WHERE status = 'PAID' AND COALESCE(paid_amount_cents, 0) = 0`
  );

  await db.execute(
    `UPDATE affiliate_commissions ac
     JOIN payment_orders po ON po.id = ac.order_id
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

    const affiliate = affiliates[0];

    const [refRows] = await db.execute(
      "SELECT COUNT(*) AS n FROM users WHERE referred_by_code = ?",
      [affiliateCode]
    );

    const [commissions] = await db.execute(
      `SELECT
        id,
        request_id AS order_ref,
        model,
        original_amount_cents,
        discount_amount_cents,
        final_amount_cents,
        commission_amount_cents AS commission_cents,
        commission_rate_bps,
        fixed_bonus_cents,
        status,
        created_at
       FROM affiliate_sales
       WHERE affiliate_id = ?
       ORDER BY created_at DESC`,
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

// ========== AFFILIATE LEDGER & PAYOUT SYSTEM ==========
// ========== AFFILIATE LEDGER & PAYOUT SYSTEM ==========

// 1. User: Request Affiliate Payout (Min $100)
app.post(
  "/api/affiliate/payout/request",
  authenticateToken,
  async (req, res) => {
    const { amount_cents } = req.body;

    try {
      // Fetch user's affiliate record
      const [affiliates] = await db.execute(
        "SELECT * FROM affiliates WHERE user_id = ?",
        [req.userId],
      );
      if (!affiliates.length)
        return res.status(404).json({ error: "Affiliate account not found" });
      const affiliate = affiliates[0];

      // Validate amount (Min $100 = 10000 cents)
      const minimumPayout = 10000; // $100
      if (!amount_cents || amount_cents < minimumPayout) {
        return res.status(400).json({ error: "Minimum payout is $100.00" });
      }

      // Check pending earnings are sufficient
      if (amount_cents > affiliate.pending_earnings_cents) {
        return res.status(400).json({ error: "Insufficient pending earnings" });
      }

      // Generate request reference
      const requestRef =
        "AF-PAY-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        crypto.randomBytes(3).toString("hex").toUpperCase();

      // Create payout request (kind = AFFILIATE)
      await db.execute(
        `INSERT INTO withdrawal_request (request_ref, user_id, kind, amount_cents, currency, method, payout_details, status, created_at)
             VALUES (?, ?, 'AFFILIATE', ?, 'USD', 'BANK', ?, 'PENDING', NOW())`,
        [
          requestRef,
          req.userId,
          amount_cents,
          JSON.stringify({ type: "AFFILIATE_COMMISSION" }),
        ],
      );

      // Deduct pending earnings immediately to prevent double spend
      await db.execute(
        "UPDATE affiliates SET pending_earnings_cents = pending_earnings_cents - ? WHERE id = ?",
        [amount_cents, affiliate.id],
      );

      // Notify Admin via Email
      const [users] = await db.execute(
        "SELECT legal_name, email FROM users WHERE id = ?",
        [req.userId],
      );
      if (users.length) {
        await sendEmail(
          "support.fundfxt@gmail.com",
          `New Affiliate Payout Request: ${requestRef}`,
          `<h3>Affiliate Payout Request</h3><p>User: ${users[0].legal_name}</p><p>Amount: $${(amount_cents / 100).toFixed(2)}</p>`,
        ).catch((err) =>
          console.log("Affiliate payout email failed:", err.message),
        );
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
      const [payouts] = await db.execute(
        "SELECT * FROM withdrawal_request WHERE id = ?",
        [id],
      );
      if (!payouts.length)
        return res.status(404).json({ error: "Payout not found" });
      const payout = payouts[0];

      await db.execute(
        "UPDATE withdrawal_request SET status = ? WHERE id = ?",
        [status, id],
      );

      // If PAID, allocate this payout against the oldest unpaid commission balances.
      if (status === "PAID") {
        let remaining = Number(payout.amount_cents || 0);
        const [pendingCommissions] = await db.execute(
          `SELECT id, commission_amount_cents, COALESCE(paid_amount_cents, 0) AS paid_amount_cents
           FROM affiliate_commissions
           WHERE affiliate_id = (SELECT id FROM affiliates WHERE user_id = ?)
             AND status IN ('PENDING', 'PARTIALLY_PAID')
           ORDER BY created_at ASC, id ASC`,
          [payout.user_id],
        );

        for (const commission of pendingCommissions) {
          if (remaining <= 0) break;
          const outstanding = Math.max(
            0,
            Number(commission.commission_amount_cents || 0) -
              Number(commission.paid_amount_cents || 0),
          );
          if (!outstanding) continue;
          const allocation = Math.min(remaining, outstanding);
          const newPaid = Number(commission.paid_amount_cents || 0) + allocation;
          const newStatus = newPaid >= Number(commission.commission_amount_cents || 0)
            ? 'PAID'
            : 'PARTIALLY_PAID';

          await db.execute(
            `UPDATE affiliate_commissions
             SET paid_amount_cents = ?, status = ?, paid_at = CASE WHEN ? = 'PAID' THEN NOW() ELSE paid_at END
             WHERE id = ?`,
            [newPaid, newStatus, newStatus, commission.id],
          );
          remaining -= allocation;
        }

        await db.execute(
          `UPDATE affiliates SET paid_earnings_cents = COALESCE(paid_earnings_cents, 0) + ? WHERE user_id = ?`,
          [Number(payout.amount_cents || 0) - remaining, payout.user_id],
        );
      }
      // If REJECTED, refund pending earnings
      if (status === "REJECTED") {
        await db.execute(
          "UPDATE affiliates SET pending_earnings_cents = pending_earnings_cents + ? WHERE user_id = ?",
          [payout.amount_cents, payout.user_id],
        );
      }

      res.json({ success: true });
    } catch (error) {
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

