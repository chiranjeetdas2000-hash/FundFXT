const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("TID-KYC FATAL: JWT_SECRET is required");
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

function authenticateTid(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  jwt.verify(token, JWT_SECRET, function (error, decoded) {
    if (error) return res.status(403).json({ error: "Invalid token" });
    if (!decoded?.tidUserId || !decoded?.tid || !decoded?.email) {
      return res.status(403).json({ error: "Invalid TID token" });
    }
    req.tidUser = decoded;
    next();
  });
}

function cleanString(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

const ALLOWED_COUNTRIES = new Set([
  "India","UK","USA","UAE","Singapore","Australia",
  "Canada","Germany","France","Other"
]);

const ID_TYPES = new Set([
  "Aadhaar","PAN","Passport","Driving Licence","Voter ID",
  "BRP","State ID","SSN Card","National ID","Other"
]);

const ADDRESS_TYPES = new Set([
  "Bank Statement","Utility Bill","Other"
]);

// POST /api/tid/kyc/submit
router.post("/kyc/submit", authenticateTid, async function (req, res) {
  try {
    const userId = req.tidUser.tidUserId;
    const country = cleanString(req.body?.country, 50);
    const idType = cleanString(req.body?.id_type, 50);
    const addressType = cleanString(req.body?.address_type, 50);
    const idFileId = req.body?.id_file_id ? Number(req.body.id_file_id) : null;
    const selfieFileId = req.body?.selfie_file_id ? Number(req.body.selfie_file_id) : null;
    const addressFileId = req.body?.address_file_id ? Number(req.body.address_file_id) : null;
    const deviceFingerprint = cleanString(req.body?.device_fingerprint, 255) || null;
    const timezone = cleanString(req.body?.timezone, 64) || null;

    if (!ALLOWED_COUNTRIES.has(country)) return res.status(400).json({ error: "Invalid country" });
    if (!ID_TYPES.has(idType)) return res.status(400).json({ error: "Invalid ID type" });
    if (!ADDRESS_TYPES.has(addressType)) return res.status(400).json({ error: "Invalid address type" });
    if (!idFileId || !selfieFileId || !addressFileId) {
      return res.status(400).json({ error: "All 3 documents are required" });
    }

    // Verify all 3 files belong to this user and exist
    const [files] = await db.execute(
      "SELECT id, file_type FROM tid_statements WHERE id IN (?, ?, ?) AND tid_user_id = ?",
      [idFileId, selfieFileId, addressFileId, userId]
    );
    if (files.length !== 3) {
      return res.status(400).json({ error: "One or more file IDs invalid" });
    }

    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
      .split(",")[0].trim().slice(0, 45);
    const userAgent = cleanString(req.headers["user-agent"], 255) || null;

    // Upsert: one KYC per user
    const [existing] = await db.execute(
      "SELECT id, status FROM tid_kyc_submissions WHERE tid_user_id = ? LIMIT 1",
      [userId]
    );

    if (existing.length) {
      if (existing[0].status === "APPROVED") {
        return res.status(400).json({ error: "KYC already approved" });
      }
      await db.execute(
        "UPDATE tid_kyc_submissions SET country=?, id_type=?, address_type=?, id_file_id=?, selfie_file_id=?, address_file_id=?, device_fingerprint=?, ip_address=?, timezone=?, user_agent=?, status='PENDING', admin_notes=NULL, verified_at=NULL, verified_by=NULL WHERE id=?",
        [country, idType, addressType, idFileId, selfieFileId, addressFileId, deviceFingerprint, ip, timezone, userAgent, existing[0].id]
      );
      return res.json({ success: true, submission_id: existing[0].id, status: "PENDING" });
    }

    const [result] = await db.execute(
      "INSERT INTO tid_kyc_submissions (tid_user_id, country, id_type, address_type, id_file_id, selfie_file_id, address_file_id, device_fingerprint, ip_address, timezone, user_agent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')",
      [userId, country, idType, addressType, idFileId, selfieFileId, addressFileId, deviceFingerprint, ip, timezone, userAgent]
    );

    return res.json({ success: true, submission_id: result.insertId, status: "PENDING" });
  } catch (error) {
    console.error("[KYC] submit error:", error.message);
    return res.status(500).json({ error: "Unable to submit KYC" });
  }
});

// GET /api/tid/kyc/status
router.get("/kyc/status", authenticateTid, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT id, country, id_type, address_type, status, admin_notes, verified_at, created_at, updated_at FROM tid_kyc_submissions WHERE tid_user_id = ? LIMIT 1",
      [req.tidUser.tidUserId]
    );
    if (!rows.length) {
      return res.json({ success: true, submitted: false, status: "NONE" });
    }
    return res.json({ success: true, submitted: true, kyc: rows[0] });
  } catch (error) {
    console.error("[KYC] status error:", error.message);
    return res.status(500).json({ error: "Unable to fetch KYC status" });
  }
});

// DELETE /api/tid/kyc
router.delete("/kyc", authenticateTid, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT id, status FROM tid_kyc_submissions WHERE tid_user_id = ? LIMIT 1",
      [req.tidUser.tidUserId]
    );
    if (!rows.length) return res.status(404).json({ error: "No KYC submission found" });
    if (rows[0].status === "APPROVED") {
      return res.status(403).json({ error: "Cannot delete an approved KYC" });
    }
    await db.execute("DELETE FROM tid_kyc_submissions WHERE id = ? LIMIT 1", [rows[0].id]);
    return res.json({ success: true, deleted: rows[0].id });
  } catch (error) {
    console.error("[KYC] delete error:", error.message);
    return res.status(500).json({ error: "Unable to delete KYC" });
  }
});

module.exports = router;
