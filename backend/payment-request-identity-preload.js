const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const originalListen = express.application.listen;
let installed = false;

function installPaymentRequestIdentity(app) {
  if (installed) return;
  installed = true;

  const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    waitForConnections: true,
    connectionLimit: 5,
    ssl: { rejectUnauthorized: false },
  });

  const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });
    jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
      if (err || !decoded?.userId) return res.status(403).json({ error: "Invalid token" });
      req.userId = decoded.userId;
      next();
    });
  };

  const authenticateAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No admin token" });
    jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
      if (err || !decoded?.adminId) return res.status(403).json({ error: "Invalid admin token" });
      req.adminId = decoded.adminId;
      req.adminRole = decoded.role;
      next();
    });
  };

  const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
  const requestRef = () => "REQ-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  async function calculatePrice(connection, model, affiliateCode) {
    const [configs] = await connection.execute(
      "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
      [model]
    );
    if (!configs.length) throw new Error("Invalid challenge model");
    const config = configs[0];
    const original = Number(config.price_cents || 0);
    let discount = 0;
    let affiliateUserId = null;

    if (affiliateCode) {
      const code = String(affiliateCode).trim();
      const [affiliateRows] = await connection.execute(
        "SELECT id FROM users WHERE affiliate_code = ? LIMIT 1",
        [code]
      );
      if (affiliateRows.length) {
        affiliateUserId = affiliateRows[0].id;
        discount = Math.floor(original * Number(config.affiliate_discount_bps || 0) / 10000);
      }
    }

    return {
      model,
      originalAmountCents: original,
      discountAmountCents: discount,
      finalAmountCents: Math.max(original - discount, 0),
      currency: String(process.env.PAYMENT_CURRENCY || "USD").toUpperCase(),
      affiliateApplied: Boolean(affiliateUserId),
      affiliate_user_id: affiliateUserId,
    };
  }

  app.post("/api/payments/request", authenticateUser, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const model = String(req.body?.model || "").trim();
    const affiliateCode = String(req.body?.affiliate_code || "").trim();
    if (!email) return res.status(400).json({ error: "Registered email is required for the payment request." });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Identity is resolved from the exact email entered, then checked against JWT.
      const [usersByEmail] = await connection.execute(
        "SELECT id, legal_name, email, phone FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
        [email]
      );
      if (!usersByEmail.length) throw new Error("No FundFXT user exists for this email.");
      const user = usersByEmail[0];

      const [tokenUsers] = await connection.execute(
        "SELECT id, email FROM users WHERE id = ? LIMIT 1",
        [req.userId]
      );
      if (!tokenUsers.length) throw new Error("Authenticated user not found.");
      if (Number(tokenUsers[0].id) !== Number(user.id)) {
        return res.status(409).json({
          error: "Authenticated user does not match the payment-request email. Please log in with the customer's account before creating the request.",
          authenticated_email: tokenUsers[0].email,
          requested_email: user.email,
        });
      }

      const pricing = await calculatePrice(connection, model, affiliateCode);
      const storedAffiliateCode = pricing.affiliateApplied ? affiliateCode : null;
      const requestId = requestRef();

      await connection.execute(
        `INSERT INTO payment_requests
         (request_id,user_id,provider,razorpay_link,model,affiliate_code,affiliate_id,
          original_amount_cents,discount_amount_cents,final_amount_cents,paid_amount_cents,
          currency,status,created_at,updated_at)
         VALUES (?, ?, 'RAZORPAY', NULL, ?, ?, ?, ?, ?, ?, 0, ?, 'REQUESTED', NOW(), NOW())`,
        [
          requestId,
          user.id,
          pricing.model,
          storedAffiliateCode,
          pricing.affiliate_user_id,
          pricing.originalAmountCents,
          pricing.discountAmountCents,
          pricing.finalAmountCents,
          pricing.currency,
        ]
      );

      await connection.commit();
      res.json({
        success: true,
        request_id: requestId,
        request_ref: requestId,
        status: "REQUESTED",
        manual_payment: true,
        customer: { id: user.id, legal_name: user.legal_name, email: user.email, phone: user.phone },
        pricing,
      });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      console.error("Payment request identity-safe flow failed:", error);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  });

  // One explicit admin repair endpoint. It never runs automatically.
  // It is intentionally email-driven so the corrected user_id comes from users.email.
  app.post("/api/admin/payment-requests/:id/repair-customer", authenticateAdmin, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Customer email is required." });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute(
        "SELECT id, legal_name, email FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
        [email]
      );
      if (!users.length) throw new Error("No FundFXT user exists for this email.");
      const user = users[0];
      const [requests] = await connection.execute(
        "SELECT id, request_id, user_id, affiliate_id, model, status FROM payment_requests WHERE id = ? LIMIT 1 FOR UPDATE",
        [req.params.id]
      );
      if (!requests.length) throw new Error("Payment request not found.");
      const request = requests[0];
      await connection.execute(
        "UPDATE payment_requests SET user_id = ?, updated_at = NOW() WHERE id = ?",
        [user.id, request.id]
      );
      await connection.commit();
      res.json({ success: true, request_id: request.request_id, user_id: user.id, customer_name: user.legal_name, customer_email: user.email });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      console.error("Payment request customer repair failed:", error);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  });

  console.log("Payment Request Identity Guard registered");
}

express.application.listen = function (...args) {
  installPaymentRequestIdentity(this);
  return originalListen.apply(this, args);
};
