const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("TID-ADMIN FATAL: JWT_SECRET is required");
  process.exit(1);
}

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  ssl: { rejectUnauthorized: false },
});

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || "tid-files";

function escapeHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

async function sendEmail(to, subject, html, timeoutMs) {
  const configuredFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const from = configuredFrom && configuredFrom.includes("<")
    ? configuredFrom
    : "Trader ID <" + configuredFrom + ">";

  if (process.env.RESEND_API_KEY) {
    const controller = new AbortController();
    const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Resend email failed with HTTP " + response.status);
      return;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    host: process.env.SMTP_HOST || undefined,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    secure: process.env.SMTP_SECURE != null ? String(process.env.SMTP_SECURE).toLowerCase() === "true" : undefined,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({ from, to, subject, html });
}

function authenticateAdmin(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No admin token" });
  jwt.verify(token, JWT_SECRET, function (err, decoded) {
    if (err || !decoded?.adminId) return res.status(403).json({ error: "Invalid admin token" });
    req.adminId = decoded.adminId;
    req.adminRole = decoded.role;
    next();
  });
}

function requireSuperAdmin(req, res, next) {
  if (String(req.adminRole || "").toUpperCase() !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "SUPER_ADMIN required" });
  }
  next();
}

function authenticateInternal(req, res, next) {
  var key = req.headers["x-internal-sync-key"];
  var expected = process.env.INTERNAL_SYNC_KEY;
  if (!expected) return res.status(500).json({ error: "INTERNAL_SYNC_KEY not configured" });
  if (!key || key !== expected) return res.status(403).json({ error: "Invalid internal key" });
  next();
}

// Overview counts
router.get("/admin/tid/overview", authenticateAdmin, async function (req, res) {
  try {
    const [u] = await db.execute("SELECT COUNT(*) AS c FROM tid_users");
    const [k] = await db.execute("SELECT COUNT(*) AS c FROM tid_kyc_submissions WHERE status='PENDING'");
    const [a] = await db.execute("SELECT COUNT(*) AS c FROM tid_accounts WHERE verification_status='PENDING'");
    const [f] = await db.execute("SELECT COUNT(*) AS c FROM tid_statements WHERE status='PENDING'");
    return res.json({
      success: true,
      counts: {
        total_users: Number(u[0].c),
        kyc_pending: Number(k[0].c),
        accounts_pending: Number(a[0].c),
        files_pending: Number(f[0].c)
      }
    });
  } catch (e) {
    console.error("[TID-ADMIN] overview:", e.message);
    return res.status(500).json({ error: "Unable to load overview" });
  }
});

// KYC queue
router.get("/admin/tid/kyc/pending", authenticateAdmin, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT k.id, k.tid_user_id, k.country, k.id_type, k.address_type, k.id_file_id, k.selfie_file_id, k.address_file_id, k.device_fingerprint, k.ip_address, k.timezone, k.status, k.created_at, u.tid, u.legal_name, u.email FROM tid_kyc_submissions k LEFT JOIN tid_users u ON u.id = k.tid_user_id WHERE k.status = 'PENDING' ORDER BY k.created_at ASC LIMIT 100"
    );
    return res.json({ success: true, submissions: rows });
  } catch (e) {
    console.error("[TID-ADMIN] kyc list:", e.message);
    return res.status(500).json({ error: "Unable to load KYC queue" });
  }
});

// Single KYC detail
router.get("/admin/tid/kyc/:id", authenticateAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    const [rows] = await db.execute(
      "SELECT k.*, u.tid, u.legal_name, u.email FROM tid_kyc_submissions k LEFT JOIN tid_users u ON u.id = k.tid_user_id WHERE k.id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ success: true, kyc: rows[0] });
  } catch (e) {
    console.error("[TID-ADMIN] kyc detail:", e.message);
    return res.status(500).json({ error: "Unable to load KYC" });
  }
});

// Approve KYC
router.post("/admin/tid/kyc/:id/approve", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    const [r] = await db.execute(
      "UPDATE tid_kyc_submissions SET status='APPROVED', verified_at=NOW(), verified_by=?, admin_notes=NULL WHERE id=? AND status='PENDING' LIMIT 1",
      [req.adminId, id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Not found or already processed" });
    return res.json({ success: true });
  } catch (e) {
    console.error("[TID-ADMIN] kyc approve:", e.message);
    return res.status(500).json({ error: "Unable to approve" });
  }
});

// Reject KYC
router.post("/admin/tid/kyc/:id/reject", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    const notes = String(req.body?.reason || "").trim().slice(0, 500) || "Rejected by admin";
    const [r] = await db.execute(
      "UPDATE tid_kyc_submissions SET status='REJECTED', verified_at=NOW(), verified_by=?, admin_notes=? WHERE id=? AND status='PENDING' LIMIT 1",
      [req.adminId, notes, id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Not found or already processed" });
    return res.json({ success: true });
  } catch (e) {
    console.error("[TID-ADMIN] kyc reject:", e.message);
    return res.status(500).json({ error: "Unable to reject" });
  }
});

// Accounts queue (pending verification)
router.get("/admin/tid/accounts/pending", authenticateAdmin, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT a.*, u.tid, u.legal_name, u.email FROM tid_accounts a LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE a.verification_status IN ('NONE','PENDING','AWAITING_PAYMENT','PAID_REQUESTED','LINK_SENT','PAID_PENDING') ORDER BY FIELD(a.verification_status,'PAID_PENDING','PAID_REQUESTED','LINK_SENT','AWAITING_PAYMENT','PENDING','NONE'), a.created_at DESC LIMIT 200"
    );
    // attach file counts
    for (const r of rows) {
      const [fc] = await db.execute(
        "SELECT COUNT(*) AS c FROM tid_statements WHERE account_id = ?",
        [r.id]
      );
      r.files_count = Number(fc[0].c);
    }
    return res.json({ success: true, accounts: rows });
  } catch (e) {
    console.error("[TID-ADMIN] accounts list:", e.message);
    return res.status(500).json({ error: "Unable to load accounts" });
  }
});

// Single account detail
router.get("/admin/tid/accounts/:id", authenticateAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    const [rows] = await db.execute(
      "SELECT a.*, u.tid, u.legal_name, u.email FROM tid_accounts a LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE a.id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const [files] = await db.execute(
      "SELECT id, file_type, file_size, mime_type, status, uploaded_at FROM tid_statements WHERE account_id = ? ORDER BY uploaded_at ASC",
      [id]
    );
    return res.json({ success: true, account: rows[0], files });
  } catch (e) {
    console.error("[TID-ADMIN] account detail:", e.message);
    return res.status(500).json({ error: "Unable to load account" });
  }
});

// Approve account
router.post("/admin/tid/accounts/:id/verify", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

    const b = req.body || {};
    const fields = [];
    const values = [];

    const num = (v) => Math.max(0, Math.round(Number(v) || 0));

    if (b.total_trades !== undefined) { fields.push("total_trades = ?"); values.push(num(b.total_trades)); }
    if (b.total_wins !== undefined) { fields.push("total_wins = ?"); values.push(num(b.total_wins)); }
    if (b.total_losses !== undefined) { fields.push("total_losses = ?"); values.push(num(b.total_losses)); }
    if (b.profit_bps !== undefined) { fields.push("profit_bps = ?"); values.push(Math.round(Number(b.profit_bps) || 0)); }
    if (b.biggest_win_cents !== undefined) { fields.push("biggest_win_cents = ?"); values.push(num(b.biggest_win_cents)); }
    if (b.biggest_loss_cents !== undefined) { fields.push("biggest_loss_cents = ?"); values.push(num(b.biggest_loss_cents)); }

    if (b.total_trades !== undefined || b.total_wins !== undefined) {
      const [cur] = await db.execute("SELECT total_trades, total_wins FROM tid_accounts WHERE id=? LIMIT 1", [id]);
      if (!cur.length) return res.status(404).json({ error: "Not found" });
      const trades = b.total_trades !== undefined ? num(b.total_trades) : num(cur[0].total_trades);
      const wins = b.total_wins !== undefined ? num(b.total_wins) : num(cur[0].total_wins);
      const winRateBps = trades > 0 ? Math.round((wins / trades) * 10000) : 0;
      fields.push("win_rate_bps = ?");
      values.push(winRateBps);
    }

    fields.push("verification_status = 'VERIFIED'");
    if (b.admin_notes !== undefined) {
      const notes = String(b.admin_notes || "").trim().slice(0, 500) || null;
      fields.push("admin_notes = ?");
      values.push(notes);
    }
    fields.push("updated_at = NOW()");

    values.push(id);
    const [r] = await db.execute(
      "UPDATE tid_accounts SET " + fields.join(", ") + " WHERE id = ? LIMIT 1",
      values
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Not found" });

    await db.execute(
      "UPDATE tid_statements SET status='APPROVED', verified_at=NOW(), verified_by=? WHERE account_id=? AND status='PENDING'",
      [req.adminId, id]
    );

    // Clear from update queue if pending
    await db.execute(
      "UPDATE tid_sync_log SET sync_status='SUCCESS', updated_at=NOW() WHERE account_id=? AND sync_status='PENDING' LIMIT 1",
      [id]
    );

    return res.json({ success: true, status: "VERIFIED" });
  } catch (e) {
    console.error("[TID-ADMIN] account verify:", e.message);
    return res.status(500).json({ error: "Unable to verify" });
  }
});

// Reject account
router.post("/admin/tid/accounts/:id/reject", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    const notes = String(req.body?.reason || "").trim().slice(0, 500) || "Rejected by admin";
    const [r] = await db.execute(
      "UPDATE tid_accounts SET verification_status='REJECTED', admin_notes=?, updated_at=NOW() WHERE id=? LIMIT 1",
      [notes, id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Not found" });
    await db.execute(
      "UPDATE tid_statements SET status='REJECTED', verified_at=NOW(), verified_by=? WHERE account_id=? AND status='PENDING'",
      [req.adminId, id]
    );
    return res.json({ success: true });
  } catch (e) {
    console.error("[TID-ADMIN] account reject:", e.message);
    return res.status(500).json({ error: "Unable to reject" });
  }
});

// Payment requests queue (all payment-related statuses)
router.get("/admin/tid/payment-requests", authenticateAdmin, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT a.id, a.tid_user_id, a.account_category, a.firm_name, a.broker_name, a.broker_account_id, a.broker_account_mode, a.account_size_cents, a.total_deposit_cents, a.total_withdrawal_cents, a.verification_status, a.verification_fee_cents, a.payment_ref, a.payment_request_no, a.transaction_id, a.score_impact_intent, a.created_at, u.tid, u.legal_name, u.email FROM tid_accounts a LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE a.verification_status IN ('AWAITING_PAYMENT','PAID_REQUESTED','LINK_SENT','PAID_PENDING') ORDER BY FIELD(a.verification_status,'PAID_REQUESTED','AWAITING_PAYMENT','LINK_SENT','PAID_PENDING'), a.updated_at DESC LIMIT 200"
    );
    return res.json({ success: true, accounts: rows });
  } catch (e) {
    console.error("[TID-ADMIN] payment requests:", e.message);
    return res.status(500).json({ error: "Unable to load payment requests" });
  }
});

// Save payment link → status LINK_SENT → email admin with ready-to-forward template
router.post("/admin/tid/accounts/:id/save-payment-link", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

    const linkRaw = String(req.body?.payment_link || "").trim();
    if (!linkRaw || !/^https?:\/\//i.test(linkRaw)) {
      return res.status(400).json({ error: "Valid payment link required (must start with http)" });
    }
    const link = linkRaw.slice(0, 500);

    const [rows] = await db.execute(
      "SELECT a.id, a.verification_status, a.account_category, a.firm_name, a.broker_name, a.broker_account_id, a.broker_account_mode, a.account_size_cents, a.verification_fee_cents, a.payment_request_no, a.tid_user_id, u.tid, u.email, u.legal_name FROM tid_accounts a LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE a.id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    const acc = rows[0];
    const cur = String(acc.verification_status || "").toUpperCase();
    if (!["PAID_REQUESTED", "AWAITING_PAYMENT", "LINK_SENT"].includes(cur)) {
      return res.status(400).json({ error: "Account is not in a payment-request state" });
    }

    await db.execute(
      "UPDATE tid_accounts SET verification_status = 'LINK_SENT', payment_ref = ?, updated_at = NOW() WHERE id = ? LIMIT 1",
      [link, id]
    );

    res.json({ success: true, status: "LINK_SENT" });

    setImmediate(async () => {
      try {
        const feeCents = Number(acc.verification_fee_cents) || 200;
        const feeStr = "$" + (feeCents / 100).toFixed(0);
        const userName = acc.legal_name || "Trader";
        const userEmail = acc.email || "—";
        const userTid = acc.tid || "—";
        const accLabel = String(acc.account_category || "").toUpperCase() === "BROKER"
          ? (acc.broker_name || "Broker") + " · " + (String(acc.broker_account_mode || "").toUpperCase() === "DEMO" ? "Demo" : "Real") + " · ID: " + (acc.broker_account_id || "—")
          : (acc.firm_name || "Firm") + " · $" + ((Number(acc.account_size_cents) || 0) / 100).toLocaleString("en-US");
        const safe = (v) => escapeHtml(String(v == null ? "" : v));

        const forwardBody =
          "Hi " + userName + ",\n\n" +
          "Here is your Trader ID verification payment link:\n\n" +
          "Account: " + accLabel + "\n" +
          "Trader ID: " + userTid + "\n" +
          "Verification Fee: " + feeStr + "\n\n" +
          "Pay securely here:\n" + link + "\n\n" +
          "After payment, please reply with the transaction ID so we can verify and approve your account.\n\n" +
          "— Traders ID\n" +
          "support.fundfxt@gmail.com";

        const forwardBodyHtml = forwardBody
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");

        const html =
          "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"></head>" +
          "<body style=\"margin:0;padding:0;background:#F8F9FB;font-family:Inter,Arial,sans-serif;color:#0F1B2D\">" +
          "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#F8F9FB;padding:32px 16px\"><tr><td align=\"center\">" +
          "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;background:#FFFFFF;border:1px solid #E8EBF0;border-radius:14px;overflow:hidden\">" +
          "<tr><td style=\"padding:22px 28px;border-bottom:1px solid #E8EBF0\">" +
          "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr>" +
          "<td style=\"width:40px;height:40px;background:#0F1B2D;color:#FFFFFF;border-radius:8px;text-align:center;vertical-align:middle;font-weight:800;font-size:13px;letter-spacing:.5px\">TID</td>" +
          "<td style=\"padding-left:12px;font-size:18px;font-weight:700;color:#0F1B2D\">Trader ID · Admin</td>" +
          "</tr></table></td></tr>" +
          "<tr><td style=\"padding:30px 28px 8px\">" +
          "<p style=\"margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#B8935A\">Ready to Forward</p>" +
          "<h1 style=\"margin:0 0 12px;font-size:22px;line-height:1.3;color:#0F1B2D\">Payment link saved for " + safe(userTid) + "</h1>" +
          "<p style=\"margin:0 0 20px;font-size:14px;line-height:1.7;color:#64748B\">Copy the message below and forward it to <b>" + safe(userEmail) + "</b> from your Gmail. The link is already attached.</p>" +
          "</td></tr>" +
          "<tr><td style=\"padding:0 28px 12px\">" +
          "<div style=\"border:1px dashed #B8935A;border-radius:10px;padding:18px 20px;background:#FFFDF7;font-size:13.5px;line-height:1.75;color:#0F1B2D;font-family:Consolas,Menlo,monospace;white-space:pre-wrap\">" + forwardBodyHtml + "</div>" +
          "</td></tr>" +
          "<tr><td style=\"padding:8px 28px 26px\">" +
          "<p style=\"margin:0;font-size:12.5px;line-height:1.7;color:#94A3B8\">After the user pays, open the admin panel → Payment Requests → this account → Mark Paid → then Verify with metrics.</p>" +
          "</td></tr>" +
          "<tr><td style=\"padding:18px 28px;border-top:1px solid #E8EBF0;background:#F8F9FB\">" +
          "<p style=\"margin:0 0 5px;font-size:12px;color:#64748B\">Traders ID · Admin Notifications</p>" +
          "<p style=\"margin:0;font-size:12px;color:#94A3B8\">Automated message · Do not reply</p>" +
          "</td></tr></table></td></tr></table></body></html>";

        await sendEmail("support.fundfxt@gmail.com", "Ready to Forward · " + (acc.payment_request_no || "PAY-PENDING") + " · " + userTid, html, 8000);
      } catch (emailErr) {
        console.warn("Admin link-saved email failed:", emailErr.message);
      }
    });
  } catch (e) {
    console.error("[TID-ADMIN] save-payment-link:", e.message);
    return res.status(500).json({ error: "Unable to save payment link" });
  }
});

// Mark account as paid (payment manually verified by admin)
router.post("/admin/tid/accounts/:id/mark-paid", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

    const txnId = String(req.body?.transaction_id || "").trim().slice(0, 100) || null;
    const [r] = await db.execute(
      "UPDATE tid_accounts SET verification_status = 'PAID_PENDING', verification_paid = 1, transaction_id = ?, updated_at = NOW() WHERE id = ? AND verification_status IN ('LINK_SENT','PAID_REQUESTED') LIMIT 1",
      [txnId, id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Not found or invalid state" });
    return res.json({ success: true, status: "PAID_PENDING" });
  } catch (e) {
    console.error("[TID-ADMIN] mark-paid:", e.message);
    return res.status(500).json({ error: "Unable to mark paid" });
  }
});

// Presigned URL for file viewing
router.get("/admin/tid/files/:id/url", authenticateAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    const [rows] = await db.execute(
      "SELECT id, r2_key, file_type, mime_type FROM tid_statements WHERE id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    const file = rows[0];
    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: file.r2_key }),
      { expiresIn: 3600 }
    );
    return res.json({ success: true, url, file_type: file.file_type, mime_type: file.mime_type });
  } catch (e) {
    console.error("[TID-ADMIN] file url:", e.message);
    return res.status(500).json({ error: "Unable to generate URL" });
  }
});

// Duplicate check for a KYC submission
router.get("/admin/tid/kyc/:id/duplicates", authenticateAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    const [me] = await db.execute(
      "SELECT id, tid_user_id, device_fingerprint, ip_address FROM tid_kyc_submissions WHERE id = ? LIMIT 1",
      [id]
    );
    if (!me.length) return res.status(404).json({ error: "KYC not found" });
    const cur = me[0];
    if (!cur.device_fingerprint && !cur.ip_address) {
      return res.json({ success: true, matches: [] });
    }
    const [rows] = await db.execute(
      "SELECT k.id, k.tid_user_id, k.status, k.device_fingerprint, k.ip_address, k.created_at, u.tid, u.legal_name, u.email FROM tid_kyc_submissions k LEFT JOIN tid_users u ON u.id = k.tid_user_id WHERE k.id != ? AND k.tid_user_id != ? AND (k.device_fingerprint = ? OR k.ip_address = ?) ORDER BY k.created_at DESC LIMIT 50",
      [id, cur.tid_user_id, cur.device_fingerprint || "", cur.ip_address || ""]
    );
    const matches = rows.map(function(r){
      const reasons = [];
      if (cur.device_fingerprint && r.device_fingerprint === cur.device_fingerprint) reasons.push("Same device fingerprint");
      if (cur.ip_address && r.ip_address === cur.ip_address) reasons.push("Same IP address");
      return Object.assign({}, r, { match_reasons: reasons });
    });
    return res.json({ success: true, matches });
  } catch (e) {
    console.error("[TID-ADMIN] kyc duplicates:", e.message);
    return res.status(500).json({ error: "Unable to check duplicates" });
  }
});

// Update queue (accounts with sync_status = PENDING)
router.get("/admin/tid/update-queue", authenticateAdmin, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT s.id AS sync_id, s.account_id, s.sync_status, s.last_sync_at, s.error_message, s.attempts, s.updated_at AS requested_at, a.firm_name, a.broker_name, a.account_category, a.broker_account_id, a.account_type, a.account_size_cents, u.tid, u.legal_name, u.email FROM tid_sync_log s LEFT JOIN tid_accounts a ON a.id = s.account_id LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE s.sync_status = 'PENDING' ORDER BY s.updated_at ASC LIMIT 200"
    );
    return res.json({ success: true, items: rows });
  } catch (e) {
    console.error("[TID-ADMIN] update queue:", e.message);
    return res.status(500).json({ error: "Unable to load update queue" });
  }
});

// Dismiss update request (mark SUCCESS without verification)
router.post("/admin/tid/update-queue/:accountId/dismiss", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const accountId = Number(req.params.accountId);
    if (!Number.isFinite(accountId)) return res.status(400).json({ error: "Invalid ID" });
    const [r] = await db.execute(
      "UPDATE tid_sync_log SET sync_status = 'SUCCESS', updated_at = NOW() WHERE account_id = ? AND sync_status = 'PENDING' LIMIT 1",
      [accountId]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Not in queue" });
    return res.json({ success: true });
  } catch (e) {
    console.error("[TID-ADMIN] dismiss update:", e.message);
    return res.status(500).json({ error: "Unable to dismiss" });
  }
});

// TID users list
router.get("/admin/tid/users", authenticateAdmin, async function (req, res) {
  try {
    const search = String(req.query.search || "").trim();
    let sql = "SELECT u.id, u.tid, u.email, u.legal_name, u.country, u.email_verified, u.status, u.created_at, p.current_rank FROM tid_users u LEFT JOIN tid_profiles p ON p.tid_user_id = u.id";
    const params = [];
    if (search) {
      sql += " WHERE u.tid LIKE ? OR u.email LIKE ? OR u.legal_name LIKE ?";
      const like = "%" + search + "%";
      params.push(like, like, like);
    }
    sql += " ORDER BY u.created_at DESC LIMIT 500";
    const [rows] = await db.execute(sql, params);
    return res.json({ success: true, users: rows });
  } catch (e) {
    console.error("[TID-ADMIN] users:", e.message);
    return res.status(500).json({ error: "Unable to load users" });
  }
});

router.post("/admin/internal/sync-start/:id", authenticateInternal, async function (req, res) {
  try {
    var id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    var source = String((req.body && req.body.source) || "AUTO").toUpperCase();
    var triggeredBy = source === "USER" ? "USER" : (source === "ADMIN" ? "ADMIN" : "AUTO");
    await db.execute(
      "INSERT INTO tid_sync_log (account_id, sync_status, started_at, triggered_by) VALUES (?, 'IN_PROGRESS', NOW(), ?) ON DUPLICATE KEY UPDATE sync_status = 'IN_PROGRESS', started_at = NOW(), triggered_by = ?, error_message = NULL, updated_at = NOW()",
      [id, triggeredBy, triggeredBy],
    );
    await db.execute(
      "UPDATE tid_accounts SET platform_sync_status = 'IN_PROGRESS', updated_at = NOW() WHERE id = ? LIMIT 1",
      [id],
    );
    return res.json({ success: true, status: "IN_PROGRESS" });
  } catch (e) {
    console.error("[TID-INTERNAL] sync-start:", e.message);
    return res.status(500).json({ error: "Unable to mark sync-start" });
  }
});

router.post("/admin/internal/sync-complete/:id", authenticateInternal, express.json(), async function (req, res) {
  try {
    var id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    var [accRows] = await db.execute(
      "SELECT id, tid_user_id, platform FROM tid_accounts WHERE id = ? LIMIT 1",
      [id],
    );
    if (!accRows.length) return res.status(404).json({ error: "Account not found" });
    var acc = accRows[0];
    var b = req.body || {};
    var trades = Array.isArray(b.trades) ? b.trades : [];
    var transactions = Array.isArray(b.transactions) ? b.transactions : [];
    var balanceCents = Number(b.balance_cents) || 0;
    var equityCents = Number(b.equity_cents) || 0;
    var tradesInserted = 0;
    var tradesSkipped = 0;
    var maxBrokerTradeId = null;
    var i;
    for (i = 0; i < trades.length; i++) {
      var t = trades[i];
      try {
        var btId = t.broker_trade_id ? String(t.broker_trade_id).slice(0, 100) : null;
        var dtId = t.deal_ticket ? String(t.deal_ticket).slice(0, 100) : null;
        var sym = String(t.symbol || "").toUpperCase().slice(0, 30);
        var dir = String(t.direction || "").toUpperCase();
        if (!sym || (dir !== "BUY" && dir !== "SELL")) continue;
        var [result] = await db.execute(
          "INSERT IGNORE INTO tid_trades (tid_user_id, account_id, symbol, direction, entry_price, exit_price, lot_size, pips, profit_cents, status, opened_at, closed_at, notes, screenshot_url, broker_trade_id, deal_ticket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            acc.tid_user_id, id, sym, dir,
            t.entry_price != null ? Number(t.entry_price) : null,
            t.exit_price != null ? Number(t.exit_price) : null,
            t.lot_size != null ? Number(t.lot_size) : null,
            t.pips != null ? Number(t.pips) : null,
            Number(t.profit_cents) || 0,
            String(t.status || "CLOSED").toUpperCase(),
            t.opened_at ? new Date(t.opened_at) : null,
            t.closed_at ? new Date(t.closed_at) : null,
            t.notes ? String(t.notes).slice(0, 1000) : null,
            t.screenshot_url ? String(t.screenshot_url).slice(0, 500) : null,
            btId,
            dtId,
          ],
        );
        if (result.affectedRows > 0) {
          tradesInserted++;
          if (btId) maxBrokerTradeId = btId;
        } else {
          tradesSkipped++;
        }
      } catch (rowErr) {
        console.error("[TID-INTERNAL] trade insert:", rowErr.message);
      }
    }
    var txInserted = 0;
    for (i = 0; i < transactions.length; i++) {
      var tx = transactions[i];
      try {
        var txBrokerId = tx.broker_tx_id ? String(tx.broker_tx_id).slice(0, 100) : null;
        var txType = String(tx.tx_type || "").toUpperCase();
        if (txType !== "DEPOSIT" && txType !== "WITHDRAWAL" && txType !== "PROFIT_ADJUSTMENT") continue;
        var [txResult] = await db.execute(
          "INSERT IGNORE INTO tid_account_transactions (account_id, tid_user_id, tx_type, amount_cents, tx_date, notes, broker_tx_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            id, acc.tid_user_id, txType,
            Number(tx.amount_cents) || 0,
            tx.tx_date ? new Date(tx.tx_date) : new Date(),
            tx.notes ? String(tx.notes).slice(0, 255) : null,
            txBrokerId,
          ],
        );
        if (txResult.affectedRows > 0) txInserted++;
      } catch (txErr) {
        console.error("[TID-INTERNAL] tx insert:", txErr.message);
      }
    }
    // Recompute account aggregates from tid_trades
    try {
      const [aggRows] = await db.execute(
        "SELECT COUNT(*) AS cnt, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN profit_cents < 0 THEN 1 ELSE 0 END) AS losses, COALESCE(SUM(pips), 0) AS total_pips, COALESCE(SUM(CASE WHEN pips > 0 THEN pips ELSE 0 END), 0) AS sum_win_pips, COALESCE(SUM(CASE WHEN pips < 0 THEN -pips ELSE 0 END), 0) AS sum_loss_pips, COALESCE(SUM(pips * pips), 0) AS sum_pips_squared, COALESCE(MAX(CASE WHEN profit_cents > 0 THEN profit_cents ELSE 0 END), 0) AS big_win, COALESCE(MAX(CASE WHEN profit_cents < 0 THEN -profit_cents ELSE 0 END), 0) AS big_loss, MIN(closed_at) AS first_trade_at, MAX(closed_at) AS last_trade_at FROM tid_trades WHERE account_id = ? AND status = 'CLOSED'",
        [id],
      );
      const agg = aggRows[0] || {};
      const totalTrades = Number(agg.cnt) || 0;
      const wins = Number(agg.wins) || 0;
      const losses = Number(agg.losses) || 0;
      const totalPips = Number(agg.total_pips) || 0;
      const sumWin = Number(agg.sum_win_pips) || 0;
      const sumLoss = Number(agg.sum_loss_pips) || 0;
      const sumSq = Number(agg.sum_pips_squared) || 0;
      const bigWin = Number(agg.big_win) || 0;
      const bigLoss = Number(agg.big_loss) || 0;
      const firstTradeAt = agg.first_trade_at || null;
      const lastTradeAt = agg.last_trade_at || null;

      const winRateBps = totalTrades > 0 ? Math.round((wins / totalTrades) * 10000) : 0;
      const avgWinPips = wins > 0 ? sumWin / wins : 0;
      const avgLossPips = losses > 0 ? sumLoss / losses : 0;
      const avgRr = avgLossPips > 0 ? Number((avgWinPips / avgLossPips).toFixed(3)) : 0;
      const mean = totalTrades > 0 ? totalPips / totalTrades : 0;
      const variance = totalTrades > 0 ? Math.max(0, (sumSq / totalTrades) - (mean * mean)) : 0;
      const stddev = Math.sqrt(variance);
      const avgAbs = totalTrades > 0 ? (sumWin + sumLoss) / totalTrades : 0;
      const consistencyScore = avgAbs > 0 ? Math.max(0, Math.min(100, Math.round(100 - (stddev / avgAbs) * 50))) : 0;
      const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      const rrRatio = avgLossPips > 0 ? avgWinPips / avgLossPips : 0;
      const winRateComponent = Math.min(winRatePct, 70) * 25 / 70;
      const rrComponent = Math.min(rrRatio, 3) * 25 / 3;
      const consistencyComponent = consistencyScore * 0.2;
      const ddComponent = sumWin > 0 ? Math.max(0, Math.min(15, (1 - Math.abs(avgLossPips) / sumWin) * 15)) : 0;
      const daysActive = firstTradeAt ? Math.floor((Date.now() - new Date(firstTradeAt).getTime()) / 86400000) : 0;
      const tenureComponent = Math.min(daysActive / 90, 1) * 15;
      const accountScore = Math.max(0, Math.min(100, Math.round(winRateComponent + rrComponent + consistencyComponent + ddComponent + tenureComponent)));

      await db.execute(
        "UPDATE tid_accounts SET total_trades = ?, total_wins = ?, total_losses = ?, win_rate_bps = ?, total_pips = ?, sum_win_pips = ?, sum_loss_pips = ?, sum_pips_squared = ?, avg_rr = ?, avg_win_pips = ?, avg_loss_pips = ?, consistency_score = ?, account_score = ?, biggest_win_cents = ?, biggest_loss_cents = ?, first_trade_at = COALESCE(first_trade_at, ?), last_trade_at = ?, platform_sync_status = 'SUCCESS', platform_last_sync_at = NOW(), last_synced_broker_trade_id = COALESCE(?, last_synced_broker_trade_id), floating_pnl_cents = ?, updated_at = NOW() WHERE id = ? LIMIT 1",
        [totalTrades, wins, losses, winRateBps, totalPips, sumWin, sumLoss, sumSq, avgRr, avgWinPips, avgLossPips, consistencyScore, accountScore, bigWin, bigLoss, firstTradeAt, lastTradeAt, maxBrokerTradeId, equityCents - balanceCents, id],
      );
    } catch (aggErr) {
      console.error("[TID-INTERNAL] aggregates recompute:", aggErr.message);
      // Fallback: still mark as success with minimal update
      await db.execute(
        "UPDATE tid_accounts SET platform_sync_status = 'SUCCESS', platform_last_sync_at = NOW(), last_synced_broker_trade_id = COALESCE(?, last_synced_broker_trade_id), floating_pnl_cents = ?, updated_at = NOW() WHERE id = ? LIMIT 1",
        [maxBrokerTradeId, equityCents - balanceCents, id],
      );
    }
    await db.execute(
      "UPDATE tid_sync_log SET sync_status = 'SUCCESS', completed_at = NOW(), last_sync_at = NOW(), error_message = NULL, updated_at = NOW() WHERE account_id = ? LIMIT 1",
      [id],
    );
    return res.json({
      success: true,
      trades_inserted: tradesInserted,
      trades_skipped: tradesSkipped,
      transactions_inserted: txInserted,
    });
  } catch (e) {
    console.error("[TID-INTERNAL] sync-complete:", e.message);
    return res.status(500).json({ error: "Unable to complete sync" });
  }
});

router.post("/admin/internal/sync-fail/:id", authenticateInternal, express.json(), async function (req, res) {
  try {
    var id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
    var msg = String((req.body && req.body.error) || "Unknown error").slice(0, 255);
    await db.execute(
      "UPDATE tid_sync_log SET sync_status = 'FAILED', error_message = ?, attempts = attempts + 1, completed_at = NOW(), updated_at = NOW() WHERE account_id = ? LIMIT 1",
      [msg, id],
    );
    var [logRows] = await db.execute(
      "SELECT attempts FROM tid_sync_log WHERE account_id = ? LIMIT 1",
      [id],
    );
    var attempts = logRows.length ? Number(logRows[0].attempts) : 1;
    if (attempts >= 3) {
      await db.execute(
        "UPDATE tid_accounts SET platform_sync_status = 'FAILED', updated_at = NOW() WHERE id = ? LIMIT 1",
        [id],
      );
    } else {
      await db.execute(
        "UPDATE tid_accounts SET platform_sync_status = 'PENDING', updated_at = NOW() WHERE id = ? LIMIT 1",
        [id],
      );
    }
    return res.json({ success: true, attempts: attempts });
  } catch (e) {
    console.error("[TID-INTERNAL] sync-fail:", e.message);
    return res.status(500).json({ error: "Unable to log failure" });
  }
});

router.get("/admin/internal/sync-queue", authenticateInternal, async function (req, res) {
  try {
    var limit = Math.min(Number(req.query.limit) || 20, 50);
    var items = [];

    var [ur] = await db.execute(
      "SELECT a.id AS account_id, a.tid_user_id, a.platform, a.platform_login, a.platform_password_encrypted, a.broker_server, a.status, a.platform_sync_status, a.last_synced_broker_trade_id, s.sync_status, s.attempts, 'USER' AS source FROM tid_sync_log s INNER JOIN tid_accounts a ON a.id = s.account_id WHERE s.sync_status = 'PENDING' AND a.platform_login IS NOT NULL AND a.platform_password_encrypted IS NOT NULL ORDER BY s.updated_at ASC LIMIT ?",
      [limit]
    );
    if (ur && ur.length) items = items.concat(ur);

    if (items.length < limit) {
      var [ar] = await db.execute(
        "SELECT id AS account_id, tid_user_id, platform, platform_login, platform_password_encrypted, broker_server, status, platform_sync_status, last_synced_broker_trade_id, NULL AS sync_status, 0 AS attempts, 'AUTO_PENDING' AS source FROM tid_accounts WHERE platform_login IS NOT NULL AND platform_password_encrypted IS NOT NULL AND platform_sync_status = 'PENDING' ORDER BY updated_at ASC LIMIT ?",
        [limit - items.length]
      );
      if (ar && ar.length) items = items.concat(ar);
    }

    if (items.length < limit) {
      var [sr] = await db.execute(
        "SELECT id AS account_id, tid_user_id, platform, platform_login, platform_password_encrypted, broker_server, status, platform_sync_status, last_synced_broker_trade_id, NULL AS sync_status, 0 AS attempts, 'AUTO_STALE' AS source FROM tid_accounts WHERE platform_login IS NOT NULL AND platform_password_encrypted IS NOT NULL AND status IN ('ACTIVE','PASSED') AND (platform_last_sync_at IS NULL OR platform_last_sync_at < NOW() - INTERVAL 24 HOUR) AND platform_sync_status != 'IN_PROGRESS' ORDER BY platform_last_sync_at ASC LIMIT ?",
        [limit - items.length]
      );
      if (sr && sr.length) items = items.concat(sr);
    }

    if (items.length < limit) {
      var [br] = await db.execute(
        "SELECT id AS account_id, tid_user_id, platform, platform_login, platform_password_encrypted, broker_server, status, platform_sync_status, last_synced_broker_trade_id, NULL AS sync_status, 0 AS attempts, 'AUTO_BREACHED' AS source FROM tid_accounts WHERE platform_login IS NOT NULL AND platform_password_encrypted IS NOT NULL AND status IN ('BREACHED','CLOSED') AND platform_sync_status != 'SUCCESS' ORDER BY updated_at ASC LIMIT ?",
        [limit - items.length]
      );
      if (br && br.length) items = items.concat(br);
    }

    return res.json({ success: true, items: items });
  } catch (e) {
    console.error("[TID-INTERNAL] sync-queue:", e.message);
    return res.status(500).json({ error: "Unable to load queue" });
  }
});

// Server review queue — accounts with non-whitelisted servers
router.get("/admin/tid/server-review-queue", authenticateAdmin, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT a.id, a.tid_user_id, a.firm_name, a.broker_name, a.account_category, a.account_type, a.account_size_cents, a.status, a.platform, a.platform_login, a.broker_server, a.server_whitelisted, a.platform_sync_status, a.created_at, u.tid, u.legal_name, u.email FROM tid_accounts a LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE a.platform_login IS NOT NULL AND a.broker_server IS NOT NULL AND (a.server_whitelisted = 0 OR a.server_whitelisted IS NULL) ORDER BY a.created_at DESC LIMIT 200"
    );
    return res.json({ success: true, accounts: rows });
  } catch (e) {
    console.error("[TID-ADMIN] server review queue:", e.message);
    return res.status(500).json({ error: "Unable to load queue" });
  }
});

// Approve server — add to whitelist + set account PENDING for sync
router.post("/admin/tid/accounts/:id/approve-server", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

    const [rows] = await db.execute(
      "SELECT id, broker_server, firm_name, broker_name, account_category FROM tid_accounts WHERE id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Account not found" });
    const acc = rows[0];
    const server = String(acc.broker_server || "").trim();
    if (!server) return res.status(400).json({ error: "Account has no broker_server set" });

    const brokerName = acc.account_category === "BROKER"
      ? (acc.broker_name || "Unknown Broker")
      : (acc.firm_name || "Unknown Firm");

    await db.execute(
      "INSERT INTO tid_broker_servers (broker_name, server_name, platform, verified) VALUES (?, ?, 'MT5', 1) ON DUPLICATE KEY UPDATE verified = 1, broker_name = VALUES(broker_name)",
      [brokerName, server]
    );

    await db.execute(
      "UPDATE tid_accounts SET server_whitelisted = 1, platform_sync_status = 'PENDING', updated_at = NOW() WHERE id = ? LIMIT 1",
      [id]
    );

    await db.execute(
      "INSERT INTO tid_sync_log (account_id, sync_status, triggered_by) VALUES (?, 'PENDING', 'ADMIN') ON DUPLICATE KEY UPDATE sync_status = 'PENDING', triggered_by = 'ADMIN', attempts = 0, error_message = NULL, updated_at = NOW()",
      [id]
    );

    return res.json({ success: true, whitelisted: server });
  } catch (e) {
    console.error("[TID-ADMIN] approve-server:", e.message);
    return res.status(500).json({ error: "Unable to approve server" });
  }
});

// Reject server — set account status back to NONE with admin note
router.post("/admin/tid/accounts/:id/reject-server", authenticateAdmin, requireSuperAdmin, async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

    const reason = String((req.body && req.body.reason) || "Server not recognized").trim().slice(0, 500);

    await db.execute(
      "UPDATE tid_accounts SET platform_sync_status = 'NONE', server_whitelisted = 0, admin_notes = ?, updated_at = NOW() WHERE id = ? LIMIT 1",
      [reason, id]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error("[TID-ADMIN] reject-server:", e.message);
    return res.status(500).json({ error: "Unable to reject server" });
  }
});

module.exports = router;