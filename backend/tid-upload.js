const express = require("express");
const multer = require("multer");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("TID-UPLOAD FATAL: JWT_SECRET is required");
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
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf","image/jpeg","image/jpg","image/png","image/webp"]);
const ALLOWED_TYPES = new Set(["STATEMENT","SCREENSHOT","PAYOUT_PROOF","ID_PROOF","ADDRESS_PROOF","SELFIE","AVATAR"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: function (req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Invalid file type. Allowed: PDF, JPG, PNG, WEBP"));
    }
    cb(null, true);
  },
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

function extFromMime(mime) {
  const map = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
  return map[mime] || "bin";
}

function buildR2Key(userId, fileType, ext) {
  const ts = Date.now();
  const uuid = crypto.randomBytes(8).toString("hex");
  const folder = fileType === "AVATAR" ? "avatar" : fileType.toLowerCase().replace(/_/g, "-");
  return "tid/users/" + userId + "/" + folder + "/" + ts + "-" + uuid + "." + ext;
}

router.post("/upload", authenticateTid, upload.single("file"), async function (req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const fileType = String(req.body?.file_type || "").trim().toUpperCase();
    if (!ALLOWED_TYPES.has(fileType)) return res.status(400).json({ error: "Invalid file_type" });
    const accountId = req.body?.account_id ? Number(req.body.account_id) : null;
    const userId = req.tidUser.tidUserId;
    const ext = extFromMime(req.file.mimetype);
    const key = buildR2Key(userId, fileType, ext);

    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      Metadata: { "uploaded-by": String(userId), "file-type": fileType },
    }));

    const [result] = await db.execute(
      "INSERT INTO tid_statements (tid_user_id, account_id, file_type, r2_key, file_url, file_size, mime_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')",
      [userId, accountId, fileType, key, "", req.file.size, req.file.mimetype]
    );

    return res.json({
      success: true,
      file_id: result.insertId,
      file_type: fileType,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
    });
  } catch (error) {
    console.error("TID upload error:", error);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/file-url/:id", authenticateTid, async function (req, res) {
  try {
    const fileId = Number(req.params.id);
    if (!Number.isFinite(fileId)) return res.status(400).json({ error: "Invalid file id" });
    const [rows] = await db.execute(
      "SELECT * FROM tid_statements WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [fileId, req.tidUser.tidUserId]
    );
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    const file = rows[0];
    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: file.r2_key }),
      { expiresIn: 3600 }
    );
    return res.json({
      success: true,
      url: url,
      expires_in: 3600,
      file_type: file.file_type,
      file_size: file.file_size,
      mime_type: file.mime_type,
      status: file.status,
      uploaded_at: file.uploaded_at,
    });
  } catch (error) {
    console.error("TID file-url error:", error);
    return res.status(500).json({ error: "Unable to generate URL" });
  }
});

router.delete("/file/:id", authenticateTid, async function (req, res) {
  try {
    const fileId = Number(req.params.id);
    if (!Number.isFinite(fileId)) return res.status(400).json({ error: "Invalid file id" });
    const [rows] = await db.execute(
      "SELECT * FROM tid_statements WHERE id = ? AND tid_user_id = ? LIMIT 1",
      [fileId, req.tidUser.tidUserId]
    );
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    const file = rows[0];
    if (file.status === "APPROVED") return res.status(403).json({ error: "Cannot delete an approved file" });

    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: file.r2_key }));
    await db.execute("DELETE FROM tid_statements WHERE id = ? LIMIT 1", [fileId]);
    return res.json({ success: true, deleted: fileId });
  } catch (error) {
    console.error("TID delete error:", error);
    return res.status(500).json({ error: "Delete failed" });
  }
});

router.get("/files", authenticateTid, async function (req, res) {
  try {
    const [rows] = await db.execute(
      "SELECT id, account_id, file_type, file_size, mime_type, status, uploaded_at FROM tid_statements WHERE tid_user_id = ? ORDER BY uploaded_at DESC LIMIT 200",
      [req.tidUser.tidUserId]
    );
    return res.json({ success: true, files: rows });
  } catch (error) {
    console.error("TID list files error:", error);
    return res.status(500).json({ error: "Unable to list files" });
  }
});

router.use(function (error, req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Max 3 MB." });
    return res.status(400).json({ error: error.message });
  }
  if (error) return res.status(400).json({ error: error.message || "Upload failed" });
  next();
});

module.exports = router;