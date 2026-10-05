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
    insertFlexible(db, "tid_email_verifications", values),
    new Promise((_, reject) =>
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

    const passRateBps = Number(profile?.pass_rate_bps || 0);
    const passRateStr = passRateBps > 0 ? (Math.floor(passRateBps / 100) + "%") : "0%";
    const trader = {
      tid: user.tid || null,
      name: user.full_name || user.name || profile?.full_name || profile?.display_name || null,
      rank: profile?.current_rank || "ROOKIE",
      trust_score: 0,
      pass_rate: passRateStr,
      payouts: "$0",
      tier: "—",
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

router.get("/me", authenticateTid, async (req, res) => {
  try {
    const user = await fetchTidUserById(req.tidUser.tidUserId);
    if (!user) return jsonError(res, 404, "Trader ID account not found");

    const profile = await fetchProfile(user.id);
    const verification = await fetchLatestVerification(user.id);
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

    profileValues.updated_at = new Date();

    const existing = await fetchProfile(req.tidUser.tidUserId);
    if (existing) {
      await updateFlexible(
        db,
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
    const firm = cleanString(req.body?.firm_name, 100);
    const sizeCents = Math.max(0, Number(req.body?.account_size_cents) || 0);
    const type = String(req.body?.account_type || "CHALLENGE").toUpperCase();
    const startDate = req.body?.start_date ? String(req.body.start_date).slice(0, 10) : null;

    if (!firm || firm.length < 2) return jsonError(res, 400, "Firm name is required");
    if (!["CHALLENGE", "FUNDED", "LIVE"].includes(type)) return jsonError(res, 400, "Invalid account type");

    const [result] = await db.execute(
      "INSERT INTO tid_accounts (tid_user_id, firm_name, account_size_cents, account_type, status, verification_status, start_date) VALUES (?, ?, ?, ?, 'PENDING', 'NONE', ?)",
      [req.tidUser.tidUserId, firm, sizeCents, type, startDate],
    );

    await logAccess(req, req.tidUser.tidUserId, req.tidUser.tid, "ACCOUNT_CREATE");

    return res.json({
      success: true,
      account: {
        id: result.insertId,
        firm_name: firm,
        account_size_cents: sizeCents,
        account_type: type,
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

router.get("/accounts", authenticateTid, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, firm_name, account_size_cents, account_type, status, verification_status, verification_paid, start_date, end_date, total_trades, total_wins, total_losses, win_rate_bps, profit_bps, biggest_win_cents, biggest_loss_cents, created_at, updated_at FROM tid_accounts WHERE tid_user_id = ? ORDER BY created_at DESC LIMIT 100",
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
