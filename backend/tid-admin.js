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
      "SELECT a.*, u.tid, u.legal_name, u.email FROM tid_accounts a LEFT JOIN tid_users u ON u.id = a.tid_user_id WHERE a.verification_status IN ('NONE','PENDING') ORDER BY a.created_at ASC LIMIT 200"
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
    const [r] = await db.execute(
      "UPDATE tid_accounts SET verification_status='VERIFIED', updated_at=NOW() WHERE id=? LIMIT 1",
      [id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Not found" });
    // Also mark all files as approved
    await db.execute(
      "UPDATE tid_statements SET status='APPROVED', verified_at=NOW(), verified_by=? WHERE account_id=? AND status='PENDING'",
      [req.adminId, id]
    );
    return res.json({ success: true });
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

module.exports = router;