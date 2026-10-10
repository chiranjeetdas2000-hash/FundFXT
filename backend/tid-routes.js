const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const Razorpay = require("razorpay");
const { createRateLimiter } = require("./rate-limits");

const router = express.Router();

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("TID FATAL: JWT_SECRET is required");
  process.exit(1);
}

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: Number(process.env.TID_DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  ssl: { rejectUnauthorized: false },
});

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
});
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
});
const otpSendRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
});
const otpConfirmRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 10,
});
const webhookRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  limit: 60,
});

const EMAIL_OTP_EXPIRY_MINUTES = 10;
const PAK_LENGTH = 8;

function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanString(value, max = 255) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function generatePak() {
  return (
    "PAK-" +
    crypto
      .randomBytes(6)
      .toString("base64")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase()
      .slice(0, PAK_LENGTH)
      .padEnd(PAK_LENGTH, "0")
  );
}

function generateTid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 7; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'TID-' + code;
}

async function getUniqueTid(connection) {
  let tid, exists = true, attempts = 0;
  while (exists && attempts < 20) {
    tid = generateTid();
    const [rows] = await connection.execute(
      'SELECT id FROM tid_users WHERE tid = ? LIMIT 1',
      [tid]
    );
    exists = rows.length > 0;
    attempts++;
  }
  if (exists) throw new Error('Unable to generate unique TID');
  return tid;
}

async function getColumns(table) {
  const [rows] = await db.query("SHOW COLUMNS FROM " + mysql.escapeId(table));
  return rows.map((row) => row.Field);
}

async function getColumnsWithConnection(connection, table) {
  const [rows] = await connection.query("SHOW COLUMNS FROM " + mysql.escapeId(table));
  return rows.map((row) => row.Field);
}

function pickExisting(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || null;
}

async function insertFlexible(connection, table, values) {
  const columns = await getColumnsWithConnection(connection, table);
  const entries = Object.entries(values).filter(
    ([column, value]) => columns.includes(column) && value !== undefined,
  );
  if (!entries.length) {
    throw new Error("No compatible columns found for " + table);
  }

  const columnSql = entries.map(([column]) => mysql.escapeId(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const [result] = await connection.execute(
    "INSERT INTO " +
      mysql.escapeId(table) +
      " (" +
      columnSql +
      ") VALUES (" +
      placeholders +
      ")",
    entries.map(([, value]) => value),
  );
  return result;
}

async function updateFlexible(connection, table, values, whereSql, whereParams) {
  const columns = await getColumnsWithConnection(connection, table);
  const entries = Object.entries(values).filter(
    ([column, value]) => columns.includes(column) && value !== undefined,
  );
  if (!entries.length) return { affectedRows: 0 };

  const setSql = entries
    .map(([column]) => mysql.escapeId(column) + " = ?")
    .join(", ");
  const [result] = await connection.execute(
    "UPDATE " +
      mysql.escapeId(table) +
      " SET " +
      setSql +
      " WHERE " +
      whereSql,
    [...entries.map(([, value]) => value), ...whereParams],
  );
  return result;
}

function signTidToken(user) {
  return jwt.sign(
    {
      tidUserId: user.id,
      tid: user.tid,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: process.env.TID_JWT_EXPIRES_IN || "30d" },
  );
}

function authenticateTid(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return jsonError(res, 401, "No token");

  jwt.verify(token, JWT_SECRET, (error, decoded) => {
    if (error) return jsonError(res, 403, "Invalid token");
    if (!decoded?.tidUserId || !decoded?.tid || !decoded?.email) {
      return jsonError(res, 403, "Invalid TID token");
    }
    req.tidUser = decoded;
    next();
  });
}

function publicProfile(user, profile, verification) {
  return {
    tid: user.tid || null,
    full_name:
      user.full_name ||
      user.name ||
      profile?.full_name ||
      profile?.display_name ||
      null,
    email: user.email || null,
    public_access_key: undefined,
    bio: profile?.bio || null,
    location: profile?.location || null,
    country: profile?.country || null,
    website: profile?.website || null,
    avatar_url: profile?.avatar_url || null,
    trader_score:
      profile?.trader_score == null ? null : Number(profile.trader_score),
    verification_status:
      verification?.status ||
      verification?.verification_status ||
      user.verification_status ||
      "UNVERIFIED",
    identity_verified_at:
      verification?.verified_at ||
      verification?.completed_at ||
      null,
    created_at: user.created_at || null,
  };
}

async function fetchTidUserById(id) {
  const [rows] = await db.execute(
    "SELECT * FROM tid_users WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

async function fetchTidUserByTid(tid) {
  const [rows] = await db.execute(
    "SELECT * FROM tid_users WHERE tid = ? LIMIT 1",
    [tid],
  );
  return rows[0] || null;
}

async function fetchTidUserByEmail(email) {
  const [rows] = await db.execute(
    "SELECT * FROM tid_users WHERE email = ? LIMIT 1",
    [email],
  );
  return rows[0] || null;
}

function generateAccessKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "AK-";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function generatePaymentRequestNo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "PAY-";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function computeTraderStats(userId) {
  try {
    const profile = await fetchProfile(userId);
    const user = await fetchTidUserById(userId);
    const verification = await fetchLatestVerification(userId);

    const [accounts] = await db.execute(
      "SELECT account_type, status, win_rate_bps, profit_bps, account_size_cents FROM tid_accounts WHERE tid_user_id = ?",
      [userId]
    );

    const accountsCount = accounts.length;
    const fundedCount = accounts.filter(a => a.account_type === "FUNDED" || a.account_type === "LIVE" || a.status === "PASSED").length;
    const passedCount = accounts.filter(a => a.status === "PASSED").length;
    const failedCount = accounts.filter(a => a.status === "FAILED" || a.status === "BREACHED").length;

    let rank = "ROOKIE";
    if (fundedCount >= 25) rank = "LEGEND";
    else if (fundedCount >= 10) rank = "CHAMPION";
    else if (fundedCount >= 3) rank = "PRO";
    else if (fundedCount >= 1) rank = "TRADER";
    else if (accountsCount >= 1) rank = "CHALLENGER";

    const emailVerified = Boolean(user && (user.email_verified || user.is_email_verified));
    const kycStatus = verification && (verification.status || verification.verification_status);
    const kycVerified = kycStatus === "APPROVED" || kycStatus === "VERIFIED";
    const hasAvatar = Boolean(profile && profile.avatar_url);
    const hasBio = Boolean(profile && profile.bio);
    const hasCountrySocial = Boolean(profile && (profile.country || profile.twitter || profile.linkedin));

    const accountsPoints = Math.min(accountsCount * 3, 15);
    const fundedPoints = Math.min(fundedCount * 5, 15);

    const totalWinRateBps = accounts.reduce((s, a) => s + (Number(a.win_rate_bps) || 0), 0);
    const avgWinRateBps = accountsCount > 0 ? totalWinRateBps / accountsCount : 0;
    const winRatePoints = Math.min((avgWinRateBps / 100) * 0.2, 20);

    const memberSince = (profile && profile.member_since) || (user && user.created_at) || null;
    const daysSince = memberSince ? Math.floor((Date.now() - new Date(memberSince).getTime()) / 86400000) : 0;
    const tenurePoints = Math.min(Math.floor(daysSince / 30), 10);
    var tAgg = { w: 0, l: 0, bw: 0, bl: 0 };

    const trustScore = Math.round(
      (emailVerified ? 8 : 0) +
      (kycVerified ? 17 : 0) +
      (hasAvatar ? 5 : 0) +
      (hasBio ? 5 : 0) +
      (hasCountrySocial ? 5 : 0) +
      accountsPoints +
      fundedPoints +
      winRatePoints +
      tenurePoints
    );

    const passRateBps = accountsCount > 0 ? Math.round((passedCount / accountsCount) * 10000) : 0;
    const passRateStr = passRateBps > 0 ? (Math.floor(passRateBps / 100) + "%") : "0%";

    const totalProfitCents = accounts.reduce((sum, a) => {
      const size = Number(a.account_size_cents) || 0;
      const profitBps = Number(a.profit_bps) || 0;
      return sum + Math.round((size * profitBps) / 10000);
    }, 0);
    const totalProfitStr = "$" + Math.round(totalProfitCents / 100).toLocaleString("en-US");

    const bestWinRateBps = accounts.reduce((max, a) => Math.max(max, Number(a.win_rate_bps) || 0), 0);
    const bestWinRateStr = Math.floor(bestWinRateBps / 100) + "%";

    const profitUsd = totalProfitCents / 100;
    let tier = "—";
    if (profitUsd >= 100000) tier = "Tier 5";
    else if (profitUsd >= 50000) tier = "Tier 4";
    else if (profitUsd >= 10000) tier = "Tier 3";
    else if (profitUsd >= 1000) tier = "Tier 2";
    else if (profitUsd > 0) tier = "Tier 1";

    return {
      rank,
      trust_score: trustScore,
      pass_rate: passRateStr,
      pass_rate_bps: passRateBps,
      total_profit_cents: totalProfitCents,
      total_profit: totalProfitStr,
      best_win_rate_bps: bestWinRateBps,
      best_win_rate: bestWinRateStr,
      tier,
      total_challenges: accountsCount,
      total_passed: passedCount,
      total_failed: failedCount,
      funded_count: fundedCount,
      accounts_count: accountsCount,
      member_since: memberSince,
    };
  } catch (err) {
    console.error("computeTraderStats error:", err);
    return {
      rank: "ROOKIE",
      trust_score: 0,
      pass_rate: "0%",
      pass_rate_bps: 0,
      total_profit_cents: 0,
      total_profit: "$0",
      best_win_rate_bps: 0,
      best_win_rate: "0%",
      tier: "—",
      total_challenges: 0,
      total_passed: 0,
      total_failed: 0,
      funded_count: 0,
      accounts_count: 0,
      member_since: null,
    };
  }
}

async function fetchProfile(userId) {
  const [rows] = await db.execute(
    "SELECT * FROM tid_profiles WHERE tid_user_id = ? LIMIT 1",
    [userId],
  );
  return rows[0] || null;
}

async function fetchLatestVerification(userId) {
  const columns = await getColumns("tid_verifications");
  const userColumn = pickExisting(columns, [
    "tid_user_id",
    "user_id",
  ]);
  if (!userColumn) return null;

  const [rows] = await db.execute(
    "SELECT * FROM tid_verifications WHERE " +
      mysql.escapeId(userColumn) +
      " = ? ORDER BY id DESC LIMIT 1",
    [userId],
  );
  return rows[0] || null;
}

async function sendEmail(to, subject, html, timeoutMs) {
  const configuredFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const from = configuredFrom && configuredFrom.includes("<")
    ? configuredFrom
    : "Trader ID <" + configuredFrom + ">";

  if (process.env.RESEND_API_KEY) {
    const controller = new AbortController();
    const timeout = timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("Resend email failed with HTTP " + response.status);
      }
      return;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    host: process.env.SMTP_HOST || undefined,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    secure:
      process.env.SMTP_SECURE != null
        ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
        : undefined,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const sendMailPromise = transporter.sendMail({
    from,
    to,
    subject,
    html,
  });

  if (!timeoutMs) {
    await sendMailPromise;
    return;
  }

  await Promise.race([
    sendMailPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Email send timed out")), timeoutMs),
    ),
  ]);
}

async function createAndSendOtp(user) {
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
  const expiresAt = new Date(
    Date.now() + EMAIL_OTP_EXPIRY_MINUTES * 60 * 1000,
  );

  const columns = await getColumns("tid_email_verifications");
  const userColumn = pickExisting(columns, ["tid_user_id", "user_id"]);
  if (!userColumn) throw new Error("tid_email_verifications user column is missing");

  const now = new Date();
  const values = {
    tid_user_id: user.id,
    user_id: user.id,
    email: user.email,
    otp_hash: otpHash,
    code_hash: otpHash,
    token_hash: otpHash,
    expires_at: expiresAt,
    expires_on: expiresAt,
    created_at: now,
    sent_at: now,
    status: "PENDING",
    verified: 0,
  };

  await Promise.race([
    insertFlexible(db, "tid_email_verifications", values),    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OTP database insert timed out")), 5000),
    ),
  ]);

  try {
    await sendEmail(
      user.email,
      "Verify your Trader ID",
    "<!doctype html>" +
      "<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>" +
      "<body style=\"margin:0;padding:0;background:#F8F9FB;font-family:Inter,Arial,sans-serif;color:#0F1B2D\">" +
      "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#F8F9FB;padding:32px 16px\"><tr><td align=\"center\">" +
      "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;background:#FFFFFF;border:1px solid #E8EBF0;border-radius:14px;overflow:hidden\">" +
      "<tr><td style=\"padding:22px 28px;border-bottom:1px solid #E8EBF0\">" +
      "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr>" +
      "<td style=\"width:40px;height:40px;background:#0F1B2D;color:#FFFFFF;border-radius:8px;text-align:center;vertical-align:middle;font-weight:800;font-size:13px;letter-spacing:.5px\">TID</td>" +
      "<td style=\"padding-left:12px;font-size:18px;font-weight:700;color:#0F1B2D\">Trader ID</td>" +
      "</tr></table></td></tr>" +
      "<tr><td style=\"padding:36px 28px 30px\">" +
      "<p style=\"margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#B8935A\">Email verification</p>" +
      "<h1 style=\"margin:0 0 18px;font-size:28px;line-height:1.2;color:#0F1B2D\">Verify your email</h1>" +
      "<p style=\"margin:0 0 22px;font-size:15px;line-height:1.7;color:#64748B\">Hi ${escapeHtml(user.full_name || user.name || 'Trader')},</p>" +
      "<p style=\"margin:0 0 14px;font-size:15px;line-height:1.7;color:#64748B\">Your verification code is:</p>" +
      "<div style=\"margin:0 0 22px;padding:18px 20px;background:#F8F9FB;border:1px solid #E8EBF0;border-radius:10px;text-align:center\">" +
      "<span style=\"font-family:'JetBrains Mono',Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:9px;color:#0F1B2D\">${escapeHtml(otp)}</span>" +
      "</div>" +
      "<p style=\"margin:0 0 8px;font-size:14px;line-height:1.7;color:#64748B\">This code expires in ${EMAIL_OTP_EXPIRY_MINUTES} minutes.</p>" +
      "<p style=\"margin:0;font-size:14px;line-height:1.7;color:#64748B\">If you didn't request this, please ignore this email.</p>" +
      "</td></tr>" +
      "<tr><td style=\"padding:20px 28px;border-top:1px solid #E8EBF0;background:#F8F9FB\">" +
      "<p style=\"margin:0 0 5px;font-size:12px;color:#64748B\">Trader ID · A separate brand</p>" +
      "<p style=\"margin:0;font-size:12px;color:#94A3B8\">© 2026 · traderpassport.in</p>" +
      "</td></tr></table></td></tr></table></body></html>",
    );
  } catch (userEmailError) {
    console.warn("User OTP email failed:", userEmailError.message);
  }

  try {
    await sendEmail(
      "support.fundfxt@gmail.com",
      "TID Signup OTP for " + user.email,
      "<!doctype html><html><body style=\"font-family:Arial,sans-serif;color:#0F1B2D\">" +
        "<h2>New Trader ID signup</h2>" +
        "<p>Name: " + escapeHtml(user.full_name || user.name || "Trader") + "</p>" +
        "<p>Email: " + escapeHtml(user.email) + "</p>" +
        "<p>TID: " + escapeHtml(user.tid) + "</p>" +
        "<p>OTP: <strong>" + escapeHtml(otp) + "</strong></p>" +
        "<p>Requested at: " + escapeHtml(now.toISOString()) + "</p>" +
        "</body></html>",
    );
  } catch (supportEmailError) {
    console.warn("Support OTP email failed:", supportEmailError.message);
  }

  return expiresAt;
}

async function verifyOtp(userId, otp) {
  const columns = await getColumns("tid_email_verifications");
  const userColumn = pickExisting(columns, ["tid_user_id", "user_id"]);
  const hashColumn = pickExisting(columns, [
    "otp_hash",
    "code_hash",
    "token_hash",
  ]);
  const expiryColumn = pickExisting(columns, ["expires_at", "expires_on"]);
  const statusColumn = pickExisting(columns, ["status"]);
  const verifiedColumn = pickExisting(columns, ["verified", "is_verified"]);

  if (!userColumn || !hashColumn || !expiryColumn) {
    throw new Error("Email verification table is missing required columns");
  }

  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
  const [rows] = await db.execute(
    "SELECT * FROM tid_email_verifications WHERE " +
      mysql.escapeId(userColumn) +
      " = ? ORDER BY id DESC LIMIT 1",
    [userId],
  );
  const record = rows[0];
  if (!record) return { ok: false, reason: "Verification code not found" };

  const storedHash = record[hashColumn];
  const expiresAt = new Date(record[expiryColumn]).getTime();
  if (expiresAt < Date.now()) return { ok: false, reason: "Verification code expired" };
  if (statusColumn && String(record[statusColumn]).toUpperCase() === "VERIFIED") {
    return { ok: false, reason: "Email is already verified" };
  }
  if (verifiedColumn && Number(record[verifiedColumn]) === 1) {
    return { ok: false, reason: "Email is already verified" };
  }
  if (storedHash !== otpHash) return { ok: false, reason: "Invalid verification code" };

  const values = {};
  if (statusColumn) values.status = "VERIFIED";
  if (verifiedColumn) values[verifiedColumn] = 1;
  const verifiedAtColumn = pickExisting(columns, [
    "verified_at",
    "confirmed_at",
  ]);
  if (verifiedAtColumn) values[verifiedAtColumn] = new Date();

  await updateFlexible(
    db,
    "tid_email_verifications",
    values,
    mysql.escapeId("id") + " = ?",
    [record.id],
  );

  const userColumns = await getColumns("tid_users");
  const userVerifiedColumn = pickExisting(userColumns, [
    "email_verified",
    "is_email_verified",
  ]);
  const userVerifiedAtColumn = pickExisting(userColumns, [
    "email_verified_at",
    "verified_at",
  ]);
  const userValues = {};
  if (userVerifiedColumn) userValues[userVerifiedColumn] = 1;
  if (userVerifiedAtColumn) userValues[userVerifiedAtColumn] = new Date();
  if (Object.keys(userValues).length) {
    await updateFlexible(
      db,
      "tid_users",
      userValues,
      "id = ?",
      [userId],
    );
  }

  return { ok: true };
}

async function logAccess(req, tidUserId, tid, action) {
  try {
    const columns = await getColumns("tid_access_logs");
    const values = {
      tid_user_id: tidUserId,
      user_id: tidUserId,
      tid,
      action,
      endpoint: req.originalUrl,
      ip_address: req.ip,
      user_agent: req.get("user-agent"),
      created_at: new Date(),
    };
    await insertFlexible(db, "tid_access_logs", values);
  } catch (error) {
    console.warn("TID access log failed:", error.message);
  }
}

function requireJsonBody(req, res, next) {
  if (!req.is("application/json")) {
    return jsonError(res, 415, "Content-Type must be application/json");
  }
  next();
}

// ---------- PUBLIC ----------

// ---------- HEALTH / STARTUP ----------

router.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    return res.json({
      status: "ok",
      service: "Trader ID Backend",
      port: PORT,
      timestamp: Date.now(),
    });
  } catch (error) {
    return jsonError(res, 503, "Database unavailable");
  }
});


router.get("/ak/:key", async (req, res) => {
  try {
    const key = cleanString(req.params.key, 64).toUpperCase();
    if (!/^AK-[A-Z0-9]{8}$/.test(key)) {
      return jsonError(res, 400, "Invalid access key format");
    }

    const [rows] = await db.execute(
      "SELECT k.id, k.tid_user_id, k.scopes, k.expires_at, k.revoked_at, k.last_used_at, k.use_count FROM tid_access_keys k WHERE k.key_value = ? LIMIT 1",
      [key],
    );
    if (!rows.length) return jsonError(res, 404, "Invalid access key");

    const k = rows[0];
    if (k.revoked_at) return jsonError(res, 403, "Access key has been revoked");
    if (new Date(k.expires_at).getTime() < Date.now()) {
      return jsonError(res, 403, "Access key has expired");
    }

    const [users] = await db.execute(
      "SELECT * FROM tid_users WHERE id = ? LIMIT 1",
      [k.tid_user_id],
    );
    if (!users.length) return jsonError(res, 404, "User not found");
    const user = users[0];

    const profile = await fetchProfile(user.id);
    const stats = await computeTraderStats(user.id);

    await db.execute(
      "UPDATE tid_access_keys SET last_used_at = NOW(), use_count = use_count + 1 WHERE id = ? LIMIT 1",
      [k.id],
    );

    await logAccess(req, user.id, user.tid, "AK_VERIFY");

    const scopes = String(k.scopes || "identity").split(",").filter(Boolean);
    const hasScope = (s) => scopes.includes(s);

    const trader = {
      tid: user.tid || null,
      name: user.legal_name || null,
      member_since: profile?.member_since || user.created_at || null,
      avatar_url: profile?.avatar_url || null,
    };

    if (hasScope("identity")) {
      trader.rank = stats.rank;
      trader.trust_score = stats.trust_score;
      trader.pass_rate = stats.pass_rate;
      trader.verified_badges = profile?.verified_badges ?? null;
    }

    if (hasScope("accounts")) {
      trader.total_challenges = stats.total_challenges;
      trader.total_passed = stats.total_passed;
      trader.total_failed = stats.total_failed;
      trader.funded_count = stats.funded_count;
      trader.accounts_count = stats.accounts_count;
    }

    if (hasScope("trades")) {
      trader.best_win_rate = stats.best_win_rate;
      trader.best_win_rate_bps = stats.best_win_rate_bps;
    }

    if (hasScope("payouts")) {
      trader.payouts = stats.total_profit;
      trader.total_profit_cents = stats.total_profit_cents;
      trader.tier = stats.tier;
    }

    return res.json({
      success: true,
      verified: true,
      scopes,
      trader,
    });
  } catch (error) {
    console.error("TID AK verify error:", error);
    return jsonError(res, 500, "Unable to verify access key");
  }
});

router.get("/pak/:public_access_key", async (req, res) => {
  try {
    const pak = cleanString(req.params.public_access_key, 64);
    const userColumns = await getColumns("tid_users");
    const pakColumn = pickExisting(userColumns, [
      "public_access_key",
      "pak",
      "access_key",
    ]);
    if (!pakColumn) return jsonError(res, 500, "Public access key column is missing");

    const [rows] = await db.execute(
      "SELECT * FROM tid_users WHERE " +
        mysql.escapeId(pakColumn) +
        " = ? LIMIT 1",
      [pak],
    );
    if (!rows.length) return jsonError(res, 404, "Invalid public access key");

    const user = rows[0];
    const profile = await fetchProfile(user.id);
    const verification = await fetchLatestVerification(user.id);
    await logAccess(req, user.id, user.tid, "PAK_VERIFY");

    const stats = await computeTraderStats(user.id);
    const trader = {
      tid: user.tid || null,
      name: user.full_name || user.name || profile?.full_name || profile?.display_name || null,
      rank: stats.rank,
      trust_score: stats.trust_score,
      pass_rate: stats.pass_rate,
      payouts: stats.total_profit,
      tier: stats.tier,
      best_win_rate: stats.best_win_rate,
      total_challenges: stats.total_challenges,
      total_passed: stats.total_passed,
      total_failed: stats.total_failed,
      funded_count: stats.funded_count,
      accounts_count: stats.accounts_count,
      verified_badges: profile?.verified_badges ?? null,
      member_since: profile?.member_since || user.created_at || null,
      avatar_url: profile?.avatar_url || null,
    };
    return res.json({
      success: true,
      verified: true,
      trader,
    });
  } catch (error) {
    console.error("TID PAK verification error:", error);
    return jsonError(res, 500, "Unable to verify public access key");
  }
});

// ---------- AUTH ----------

router.post("/signup", authRateLimiter, requireJsonBody, async (req, res) => {
  const fullName = cleanString(req.body?.full_name, 120);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (fullName.length < 2) return jsonError(res, 400, "Full name is required");
  if (!isValidEmail(email)) return jsonError(res, 400, "Valid email is required");
  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return jsonError(
      res,
      400,
      "Password must be at least 8 characters and include a letter and a number",
    );
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      "SELECT id FROM tid_users WHERE email = ? LIMIT 1",
      [email],
    );
    if (existing.length) {
      await connection.rollback();
      return jsonError(res, 409, "An account with this email already exists");
    }

    const tid = await getUniqueTid(connection);
    let pak = generatePak();

    const userColumns = await getColumnsWithConnection(connection, "tid_users");
    const pakColumn = pickExisting(userColumns, [
      "public_access_key",
      "pak",
      "access_key",
    ]);

    if (!pakColumn) {
      await connection.rollback();
      return jsonError(res, 500, "tid_users public access key column is missing");
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [pakRows] = await connection.execute(
        "SELECT id FROM tid_users WHERE " +
          mysql.escapeId(pakColumn) +
          " = ? LIMIT 1",
        [pak],
      );
      if (!pakRows.length) break;
      pak = generatePak();
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await insertFlexible(connection, "tid_users", {
      tid,
      email,
      password_hash: passwordHash,
      password: passwordHash,
      full_name: fullName,
      name: fullName,
      legal_name: fullName,
      public_access_key: pak,
      pak,
      access_key: pak,
      email_verified: 0,
      is_email_verified: 0,
      status: "ACTIVE",
      created_at: new Date(),
      updated_at: new Date(),
    });

    const userId = userResult.insertId;
    await insertFlexible(connection, "tid_profiles", {
      tid_user_id: userId,
      user_id: userId,
      tid: tid,
      full_name: fullName,
      display_name: fullName,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await connection.commit();

    const user = {
      id: userId,
      tid,
      email,
      full_name: fullName,
    };
    const token = signTidToken(user);

    const responsePayload = {
      success: true,
      token,
      user: {
        id: userId,
        tid,
        email,
        full_name: fullName,
      },
    };

    // Return the signup response immediately. Email work must never block signup.
    res.status(201).json(responsePayload);

    setImmediate(() => {
      createAndSendOtp(user).catch((error) => {
        console.warn("Signup OTP email failed:", error.message);
      });

      sendEmail(
        email,
        "Welcome to Trader ID",
        "<!doctype html><html><body style=\"font-family:Arial,sans-serif;color:#0F1B2D\">" +
          "<h2>Welcome to Trader ID, " +
          escapeHtml(fullName) +
          ".</h2><p>Your Trader ID is <strong>" +
          escapeHtml(tid) +
          "</strong>.</p><p>Complete email and identity verification to build your Trader Passport.</p></body></html>",
        5000,
      ).catch((error) => {
        console.warn("Welcome email failed:", error.message);
      });

      logAccess(req, userId, tid, "SIGNUP").catch((error) => {
        console.warn("TID signup access log failed:", error.message);
      });
    });

    return;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}
    console.error("TID signup error:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return jsonError(res, 409, "An account with these details already exists");
    }
    return jsonError(res, 500, "Unable to create Trader ID account");
  } finally {
    connection.release();
  }
});

router.post("/login", loginRateLimiter, requireJsonBody, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!isValidEmail(email) || !password) {
    return jsonError(res, 400, "Email and password are required");
  }

  try {
    const user = await fetchTidUserByEmail(email);
    if (!user) return jsonError(res, 401, "Invalid email or password");

    const hash = user.password_hash || user.password;
    if (!hash || !(await bcrypt.compare(password, hash))) {
      return jsonError(res, 401, "Invalid email or password");
    }

    const token = signTidToken(user);
    await logAccess(req, user.id, user.tid, "LOGIN");

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        tid: user.tid,
        email: user.email,
        full_name: user.full_name || user.name || null,
      },
    });
  } catch (error) {
    console.error("TID login error:", error);
    return jsonError(res, 500, "Unable to sign in");
  }
});

// ---------- AUTHENTICATED PROFILE ----------

router.post("/access-keys", authenticateTid, requireJsonBody, async (req, res) => {
  try {
    const name = cleanString(req.body?.key_name, 100);
    if (!name || name.length < 2) return jsonError(res, 400, "Key name is required");

    const expiryDays = Math.min(365, Math.max(1, Number(req.body?.expiry_days) || 30));

    const rawScopes = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
    const allowedScopes = ["identity", "accounts", "trades", "payouts"];
    const scopes = rawScopes
      .map((s) => String(s || "").toLowerCase().trim())
      .filter((s) => allowedScopes.includes(s));
    if (!scopes.length) scopes.push("identity");

    let keyValue = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateAccessKey();
      const [dupe] = await db.execute(
        "SELECT id FROM tid_access_keys WHERE key_value = ? LIMIT 1",
        [candidate],
      );
      if (!dupe.length) { keyValue = candidate; break; }
    }
    if (!keyValue) return jsonError(res, 500, "Could not allocate access key");

    const expiresAt = new Date(Date.now() + expiryDays * 86400000);

    const [result] = await db.execute(
      "INSERT INTO tid_access_keys (tid_user_id, key_name, key_value, scopes, expires_at) VALUES (?, ?, ?, ?, ?)",
      [req.tidUser.tidUserId, name, keyValue, scopes.join(","), expiresAt],
    );

    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "ACCESS_KEY_CREATE");

    return res.status(201).json({
      success: true,
      key: {
        id: result.insertId,
        key_name: name,
        key_value: keyValue,
        scopes: scopes,
        expires_at: expiresAt,
      },
    });
  } catch (error) {
    console.error("TID access key create error:", error);
    return jsonError(res, 500, "Unable to create access key");
  }
});

router.get("/access-keys", authenticateTid, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, key_name, key_value, scopes, expires_at, revoked_at, last_used_at, use_count, created_at FROM tid_access_keys WHERE tid_user_id = ? ORDER BY created_at DESC LIMIT 100",
      [req.tidUser.tidUserId],
    );
    const now = Date.now();
    const keys = rows.map((r) => {
      const expired = new Date(r.expires_at).getTime() < now;
      const revoked = Boolean(r.revoked_at);
      return {
        id: r.id,
        key_name: r.key_name,
        key_value: r.key_value,
        scopes: String(r.scopes || "").split(",").filter(Boolean),
        expires_at: r.expires_at,
        revoked_at: r.revoked_at,
        last_used_at: r.last_used_at,
        use_count: r.use_count,
        created_at: r.created_at,
        status: revoked ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE",
      };
    });
    return res.json({ success: true, keys });
  } catch (error) {
    console.error("TID access key list error:", error);
    return jsonError(res, 500, "Unable to load access keys");
  }
});

router.delete("/access-keys/:id", authenticateTid, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid key id");

    const [r] = await db.execute(
      "UPDATE tid_access_keys SET revoked_at = NOW() WHERE id = ? AND tid_user_id = ? AND revoked_at IS NULL LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!r.affectedRows) return jsonError(res, 404, "Key not found or already revoked");

    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "ACCESS_KEY_REVOKE");

    return res.json({ success: true, revoked: id });
  } catch (error) {
    console.error("TID access key revoke error:", error);
    return res.json ? jsonError(res, 500, "Unable to revoke access key") : null;
  }
});

router.get("/accounts/:id/transactions", authenticateTid, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");
    const [acc] = await db.execute("SELECT id FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1", [id, req.tidUser.tidUserId]);
    if (!acc.length) return jsonError(res, 404, "Account not found");
    const [rows] = await db.execute("SELECT id, tx_type, amount_cents, tx_date, notes, created_at FROM tid_account_transactions WHERE account_id = ? AND tid_user_id = ? ORDER BY tx_date ASC", [id, req.tidUser.tidUserId]);
    return res.json({ success: true, transactions: rows });
  } catch (error) {
    console.error("TID transaction list error:", error);
    return jsonError(res, 500, "Unable to load transactions");
  }
});

router.post("/accounts/:id/request-update", authenticateTid, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");
    const [acc] = await db.execute("SELECT id FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1", [id, req.tidUser.tidUserId]);
    if (!acc.length) return jsonError(res, 404, "Account not found");
    const [existing] = await db.execute("SELECT id FROM tid_sync_log WHERE account_id = ? LIMIT 1", [id]);
    if (existing.length) {
      await db.execute("UPDATE tid_sync_log SET sync_status = 'PENDING', attempts = 0, error_message = NULL, updated_at = NOW() WHERE account_id = ? LIMIT 1", [id]);
    } else {
      await db.execute("INSERT INTO tid_sync_log (account_id, sync_status) VALUES (?, 'PENDING')", [id]);
    }
    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "UPDATE_REQUEST");
    return res.json({ success: true, message: "Update requested" });
  } catch (error) {
    console.error("TID update request error:", error);
    return jsonError(res, 500, "Unable to request update");
  }
});

router.get("/me", authenticateTid, async (req, res) => {
  try {
    const user = await fetchTidUserById(req.tidUser.tidUserId);
    if (!user) return jsonError(res, 404, "Trader ID account not found");

    const profile = await fetchProfile(user.id);
    const verification = await fetchLatestVerification(user.id);
    const stats = await computeTraderStats(user.id);
    await logAccess(req, user.id, user.tid, "ME");

    return res.json({
      success: true,
      user: {
        id: user.id,
        tid: user.tid,
        email: user.email,
        full_name: user.full_name || user.name || profile?.full_name || null,
        email_verified:
          Boolean(user.email_verified) || Boolean(user.is_email_verified),
        public_access_key:
          user.public_access_key || user.pak || user.access_key || null,
      },
      profile,
      verification,
      stats,
    });
  } catch (error) {
    console.error("TID me error:", error);
    return jsonError(res, 500, "Unable to load account");
  }
});

router.patch("/me/profile", authenticateTid, requireJsonBody, async (req, res) => {
  try {
    const allowed = [
      "full_name",
      "display_name",
      "bio",
      "location",
      "country",
      "website",
      "avatar_url",
      "phone",
      "timezone",
      "trading_style",
      "twitter",
      "linkedin",
      "card_pattern",
    ];
    const body = req.body || {};
    const profileValues = {};

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        profileValues[key] = cleanString(body[key], key === "bio" ? 1000 : 255);
      }
    }

    if (profileValues.full_name && profileValues.full_name.length < 2) {
      return jsonError(res, 400, "Full name is too short");
    }

    const VALID_PATTERNS = ["classic", "silver", "emerald", "gold", "midnight"];
    if (profileValues.card_pattern !== undefined && !VALID_PATTERNS.includes(profileValues.card_pattern)) {
      return jsonError(res, 400, "Invalid card pattern");
    }

    profileValues.updated_at = new Date();

    const existing = await fetchProfile(req.tidUser.tidUserId);
    if (existing) {
      await updateFlexible(        db,
        "tid_profiles",
        profileValues,
        "id = ?",
        [existing.id],
      );
    } else {
      await insertFlexible(db, "tid_profiles", {
        tid_user_id: req.tidUser.tidUserId,
        user_id: req.tidUser.tidUserId,
        tid: req.tidUser.tid,
        ...profileValues,
        created_at: new Date(),
      });
    }

    if (profileValues.full_name) {
      const userColumns = await getColumns("tid_users");
      const values = {};
      const nameColumn = pickExisting(userColumns, ["full_name", "name"]);
      if (nameColumn) values[nameColumn] = profileValues.full_name;
      if (Object.keys(values).length) {
        await updateFlexible(db, "tid_users", values, "id = ?", [
          req.tidUser.tidUserId,
        ]);
      }
    }

    const profile = await fetchProfile(req.tidUser.tidUserId);
    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "PROFILE_UPDATE");

    return res.json({ success: true, profile });
  } catch (error) {
    console.error("TID profile update error:", error);
    return jsonError(res, 500, "Unable to update profile");
  }
});

router.get("/me/stats", authenticateTid, async (req, res) => {
  try {
    const userId = req.tidUser.tidUserId;
    const counts = {};

    const queries = [
      ["verifications", "tid_verifications"],
      ["card_orders", "tid_card_orders"],
      ["access_logs", "tid_access_logs"],
      ["disputes", "tid_disputes"],
    ];

    for (const [key, table] of queries) {
      try {
        const columns = await getColumns(table);
        const userColumn = pickExisting(columns, ["tid_user_id", "user_id"]);
        if (!userColumn) {
          counts[key] = 0;
          continue;
        }
        const [[row]] = await db.execute(
          "SELECT COUNT(*) AS count FROM " +
            mysql.escapeId(table) +
            " WHERE " +
            mysql.escapeId(userColumn) +
            " = ?",
          [userId],
        );
        counts[key] = Number(row.count || 0);
      } catch (_) {
        counts[key] = 0;
      }
    }

    const user = await fetchTidUserById(userId);
    const verification = await fetchLatestVerification(userId);
    return res.json({
      success: true,
      stats: {
        tid: user?.tid || req.tidUser.tid,
        verification_status:
          verification?.status ||
          verification?.verification_status ||
          "UNVERIFIED",
        ...counts,
      },
    });
  } catch (error) {
    console.error("TID stats error:", error);
    return jsonError(res, 500, "Unable to load stats");
  }
});

// ---------- EMAIL VERIFICATION ----------

router.post(
  "/verify-email/send",
  otpSendRateLimiter,
  authenticateTid,
  async (req, res) => {
    try {
      const user = await fetchTidUserById(req.tidUser.tidUserId);
      if (!user) return jsonError(res, 404, "Trader ID account not found");
      if (user.email_verified || user.is_email_verified) {
        return res.json({ success: true, already_verified: true });
      }

      const expiresAt = await createAndSendOtp(user);
      await logAccess(req, user.id, user.tid, "EMAIL_OTP_SEND");

      return res.json({
        success: true,
        expires_at: expiresAt,
      });
    } catch (error) {
      console.error("TID email send error:", error);
      return jsonError(res, 500, "Unable to send verification email");
    }
  },
);

router.post(
  "/verify-email/resend",
  otpSendRateLimiter,
  authenticateTid,
  async (req, res) => {
    try {
      const user = await fetchTidUserById(req.tidUser.tidUserId);
      if (!user) return jsonError(res, 404, "Trader ID account not found");
      if (user.email_verified || user.is_email_verified) {
        return res.json({ success: true, already_verified: true });
      }

      const expiresAt = await createAndSendOtp(user);
      await logAccess(req, user.id, user.tid, "EMAIL_OTP_RESEND");

      return res.json({
        success: true,
        expires_at: expiresAt,
      });
    } catch (error) {
      console.error("TID email resend error:", error);
      return jsonError(res, 500, "Unable to resend verification email");
    }
  },
);

router.post(
  "/verify-email/confirm",
  otpConfirmRateLimiter,
  authenticateTid,
  requireJsonBody,
  async (req, res) => {
    const otp = String(req.body?.otp || "").trim();
    if (!/^\d{6}$/.test(otp)) {
      return jsonError(res, 400, "Enter the 6-digit verification code");
    }

    try {
      const result = await verifyOtp(req.tidUser.tidUserId, otp);
      if (!result.ok) return jsonError(res, 400, result.reason);

      await logAccess(
        req,
        req.tidUser.tidUserId,
        req.tidUser.tid,
        "EMAIL_OTP_CONFIRM",
      );
      return res.json({ success: true, verified: true });
    } catch (error) {
      console.error("TID email confirm error:", error);
      return jsonError(res, 500, "Unable to confirm email");
    }
  },
);

// ---------- IDENTITY VERIFICATION / VERIFF ----------

router.post("/verify-identity/initiate", authenticateTid, async (req, res) => {
  try {
    const columns = await getColumns("tid_verifications");
    const userColumn = pickExisting(columns, ["tid_user_id", "user_id"]);
    if (!userColumn) return jsonError(res, 500, "Verification user column is missing");

    const existing = await fetchLatestVerification(req.tidUser.tidUserId);
    const sessionId =
      "tid_" +
      crypto.randomBytes(18).toString("hex");

    const values = {
      tid_user_id: req.tidUser.tidUserId,
      user_id: req.tidUser.tidUserId,
      provider: "veriff",
      provider_name: "VERIFF",
      session_id: sessionId,
      veriff_session_id: sessionId,
      status: "PENDING",
      verification_status: "PENDING",
      created_at: new Date(),
      updated_at: new Date(),
    };

    if (existing) {
      await updateFlexible(
        db,
        "tid_verifications",
        values,
        "id = ?",
        [existing.id],
      );
    } else {
      await insertFlexible(db, "tid_verifications", values);
    }

    await logAccess(
      req,
      req.tidUser.tidUserId,
      req.tidUser.tid,
      "IDENTITY_INITIATE",
    );

    if (!process.env.VERIFF_API_KEY) {
      return res.json({
        success: true,
        placeholder: true,
        status: "PENDING",
        session_id: sessionId,
        message: "Veriff integration is not configured yet",
      });
    }

    return res.json({
      success: true,
      placeholder: false,
      status: "PENDING",
      session_id: sessionId,
      message: "Veriff credentials are configured; provider session wiring is pending",
    });
  } catch (error) {
    console.error("TID identity initiation error:", error);
    return jsonError(res, 500, "Unable to initiate identity verification");
  }
});

router.post(
  "/verify-identity/webhook",
  webhookRateLimiter,
  async (req, res) => {
    try {
      const expectedSecret = process.env.VERIFF_WEBHOOK_SECRET;
      if (expectedSecret) {
        const provided =
          req.get("x-veriff-webhook-secret") ||
          req.get("x-veriff-signature") ||
          "";
        if (
          !crypto.timingSafeEqual(
            Buffer.from(String(provided)),
            Buffer.from(String(expectedSecret)),
          )
        ) {
          return jsonError(res, 401, "Invalid Veriff webhook signature");
        }
      }

      const payload = req.body || {};
      const sessionId =
        payload.sessionId ||
        payload.session_id ||
        payload.verification?.id ||
        null;
      if (!sessionId) return jsonError(res, 400, "Missing Veriff session ID");

      const status =
        payload.status ||
        payload.verification?.status ||
        "PENDING";
      const normalizedStatus = String(status).toUpperCase();

      const columns = await getColumns("tid_verifications");
      const sessionColumn = pickExisting(columns, [
        "session_id",
        "veriff_session_id",
        "provider_session_id",
      ]);
      if (!sessionColumn) return jsonError(res, 500, "Verification session column is missing");

      const [rows] = await db.execute(
        "SELECT * FROM tid_verifications WHERE " +
          mysql.escapeId(sessionColumn) +
          " = ? ORDER BY id DESC LIMIT 1",
        [sessionId],
      );
      if (!rows.length) return jsonError(res, 404, "Verification session not found");

      const verification = rows[0];
      const values = {
        status: normalizedStatus,
        verification_status: normalizedStatus,
        webhook_payload: JSON.stringify(payload),
        raw_response: JSON.stringify(payload),
        updated_at: new Date(),
        completed_at:
          ["APPROVED", "DECLINED", "SUCCESS", "FAILED"].includes(normalizedStatus)
            ? new Date()
            : undefined,
        verified_at:
          ["APPROVED", "SUCCESS"].includes(normalizedStatus)
            ? new Date()
            : undefined,
      };

      await updateFlexible(
        db,
        "tid_verifications",
        values,
        "id = ?",
        [verification.id],
      );

      return res.json({ success: true, received: true });
    } catch (error) {
      console.error("TID Veriff webhook error:", error);
      return jsonError(res, 500, "Unable to process verification webhook");
    }
  },
);

router.get("/verify-identity/status", authenticateTid, async (req, res) => {
  try {
    const verification = await fetchLatestVerification(req.tidUser.tidUserId);
    return res.json({
      success: true,
      status:
        verification?.status ||
        verification?.verification_status ||
        "NOT_STARTED",
      verification: verification || null,
    });
  } catch (error) {
    console.error("TID verification status error:", error);
    return jsonError(res, 500, "Unable to load verification status");
  }
});

// ---------- CARDS / RAZORPAY ----------

function getRazorpayClient() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return null;
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

router.post("/cards/order", authenticateTid, requireJsonBody, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const currency = cleanString(req.body?.currency || "INR", 8).toUpperCase();

    if (!Number.isInteger(amount) || amount <= 0) {
      return jsonError(res, 400, "A valid card amount in minor currency units is required");
    }

    const razorpay = getRazorpayClient();
    if (!razorpay) {
      return jsonError(res, 503, "Razorpay is not configured");
    }

    const receipt =
      "TIDCARD-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt,
      notes: {
        tid: req.tidUser.tid,
        tid_user_id: String(req.tidUser.tidUserId),
      },
    });

    await insertFlexible(db, "tid_card_orders", {
      tid_user_id: req.tidUser.tidUserId,
      user_id: req.tidUser.tidUserId,
      tid: req.tidUser.tid,
      razorpay_order_id: order.id,
      payment_order_id: order.id,
      order_id: order.id,
      receipt,
      amount,
      amount_minor: amount,
      currency,
      status: "CREATED",
      payment_status: "PENDING",
      created_at: new Date(),
      updated_at: new Date(),
    });

    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "CARD_ORDER");

    return res.status(201).json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
      },
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("TID card order error:", error);
    return jsonError(res, 500, "Unable to create card order");
  }
});

router.get("/cards/orders", authenticateTid, async (req, res) => {
  try {
    const columns = await getColumns("tid_card_orders");
    const userColumn = pickExisting(columns, ["tid_user_id", "user_id"]);
    if (!userColumn) return jsonError(res, 500, "Card order user column is missing");

    const [orders] = await db.execute(
      "SELECT * FROM tid_card_orders WHERE " +
        mysql.escapeId(userColumn) +
        " = ? ORDER BY id DESC",
      [req.tidUser.tidUserId],
    );

    return res.json({ success: true, orders });
  } catch (error) {
    console.error("TID card orders error:", error);
    return jsonError(res, 500, "Unable to load card orders");
  }
});

router.post(
  "/cards/webhook",
  webhookRateLimiter,
  async (req, res) => {
    try {
      const signature = req.get("x-razorpay-signature") || "";
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

      if (secret) {
        const expected = crypto
          .createHmac("sha256", secret)
          .update(JSON.stringify(req.body || {}))
          .digest("hex");
        if (
          !signature ||
          signature.length !== expected.length ||
          !crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expected),
          )
        ) {
          return jsonError(res, 401, "Invalid Razorpay webhook signature");
        }
      }

      const payload = req.body || {};
      const event = String(payload.event || "").toLowerCase();
      const payment = payload.payload?.payment?.entity || {};
      const orderId =
        payment.order_id ||
        payload.payload?.order?.entity?.id ||
        payload.order_id ||
        null;

      if (!orderId) return jsonError(res, 400, "Missing Razorpay order ID");

      const status =
        event.includes("captured") ||
        event.includes("paid") ||
        event.includes("authorized")
          ? "PAID"
          : event.includes("failed")
            ? "FAILED"
            : "RECEIVED";

      const columns = await getColumns("tid_card_orders");
      const orderColumn = pickExisting(columns, [
        "razorpay_order_id",
        "payment_order_id",
        "order_id",
      ]);
      if (!orderColumn) return jsonError(res, 500, "Card order payment column is missing");

      const [rows] = await db.execute(
        "SELECT * FROM tid_card_orders WHERE " +
          mysql.escapeId(orderColumn) +
          " = ? LIMIT 1",
        [orderId],
      );
      if (!rows.length) return jsonError(res, 404, "Card order not found");
      const values = {
        status,
        payment_status: status,
        razorpay_payment_id: payment.id || undefined,
        payment_id: payment.id || undefined,
        webhook_payload: JSON.stringify(payload),
        raw_webhook: JSON.stringify(payload),
        paid_at: status === "PAID" ? new Date() : undefined,
        updated_at: new Date(),
      };

      await updateFlexible(
        db,
        "tid_card_orders",
        values,
        "id = ?",
        [rows[0].id],
      );

      return res.json({ success: true, received: true });
    } catch (error) {
      console.error("TID Razorpay webhook error:", error);
      return jsonError(res, 500, "Unable to process payment webhook");
    }
  },
);

// ============ ACCOUNTS ============

router.post("/accounts", authenticateTid, requireJsonBody, async (req, res) => {
  try {
    const category = String(req.body?.account_category || "PROP_FIRM").toUpperCase();
    if (!["PROP_FIRM", "BROKER"].includes(category)) {
      return jsonError(res, 400, "Invalid account category");
    }

    const intentRaw = String(req.body?.score_impact_intent || "NO").toUpperCase();
    const intent = intentRaw === "YES" ? "YES" : "NO";

    const sizeCents = Math.max(0, Number(req.body?.account_size_cents) || 0);
    const startDate = req.body?.start_date ? String(req.body.start_date).slice(0, 10) : null;

    let firm = null;
    let type = null;
    let brokerName = null;
    let brokerAccountId = null;
    let brokerMode = null;
    let depositCents = 0;
    let withdrawalCents = 0;

    if (category === "PROP_FIRM") {
      firm = cleanString(req.body?.firm_name, 100);
      if (!firm || firm.length < 2) return jsonError(res, 400, "Firm name is required");
      type = String(req.body?.account_type || "CHALLENGE").toUpperCase();
      if (!["CHALLENGE", "FUNDED", "LIVE"].includes(type)) {
        return jsonError(res, 400, "Invalid account type");
      }
    } else {
      brokerName = cleanString(req.body?.broker_name, 100);
      if (!brokerName || brokerName.length < 2) return jsonError(res, 400, "Broker name is required");
      brokerAccountId = cleanString(req.body?.broker_account_id, 100);
      if (!brokerAccountId) return jsonError(res, 400, "Broker account ID is required");
      brokerMode = String(req.body?.broker_account_mode || "").toUpperCase();
      if (!["DEMO", "REAL"].includes(brokerMode)) {
        return jsonError(res, 400, "Broker account mode must be DEMO or REAL");
      }
      depositCents = Math.max(0, Math.round(Number(req.body?.total_deposit_cents) || 0));
      withdrawalCents = Math.max(0, Math.round(Number(req.body?.total_withdrawal_cents) || 0));
    }

    const vStatus = (intent === "YES") ? "AWAITING_PAYMENT" : "NONE";
    const [result] = await db.execute(
      "INSERT INTO tid_accounts (tid_user_id, firm_name, account_size_cents, account_type, status, verification_status, start_date, account_category, score_impact_intent, broker_name, broker_account_id, broker_account_mode, total_deposit_cents, total_withdrawal_cents) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [req.tidUser.tidUserId, firm, sizeCents, type, vStatus, startDate, category, intent, brokerName, brokerAccountId, brokerMode, depositCents, withdrawalCents],
    );

    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "ACCOUNT_CREATE");

    return res.json({
      success: true,
      account: {
        id: result.insertId,
        account_category: category,
        firm_name: firm,
        account_size_cents: sizeCents,
        account_type: type,
        broker_name: brokerName,
        broker_account_id: brokerAccountId,
        broker_account_mode: brokerMode,
        total_deposit_cents: depositCents,
        total_withdrawal_cents: withdrawalCents,
        score_impact_intent: intent,
        status: "PENDING",
        verification_status: "NONE",
        start_date: startDate,
      },
    });
  } catch (error) {
    console.error("TID account create error:", error);
    return jsonError(res, 500, "Unable to create account");
  }
});

async function recomputeAccountAggregates(accountId, tidUserId) {
  try {
    const [rows] = await db.execute(
      "SELECT COALESCE(SUM(pips),0) AS total_pips, COALESCE(SUM(CASE WHEN pips>0 THEN pips ELSE 0 END),0) AS pips_won, COALESCE(SUM(CASE WHEN pips<0 THEN -pips ELSE 0 END),0) AS pips_lost, COUNT(*) AS cnt, SUM(CASE WHEN profit_cents>0 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN profit_cents<0 THEN 1 ELSE 0 END) AS losses, COALESCE(SUM(profit_cents),0) AS total_profit_cents, COALESCE(MAX(CASE WHEN profit_cents>0 THEN profit_cents ELSE 0 END),0) AS big_win, COALESCE(MAX(CASE WHEN profit_cents<0 THEN -profit_cents ELSE 0 END),0) AS big_loss, COALESCE(AVG(CASE WHEN pips>0 THEN pips ELSE NULL END),0) AS avg_win_pips, COALESCE(AVG(CASE WHEN pips<0 THEN -pips ELSE NULL END),0) AS avg_loss_pips, COALESCE(MAX(pips),0) AS best_trade_pips, COALESCE(MIN(pips),0) AS worst_trade_pips, COALESCE(STDDEV(pips),0) AS stddev_pips, COALESCE(AVG(ABS(pips)),0) AS avg_abs_pips, MIN(COALESCE(closed_at, opened_at, created_at)) AS first_trade_at, MAX(COALESCE(closed_at, opened_at, created_at)) AS last_trade_at FROM tid_trades WHERE account_id = ? AND tid_user_id = ? AND status='CLOSED'",
      [accountId, tidUserId],
    );
    const r = rows[0] || {};
    const totalTrades = Number(r.cnt) || 0;
    const wins = Number(r.wins) || 0;
    const losses = Number(r.losses) || 0;
    const winRateBps = totalTrades > 0 ? Math.round((wins / totalTrades) * 10000) : 0;
    const totalPips = Number(r.total_pips) || 0;
    const pipsWon = Number(r.pips_won) || 0;
    const pipsLost = Number(r.pips_lost) || 0;
    const avgRr = pipsLost > 0 ? Number((pipsWon / pipsLost).toFixed(3)) : 0;
    const bigWin = Number(r.big_win) || 0;
    const bigLoss = Number(r.big_loss) || 0;
    const totalProfitCents = Number(r.total_profit_cents) || 0;
    const avgWinPips = Number(r.avg_win_pips) || 0;
    const avgLossPips = Number(r.avg_loss_pips) || 0;
    const bestTradePips = Number(r.best_trade_pips) || 0;
    const worstTradePips = Number(r.worst_trade_pips) || 0;
    const stddevPips = Number(r.stddev_pips) || 0;
    const avgAbsPips = Number(r.avg_abs_pips) || 0;
    const firstTradeAt = r.first_trade_at || null;
    const lastTradeAt = r.last_trade_at || null;
    const consistencyScore = avgAbsPips > 0 ? Math.max(0, Math.min(100, Math.round(100 - (stddevPips / avgAbsPips) * 50))) : 0;
    const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const rrRatio = avgLossPips > 0 ? avgWinPips / avgLossPips : 0;
    const winRateComponent = Math.min(winRatePct, 70) * 25 / 70;
    const rrComponent = Math.min(rrRatio, 3) * 25 / 3;
    const consistencyComponent = consistencyScore * 0.2;
    const ddComponent = pipsWon > 0 ? Math.max(0, Math.min(15, (1 - Math.abs(worstTradePips) / pipsWon) * 15)) : 0;
    const daysActive = firstTradeAt ? Math.floor((Date.now() - new Date(firstTradeAt).getTime()) / 86400000) : 0;
    const tenureComponent = Math.min(daysActive / 90, 1) * 15;
    const accountScore = Math.max(0, Math.min(100, Math.round(winRateComponent + rrComponent + consistencyComponent + ddComponent + tenureComponent)));

    const [acct] = await db.execute(
      "SELECT account_size_cents FROM tid_accounts WHERE id = ? LIMIT 1",
      [accountId],
    );
    const sizeCents = Number(acct[0]?.account_size_cents) || 0;
    const profitBps = sizeCents > 0 ? Math.round((totalProfitCents / sizeCents) * 10000) : 0;

    await db.execute(
      "UPDATE tid_accounts SET total_trades = ?, total_wins = ?, total_losses = ?, win_rate_bps = ?, biggest_win_cents = ?, biggest_loss_cents = ?, total_pips = ?, total_pips_won = ?, total_pips_lost = ?, avg_rr = ?, profit_bps = ?, avg_win_pips = ?, avg_loss_pips = ?, best_trade_pips = ?, worst_trade_pips = ?, consistency_score = ?, account_score = ?, first_trade_at = ?, last_trade_at = ?, sum_win_pips = ?, sum_loss_pips = ?, sum_pips_squared = ?, last_aggregated_trade_id = (SELECT COALESCE(MAX(id),0) FROM tid_trades WHERE account_id = ? AND status='CLOSED'), last_updated_at = NOW(), updated_at = NOW() WHERE id = ? LIMIT 1",
      [totalTrades, wins, losses, winRateBps, bigWin, bigLoss, totalPips, pipsWon, pipsLost, avgRr, profitBps, avgWinPips, avgLossPips, bestTradePips, worstTradePips, consistencyScore, accountScore, firstTradeAt, lastTradeAt, pipsWon, pipsLost, (pipsWon + pipsLost) > 0 ? 0 : 0, accountId, accountId],
    );
  } catch (err) {
    console.error("recomputeAccountAggregates error:", err);
  }
}

async function applyTradeDelta(accountId, tidUserId) {
  try {
    const [accRows] = await db.execute(
      "SELECT last_aggregated_trade_id, total_trades, total_wins, total_losses, total_pips, sum_win_pips, sum_loss_pips, sum_pips_squared, biggest_win_cents, biggest_loss_cents, account_size_cents FROM tid_accounts WHERE id = ? LIMIT 1",
      [accountId],
    );
    if (!accRows.length) return;
    const acc = accRows[0];
    const watermark = Number(acc.last_aggregated_trade_id) || 0;

    const [newTrades] = await db.execute(
      "SELECT id, pips, profit_cents, closed_at, opened_at, created_at FROM tid_trades WHERE account_id = ? AND id > ? AND status='CLOSED' ORDER BY id ASC",
      [accountId, watermark],
    );
    if (!newTrades.length) return;

    let dPips = 0, dPipsSq = 0, dWinPips = 0, dLossPips = 0;
    let dWins = 0, dLosses = 0, dBigWin = 0, dBigLoss = 0;
    let newFirst = null, newLast = null;
    let maxTradeId = watermark;

    for (let i = 0; i < newTrades.length; i++) {
      const t = newTrades[i];
      const pips = Number(t.pips) || 0;
      const profit = Number(t.profit_cents) || 0;
      dPips += pips;
      dPipsSq += pips * pips;
      if (profit > 0) dWins++;
      else if (profit < 0) dLosses++;
      if (pips > 0) dWinPips += pips;
      if (pips < 0) dLossPips += -pips;
      if (profit > dBigWin) dBigWin = profit;
      if (-profit > dBigLoss) dBigLoss = -profit;
      const dt = t.closed_at || t.opened_at || t.created_at;
      if (dt) {
        if (!newFirst || dt < newFirst) newFirst = dt;
        if (!newLast || dt > newLast) newLast = dt;
      }
      if (Number(t.id) > maxTradeId) maxTradeId = Number(t.id);
    }

    const totalTrades = Number(acc.total_trades) + dWins + dLosses;
    const totalWins = Number(acc.total_wins) + dWins;
    const totalLosses = Number(acc.total_losses) + dLosses;
    const totalPips = Number(acc.total_pips) + dPips;
    const sumWin = Number(acc.sum_win_pips) + dWinPips;
    const sumLoss = Number(acc.sum_loss_pips) + dLossPips;
    const sumSq = Number(acc.sum_pips_squared) + dPipsSq;
    const bigWin = Math.max(Number(acc.biggest_win_cents) || 0, dBigWin);
    const bigLoss = Math.max(Number(acc.biggest_loss_cents) || 0, dBigLoss);

    const winRateBps = totalTrades > 0 ? Math.round((totalWins / totalTrades) * 10000) : 0;
    const avgWinPips = totalWins > 0 ? sumWin / totalWins : 0;
    const avgLossPips = totalLosses > 0 ? sumLoss / totalLosses : 0;
    const avgRr = avgLossPips > 0 ? Number((avgWinPips / avgLossPips).toFixed(3)) : 0;
    const mean = totalTrades > 0 ? totalPips / totalTrades : 0;
    const variance = totalTrades > 0 ? Math.max(0, (sumSq / totalTrades) - (mean * mean)) : 0;
    const stddev = Math.sqrt(variance);
    const avgAbs = totalTrades > 0 ? (sumWin + sumLoss) / totalTrades : 0;
    const consistencyScore = avgAbs > 0 ? Math.max(0, Math.min(100, Math.round(100 - (stddev / avgAbs) * 50))) : 0;
    const winRatePct = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const rrRatio = avgLossPips > 0 ? avgWinPips / avgLossPips : 0;
    const winRateComponent = Math.min(winRatePct, 70) * 25 / 70;
    const rrComponent = Math.min(rrRatio, 3) * 25 / 3;
    const consistencyComponent = consistencyScore * 0.2;
    const ddComponent = sumWin > 0 ? Math.max(0, Math.min(15, (1 - Math.abs(avgLossPips) / sumWin) * 15)) : 0;
    const firstForTenure = newFirst || null;
    const daysActive = firstForTenure ? Math.floor((Date.now() - new Date(firstForTenure).getTime()) / 86400000) : 0;
    const tenureComponent = Math.min(daysActive / 90, 1) * 15;
    const accountScore = Math.max(0, Math.min(100, Math.round(winRateComponent + rrComponent + consistencyComponent + ddComponent + tenureComponent)));

    await db.execute(
      "UPDATE tid_accounts SET total_trades = ?, total_wins = ?, total_losses = ?, win_rate_bps = ?, total_pips = ?, sum_win_pips = ?, sum_loss_pips = ?, sum_pips_squared = ?, avg_rr = ?, avg_win_pips = ?, avg_loss_pips = ?, consistency_score = ?, account_score = ?, biggest_win_cents = ?, biggest_loss_cents = ?, first_trade_at = COALESCE(first_trade_at, ?), last_trade_at = ?, last_aggregated_trade_id = ?, last_updated_at = NOW(), updated_at = NOW() WHERE id = ? LIMIT 1",
      [totalTrades, totalWins, totalLosses, winRateBps, totalPips, sumWin, sumLoss, sumSq, avgRr, avgWinPips, avgLossPips, consistencyScore, accountScore, bigWin, bigLoss, newFirst, newLast, maxTradeId, accountId],
    );

    await rebuildAccountSnapshots(accountId, tidUserId);
  } catch (err) {
    console.error("applyTradeDelta error:", err);
  }
}

async function rebuildAccountSnapshots(accountId, tidUserId) {
  try {
    await db.execute("DELETE FROM tid_daily_passbook WHERE account_id = ?", [accountId]);
    await db.execute(
      "INSERT INTO tid_daily_passbook (account_id, tid_user_id, snapshot_date, cumulative_pips, cumulative_profit_cents, total_trades, avg_pips_per_trade, avg_profit_per_trade_cents) SELECT account_id, tid_user_id, snapshot_date, cum_pips, cum_profit, cum_trades, ROUND(cum_pips / cum_trades, 4), ROUND(cum_profit / cum_trades) FROM (SELECT account_id, tid_user_id, snapshot_date, SUM(day_pips) OVER (PARTITION BY account_id ORDER BY snapshot_date) AS cum_pips, SUM(day_profit) OVER (PARTITION BY account_id ORDER BY snapshot_date) AS cum_profit, SUM(day_trades) OVER (PARTITION BY account_id ORDER BY snapshot_date) AS cum_trades FROM (SELECT t.account_id, a.tid_user_id, DATE(COALESCE(t.closed_at, t.opened_at, t.created_at)) AS snapshot_date, SUM(t.pips) AS day_pips, SUM(t.profit_cents) AS day_profit, COUNT(*) AS day_trades FROM tid_trades t JOIN tid_accounts a ON a.id = t.account_id WHERE t.status = 'CLOSED' AND t.account_id = ? AND COALESCE(t.closed_at, t.opened_at, t.created_at) IS NOT NULL GROUP BY t.account_id, a.tid_user_id, DATE(COALESCE(t.closed_at, t.opened_at, t.created_at))) daily) cumul WHERE cum_trades > 0",
      [accountId],
    );
  } catch (err) {
    console.error("rebuildAccountSnapshots error:", err);
  }
}

router.post("/accounts/:id/trades", authenticateTid, requireJsonBody, async (req, res) => {
  return jsonError(res, 403, "Manual trade entry is disabled. Please upload a statement and request verification.");
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [acc] = await db.execute(
      "SELECT id FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!acc.length) return jsonError(res, 404, "Account not found");

    const symbol = cleanString(req.body?.symbol, 30).toUpperCase();
    if (!symbol) return jsonError(res, 400, "Symbol is required");

    const direction = String(req.body?.direction || "").toUpperCase();
    if (!["BUY","SELL"].includes(direction)) return jsonError(res, 400, "Direction must be BUY or SELL");

    const entryPrice = req.body?.entry_price != null ? Number(req.body.entry_price) : null;
    const exitPrice = req.body?.exit_price != null ? Number(req.body.exit_price) : null;
    const lotSize = req.body?.lot_size != null ? Number(req.body.lot_size) : null;
    const pips = req.body?.pips != null ? Number(req.body.pips) : null;
    const profitCents = Math.round(Number(req.body?.profit_cents) || 0);

    const status = String(req.body?.status || "CLOSED").toUpperCase();
    if (!["OPEN","CLOSED"].includes(status)) return jsonError(res, 400, "Invalid status");

    const openedAt = req.body?.opened_at ? new Date(req.body.opened_at) : null;
    const closedAt = req.body?.closed_at ? new Date(req.body.closed_at) : null;
    const notes = cleanString(req.body?.notes, 1000) || null;
    const screenshotUrl = cleanString(req.body?.screenshot_url, 500) || null;

    const [result] = await db.execute(
      "INSERT INTO tid_trades (tid_user_id, account_id, symbol, direction, entry_price, exit_price, lot_size, pips, profit_cents, status, opened_at, closed_at, notes, screenshot_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [req.tidUser.tidUserId, id, symbol, direction, entryPrice, exitPrice, lotSize, pips, profitCents, status, openedAt, closedAt, notes, screenshotUrl],
    );

    await recomputeAccountAggregates(id, req.tidUser.tidUserId);
    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "TRADE_CREATE");

    return res.status(201).json({
      success: true,
      trade: {
        id: result.insertId,
        account_id: id,
        symbol,
        direction,
        entry_price: entryPrice,
        exit_price: exitPrice,
        lot_size: lotSize,
        pips,
        profit_cents: profitCents,
        status,
        opened_at: openedAt,
        closed_at: closedAt,
        notes,
        screenshot_url: screenshotUrl,
      },
    });
  } catch (error) {
    console.error("TID trade create error:", error);
    return jsonError(res, 500, "Unable to create trade");
  }
});

router.get("/accounts/:id/trades", authenticateTid, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [acc] = await db.execute(
      "SELECT id FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!acc.length) return jsonError(res, 404, "Account not found");

    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;

    let sql = "SELECT id, account_id, symbol, direction, entry_price, exit_price, lot_size, pips, profit_cents, status, opened_at, closed_at, notes, screenshot_url, created_at FROM tid_trades WHERE account_id = ? AND tid_user_id = ?";
    const params = [id, req.tidUser.tidUserId];
    if (status && ["OPEN","CLOSED"].includes(status)) {
      sql += " AND status = ?";
      params.push(status);
    }
    sql += " ORDER BY COALESCE(closed_at, opened_at, created_at) DESC LIMIT ?";

    const [rows] = await db.execute(sql, [...params, limit]);
    return res.json({ success: true, trades: rows });
  } catch (error) {
    console.error("TID trade list error:", error);
    return jsonError(res, 500, "Unable to load trades");
  }
});

router.delete("/accounts/:id/trades/:tradeId", authenticateTid, async (req, res) => {
  return jsonError(res, 403, "Trade deletion is disabled. Verified trades are immutable.");
  try {
    const id = Number(req.params.id);
    const tradeId = Number(req.params.tradeId);
    if (!Number.isFinite(id) || !Number.isFinite(tradeId)) {
      return jsonError(res, 400, "Invalid id");
    }

    const [r] = await db.execute(
      "DELETE FROM tid_trades WHERE id = ? AND account_id = ? AND tid_user_id = ? LIMIT 1",
      [tradeId, id, req.tidUser.tidUserId],
    );
    if (!r.affectedRows) return jsonError(res, 404, "Trade not found");

    await recomputeAccountAggregates(id, req.tidUser.tidUserId);
    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "TRADE_DELETE");

    return res.json({ success: true, deleted: tradeId });
  } catch (error) {
    console.error("TID trade delete error:", error);
    return jsonError(res, 500, "Unable to delete trade");
  }
});

router.post("/accounts/:id/trades/bulk", authenticateTid, requireJsonBody, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [acc] = await db.execute(
      "SELECT id FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!acc.length) return jsonError(res, 404, "Account not found");

    const trades = Array.isArray(req.body?.trades) ? req.body.trades : [];
    if (!trades.length) return jsonError(res, 400, "No trades provided");
    if (trades.length > 500) return jsonError(res, 400, "Maximum 500 trades per import");

    const inserted = [];
    const errors = [];

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i] || {};
      try {
        const symbol = cleanString(t.symbol, 30).toUpperCase();
        if (!symbol) { errors.push({ row: i + 1, error: "Missing symbol" }); continue; }

        const direction = String(t.direction || "").toUpperCase();
        if (!["BUY","SELL"].includes(direction)) {
          errors.push({ row: i + 1, error: "Invalid direction" });
          continue;
        }

        const entryPrice = t.entry_price != null ? Number(t.entry_price) : null;
        const exitPrice = t.exit_price != null ? Number(t.exit_price) : null;
        const lotSize = t.lot_size != null ? Number(t.lot_size) : null;
        const pips = t.pips != null ? Number(t.pips) : null;
        const profitCents = Math.round(Number(t.profit_cents) || 0);
        const status = String(t.status || "CLOSED").toUpperCase();
        if (!["OPEN","CLOSED"].includes(status)) {
          errors.push({ row: i + 1, error: "Invalid status" });
          continue;
        }

        const openedAt = t.opened_at ? new Date(t.opened_at) : null;
        const closedAt = t.closed_at ? new Date(t.closed_at) : null;
        const notes = cleanString(t.notes, 1000) || null;
        const screenshotUrl = cleanString(t.screenshot_url, 500) || null;

        const [result] = await db.execute(
          "INSERT INTO tid_trades (tid_user_id, account_id, symbol, direction, entry_price, exit_price, lot_size, pips, profit_cents, status, opened_at, closed_at, notes, screenshot_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [req.tidUser.tidUserId, id, symbol, direction, entryPrice, exitPrice, lotSize, pips, profitCents, status, openedAt, closedAt, notes, screenshotUrl],
        );
        inserted.push(result.insertId);
      } catch (rowErr) {
        errors.push({ row: i + 1, error: rowErr.message });
      }
    }

    if (inserted.length > 0) {
      await applyTradeDelta(id, req.tidUser.tidUserId);
      await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "TRADE_BULK_IMPORT");
    }

    return res.json({
      success: true,
      inserted_count: inserted.length,
      error_count: errors.length,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    console.error("TID trade bulk error:", error);
    return jsonError(res, 500, "Unable to import trades");
  }
});

router.get("/me/snapshots", authenticateTid, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT account_id, snapshot_date, cumulative_pips, cumulative_profit_cents, total_trades, avg_pips_per_trade, avg_profit_per_trade_cents FROM tid_daily_passbook WHERE tid_user_id = ? ORDER BY snapshot_date ASC, account_id ASC LIMIT 5000",
      [req.tidUser.tidUserId],
    );
    return res.json({ success: true, snapshots: rows });
  } catch (error) {
    console.error("TID snapshots error:", error);
    return res.json({ success: true, snapshots: [] });
  }
});

router.get("/me/trades-timeline", authenticateTid, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT t.id, t.account_id, t.symbol, t.direction, t.pips, t.profit_cents, t.closed_at, t.opened_at FROM tid_trades t INNER JOIN tid_accounts a ON a.id = t.account_id WHERE a.tid_user_id = ? AND t.status = 'CLOSED' ORDER BY COALESCE(t.closed_at, t.opened_at, t.created_at) ASC LIMIT 1000",
      [req.tidUser.tidUserId],
    );
    return res.json({ success: true, trades: rows });
  } catch (error) {
    console.error("TID trades-timeline error:", error);
    return res.json({ success: true, trades: [] });
  }
});

router.post("/accounts/:id/transactions", authenticateTid, requireJsonBody, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [acc] = await db.execute(
      "SELECT id FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!acc.length) return jsonError(res, 404, "Account not found");

    const txType = String(req.body?.tx_type || "").toUpperCase();
    if (!["DEPOSIT", "WITHDRAWAL", "PROFIT_ADJUSTMENT"].includes(txType)) {
      return jsonError(res, 400, "Invalid tx_type");
    }

    const amountCents = Math.max(0, Math.round(Number(req.body?.amount_cents) || 0));
    if (amountCents <= 0) return jsonError(res, 400, "Amount must be positive");

    const txDate = req.body?.tx_date ? new Date(req.body.tx_date) : new Date();
    if (isNaN(txDate.getTime())) return jsonError(res, 400, "Invalid tx_date");

    const notes = cleanString(req.body?.notes, 255) || null;

    const [result] = await db.execute(
      "INSERT INTO tid_account_transactions (account_id, tid_user_id, tx_type, amount_cents, tx_date, notes) VALUES (?, ?, ?, ?, ?, ?)",
      [id, req.tidUser.tidUserId, txType, amountCents, txDate, notes],
    );

    await db.execute(
      "UPDATE tid_accounts SET total_deposit_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM tid_account_transactions WHERE account_id = ? AND tx_type = 'DEPOSIT'), total_withdrawal_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM tid_account_transactions WHERE account_id = ? AND tx_type = 'WITHDRAWAL'), updated_at = NOW() WHERE id = ? LIMIT 1",
      [id, id, id],
    );

    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "TRANSACTION_CREATE");

    return res.status(201).json({
      success: true,
      transaction: {
        id: result.insertId,
        account_id: id,
        tx_type: txType,
        amount_cents: amountCents,
        tx_date: txDate,
        notes,
      },
    });
  } catch (error) {
    console.error("TID transaction create error:", error);
    return jsonError(res, 500, "Unable to create transaction");
  }
});

router.get("/firms", authenticateTid, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, firm_name, broker_name, account_category, account_type, account_score, total_trades, total_wins, total_losses, total_pips, win_rate_bps, verification_status, account_size_cents, broker_account_id, broker_account_mode, total_deposit_cents, total_withdrawal_cents, created_at FROM tid_accounts WHERE tid_user_id = ? ORDER BY created_at DESC LIMIT 100",
      [req.tidUser.tidUserId],
    );
    return res.json({ success: true, count: rows.length, rows: rows });
  } catch (error) {
    console.error("TID firms error:", error);
    return jsonError(res, 500, "Unable to load firms");
  }
});

router.get("/accounts", authenticateTid, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, firm_name, account_size_cents, account_type, status, verification_status, verification_paid, start_date, end_date, total_trades, total_wins, total_losses, win_rate_bps, profit_bps, biggest_win_cents, biggest_loss_cents, account_category, score_impact_intent, broker_name, broker_account_id, broker_account_mode, total_deposit_cents, total_withdrawal_cents, payment_request_no, transaction_id, account_score, total_pips, total_pips_won, total_pips_lost, avg_win_pips, avg_loss_pips, best_trade_pips, worst_trade_pips, consistency_score, first_trade_at, last_trade_at, created_at, updated_at FROM tid_accounts WHERE tid_user_id = ? ORDER BY created_at DESC LIMIT 100",
      [req.tidUser.tidUserId],
    );
    return res.json({ success: true, accounts: rows });
  } catch (error) {
    console.error("TID accounts list error:", error);
    return jsonError(res, 500, "Unable to load accounts");
  }
});

router.get("/accounts/:id", authenticateTid, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [rows] = await db.execute(
      "SELECT * FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!rows.length) return jsonError(res, 404, "Account not found");

    return res.json({ success: true, account: rows[0] });
  } catch (error) {
    console.error("TID account fetch error:", error);
    return jsonError(res, 500, "Unable to load account");
  }
});

router.patch("/accounts/:id", authenticateTid, requireJsonBody, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [rows] = await db.execute(
      "SELECT id FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!rows.length) return jsonError(res, 404, "Account not found");

    const fields = [];
    const values = [];

    if (req.body?.firm_name !== undefined) {
      const f = cleanString(req.body.firm_name, 100);
      if (f.length < 2) return jsonError(res, 400, "Firm name too short");
      fields.push("firm_name = ?");
      values.push(f);
    }
    if (req.body?.account_size_cents !== undefined) {
      fields.push("account_size_cents = ?");
      values.push(Math.max(0, Number(req.body.account_size_cents) || 0));
    }
    if (req.body?.account_type !== undefined) {
      const t = String(req.body.account_type).toUpperCase();
      if (!["CHALLENGE", "FUNDED", "LIVE"].includes(t)) return jsonError(res, 400, "Invalid account type");
      fields.push("account_type = ?");
      values.push(t);
    }
    if (req.body?.start_date !== undefined) {
      fields.push("start_date = ?");
      values.push(req.body.start_date ? String(req.body.start_date).slice(0, 10) : null);
    }
    if (req.body?.status !== undefined) {
      const s = String(req.body.status).toUpperCase();
      if (!["PENDING", "ACTIVE", "PASSED", "FAILED", "BREACHED", "CLOSED"].includes(s)) {
        return jsonError(res, 400, "Invalid status");
      }
      fields.push("status = ?");
      values.push(s);
    }
    if (req.body?.total_trades !== undefined) {
      fields.push("total_trades = ?");
      values.push(Math.max(0, Number(req.body.total_trades) || 0));
    }
    if (req.body?.total_wins !== undefined) {
      fields.push("total_wins = ?");
      values.push(Math.max(0, Number(req.body.total_wins) || 0));
    }
    if (req.body?.total_losses !== undefined) {
      fields.push("total_losses = ?");
      values.push(Math.max(0, Number(req.body.total_losses) || 0));
    }
    if (req.body?.win_rate_bps !== undefined) {
      fields.push("win_rate_bps = ?");
      values.push(Math.max(0, Number(req.body.win_rate_bps) || 0));
    }
    if (req.body?.profit_bps !== undefined) {
      fields.push("profit_bps = ?");
      values.push(Number(req.body.profit_bps) || 0);
    }
    if (req.body?.biggest_win_cents !== undefined) {
      fields.push("biggest_win_cents = ?");
      values.push(Math.max(0, Number(req.body.biggest_win_cents) || 0));
    }
    if (req.body?.biggest_loss_cents !== undefined) {
      fields.push("biggest_loss_cents = ?");
      values.push(Math.max(0, Number(req.body.biggest_loss_cents) || 0));
    }

    if (!fields.length) return jsonError(res, 400, "No fields to update");

    values.push(id, req.tidUser.tidUserId);
    await db.execute(
      "UPDATE tid_accounts SET " + fields.join(", ") + " WHERE id = ? AND tid_user_id = ? LIMIT 1",
      values,
    );

    return res.json({ success: true, updated: id });
  } catch (error) {
    console.error("TID account update error:", error);
    return jsonError(res, 500, "Unable to update account");
  }
});

router.post("/accounts/:id/request-payment", authenticateTid, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [rows] = await db.execute(
      "SELECT a.id, a.verification_status, a.score_impact_intent, a.account_category, a.firm_name, a.broker_name, a.broker_account_id, a.broker_account_mode, a.account_size_cents, a.total_deposit_cents, a.verification_fee_cents, a.payment_request_no, a.transaction_id, u.tid, u.email, u.legal_name FROM tid_accounts a LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE a.id = ? AND a.tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!rows.length) return jsonError(res, 404, "Account not found");

    const acc = rows[0];
    const curStatus = String(acc.verification_status || "").toUpperCase();
    if (curStatus !== "AWAITING_PAYMENT") {
      return jsonError(res, 400, "This account is not awaiting payment request");
    }
    if (String(acc.score_impact_intent || "").toUpperCase() !== "YES") {
      return jsonError(res, 400, "This account is set as tracking-only");
    }

    let requestNo = acc.payment_request_no;
    if (!requestNo) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generatePaymentRequestNo();
        const [dupe] = await db.execute(
          "SELECT id FROM tid_accounts WHERE payment_request_no = ? LIMIT 1",
          [candidate],
        );
        if (!dupe.length) { requestNo = candidate; break; }
      }
      if (!requestNo) return jsonError(res, 500, "Could not allocate request number");
    }

    await db.execute(
      "UPDATE tid_accounts SET verification_status = 'PAID_REQUESTED', payment_request_no = ?, verification_fee_cents = COALESCE(NULLIF(verification_fee_cents,0), 200), updated_at = NOW() WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [requestNo, id, req.tidUser.tidUserId],
    );

    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "ACCOUNT_PAYMENT_REQUEST");

    res.json({ success: true, status: "PAID_REQUESTED", payment_request_no: requestNo });

    setImmediate(async () => {
      try {
        const feeCents = Number(acc.verification_fee_cents) || 200;
        const feeStr = "$" + (feeCents / 100).toFixed(0);
        const accLabel = String(acc.account_category || "").toUpperCase() === "BROKER"
          ? (acc.broker_name || "Broker") + " · " + (String(acc.broker_account_mode || "").toUpperCase() === "DEMO" ? "Demo" : "Real") + " · ID: " + (acc.broker_account_id || "—")
          : (acc.firm_name || "Firm") + " · $" + ((Number(acc.account_size_cents) || 0) / 100).toLocaleString("en-US");
        const userName = acc.legal_name || "Trader";
        const userEmail = acc.email || "—";
        const userTid = acc.tid || "—";
        const adminUrl = "https://fundfxt.vercel.app/admin/tid/";
        const safe = (v) => escapeHtml(String(v == null ? "" : v));

        const html =
          '<!doctype html><html lang="en"><head><meta charset="utf-8"></head>' +
          '<body style="margin:0;padding:0;background:#F8F9FB;font-family:Inter,Arial,sans-serif;color:#0F1B2D">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FB;padding:32px 16px"><tr><td align="center">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#FFFFFF;border:1px solid #E8EBF0;border-radius:14px;overflow:hidden">' +
          '<tr><td style="padding:22px 28px;border-bottom:1px solid #E8EBF0">' +
          '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
          '<td style="width:40px;height:40px;background:#0F1B2D;color:#FFFFFF;border-radius:8px;text-align:center;vertical-align:middle;font-weight:800;font-size:13px;letter-spacing:.5px">TID</td>' +
          '<td style="padding-left:12px;font-size:18px;font-weight:700;color:#0F1B2D">Trader ID · Admin</td>' +
          '</tr></table></td></tr>' +
          '<tr><td style="padding:32px 28px 10px">' +
          '<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#B8935A">Payment Request</p>' +
          '<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:#0F1B2D">New verification payment request</h1>' +
          '<p style="margin:0 0 18px;font-size:14.5px;line-height:1.7;color:#64748B">A trader has requested verification payment. Review the details below and send them a payment link from the admin panel.</p>' +
          '</td></tr>' +
          '<tr><td style="padding:0 28px 10px">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FB;border:1px solid #E8EBF0;border-radius:10px">' +
          '<tr><td style="padding:16px 18px;border-bottom:1px solid #E8EBF0;font-size:13px"><span style="color:#64748B">User</span><br><b style="color:#0F1B2D;font-size:14px">' + safe(userName) + '</b></td></tr>' +
          '<tr><td style="padding:16px 18px;border-bottom:1px solid #E8EBF0;font-size:13px"><span style="color:#64748B">Email</span><br><b style="color:#0F1B2D;font-size:14px">' + safe(userEmail) + '</b></td></tr>' +
          '<tr><td style="padding:16px 18px;border-bottom:1px solid #E8EBF0;font-size:13px"><span style="color:#64748B">Trader ID</span><br><b style="color:#0F1B2D;font-size:14px;font-family:Consolas,monospace">' + safe(userTid) + '</b></td></tr>' +
          '<tr><td style="padding:16px 18px;border-bottom:1px solid #E8EBF0;font-size:13px"><span style="color:#64748B">Request ID</span><br><b style="color:#0F1B2D;font-size:14px;font-family:Consolas,monospace">' + safe(requestNo) + '</b></td></tr>' +
          '<tr><td style="padding:16px 18px;border-bottom:1px solid #E8EBF0;font-size:13px"><span style="color:#64748B">Account</span><br><b style="color:#0F1B2D;font-size:14px">' + safe(accLabel) + '</b></td></tr>' +
          '<tr><td style="padding:16px 18px;font-size:13px"><span style="color:#64748B">Verification Fee</span><br><b style="color:#00b56a;font-size:16px">' + safe(feeStr) + '</b></td></tr>' +
          '</table></td></tr>' +
          '<tr><td style="padding:18px 28px 6px">' +
          '<a href="' + adminUrl + '" style="display:inline-block;padding:12px 22px;background:#00b56a;color:#06110d;text-decoration:none;border-radius:9px;font-weight:700;font-size:14px">Open Admin Panel &rarr;</a>' +
          '</td></tr>' +
          '<tr><td style="padding:22px 28px 26px">' +
          '<p style="margin:0;font-size:13px;line-height:1.7;color:#64748B">From the admin panel, open this account under <b>Payment Requests</b>, paste the Razorpay (or UPI) link, and save. You will then receive a ready-to-forward email for the user.</p>' +
          '</td></tr>' +
          '<tr><td style="padding:18px 28px;border-top:1px solid #E8EBF0;background:#F8F9FB">' +
          '<p style="margin:0 0 5px;font-size:12px;color:#64748B">Traders ID · Admin Notifications</p>' +
          '<p style="margin:0;font-size:12px;color:#94A3B8">Automated message · Do not reply</p>' +
          '</td></tr></table></td></tr></table></body></html>';

        await sendEmail("support.fundfxt@gmail.com", "Payment Request · " + requestNo + " · " + userTid, html, 8000);
      } catch (emailErr) {
        console.warn("Admin payment-request email failed:", emailErr.message);
      }
    });
  } catch (error) {
    console.error("TID payment request error:", error);
    return jsonError(res, 500, "Unable to submit payment request");
  }
});

router.delete("/accounts/:id", authenticateTid, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return jsonError(res, 400, "Invalid account id");

    const [rows] = await db.execute(
      "SELECT id, verification_status FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [id, req.tidUser.tidUserId],
    );
    if (!rows.length) return jsonError(res, 404, "Account not found");
    if (rows[0].verification_status === "VERIFIED") {
      return jsonError(res, 403, "Cannot delete a verified account");
    }

    await db.execute("DELETE FROM tid_accounts WHERE id = ? AND tid_user_id = ? LIMIT 1", [
      id,
      req.tidUser.tidUserId,
    ]);
    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "ACCOUNT_DELETE");

    return res.json({ success: true, deleted: id });
  } catch (error) {
    console.error("TID account delete error:", error);
    return jsonError(res, 500, "Unable to delete account");
  }
});


router.get("/:tid", async (req, res) => {
  try {
    const tid = cleanString(req.params.tid, 32).toUpperCase();
    const user = await fetchTidUserByTid(tid);
    if (!user) return jsonError(res, 404, "Trader ID not found");

    const profile = await fetchProfile(user.id);
    const verification = await fetchLatestVerification(user.id);
    await logAccess(req, user.id, tid, "PUBLIC_PROFILE");

    return res.json({
      success: true,
      profile: publicProfile(user, profile, verification),
    });
  } catch (error) {
    console.error("TID public profile error:", error);
    return jsonError(res, 500, "Unable to load public profile");
  }
});

module.exports = router;