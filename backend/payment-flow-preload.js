const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const originalListen = express.application.listen;
let installed = false;

function installPaymentFlow(app) {
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

  const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });
    jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
      if (err || !decoded?.userId) return res.status(403).json({ error: "Invalid token" });
      req.userId = decoded.userId;
      next();
    });
  };

  const validPaymentLink = (value) => {
    try {
      const url = new URL(String(value || "").trim());
      return url.protocol === "https:" && /(^|\.)rzp\.io$/i.test(url.hostname);
    } catch {
      return false;
    }
  };

  const requestRef = () =>
    "REQ-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const accountCode = () =>
    "ACC-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  async function email(to, subject, html) {
    const key = process.env.EMAIL_PASS;
    if (!key || !to) return false;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_USER || "onboarding@resend.dev", to: [to], subject, html }),
    });
    if (!response.ok) throw new Error("Email API Error: " + response.status);
    return true;
  }

  async function pricing(connection, model, affiliateCode) {
    const [configs] = await connection.execute(
      "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
      [model]
    );
    if (!configs.length) throw new Error("Invalid challenge model");
    const config = configs[0];
    const original = Number(config.price_cents || 0);
    let discount = 0;
    let affiliateId = null;

    if (affiliateCode) {
      const [affiliates] = await connection.execute(
        "SELECT id FROM users WHERE affiliate_code = ? LIMIT 1",
        [String(affiliateCode).trim()]
      );
      if (affiliates.length) {
        affiliateId = affiliates[0].id;
        discount = Math.floor(original * Number(config.affiliate_discount_bps || 0) / 10000);
      }
    }

    return {
      model,
      originalAmountCents: original,
      discountAmountCents: discount,
      finalAmountCents: Math.max(original - discount, 0),
      currency: String(process.env.PAYMENT_CURRENCY || "USD").toUpperCase(),
      affiliateApplied: Boolean(affiliateId),
      affiliate_user_id: affiliateId,
    };
  }

  async function createAccountAndCommission(connection, order) {
    if (order.account_code) return order.account_code;

    const [configs] = await connection.execute(
      "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
      [order.model]
    );
    if (!configs.length) throw new Error("Challenge config not found for model: " + order.model);

    const code = accountCode();
    const config = configs[0];
    await connection.execute(
      `INSERT INTO accounts
       (account_code,user_id,challenge_model,phase,initial_balance_cents,balance_cents,equity_cents,status)
       VALUES (?, ?, ?, 'PHASE_1', ?, ?, ?, 'ACTIVE')`,
      [code, order.user_id, order.model, config.starting_balance_cents, config.starting_balance_cents, config.starting_balance_cents]
    );

    let affiliateId = null;
    let commissionCents = 0;
    if (order.affiliate_code) {
      const [rows] = await connection.execute(
        "SELECT id FROM affiliates WHERE affiliate_code = ? LIMIT 1",
        [String(order.affiliate_code).trim()]
      );
      if (rows.length) {
        affiliateId = rows[0].id;
        commissionCents = Math.floor(Number(order.final_amount_cents || 0) * 0.20 + 100);
        const [existing] = await connection.execute(
          "SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1",
          [order.id]
        );
        if (!existing.length) {
          await connection.execute(
            `INSERT INTO affiliate_commissions
             (affiliate_id,order_id,referred_user_id,model,commission_amount_cents,status)
             VALUES (?, ?, ?, ?, ?, 'PENDING')`,
            [affiliateId, order.id, order.user_id, order.model, commissionCents]
          );
          await connection.execute(
            `UPDATE affiliates
             SET total_sales = COALESCE(total_sales,0)+1,
                 total_earnings_cents = COALESCE(total_earnings_cents,0)+?,
                 pending_earnings_cents = COALESCE(pending_earnings_cents,0)+?
             WHERE id = ?`,
            [commissionCents, commissionCents, affiliateId]
          );
        }
      }
    }

    if (affiliateId) {
      await connection.execute(
        `INSERT INTO affiliate_sales
         (affiliate_id,order_id,request_id,affiliate_code,model,original_amount_cents,discount_amount_cents,final_amount_cents,commission_rate_bps,fixed_bonus_cents,commission_amount_cents,status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2000, 100, ?, 'PAYMENT_DONE')
         ON DUPLICATE KEY UPDATE
           request_id=VALUES(request_id),
           affiliate_code=VALUES(affiliate_code),
           model=VALUES(model),
           original_amount_cents=VALUES(original_amount_cents),
           discount_amount_cents=VALUES(discount_amount_cents),
           final_amount_cents=VALUES(final_amount_cents),
           commission_amount_cents=VALUES(commission_amount_cents),
           status='PAYMENT_DONE'`,
        [
          affiliateId,
          order.id,
          order.request_id,
          order.affiliate_code,
          order.model,
          order.original_amount_cents || 0,
          order.discount_amount_cents || 0,
          order.final_amount_cents || 0,
          commissionCents,
        ]
      );
    }

    await connection.execute(
      "UPDATE payment_requests SET account_code = ?, updated_at = NOW() WHERE id = ?",
      [code, order.id]
    );
    return code;
  }

  // User creates the payment request. This route intentionally uses payment_requests as the source of truth.
  app.post("/api/payments/request", authenticateUser, async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute(
        "SELECT id, legal_name, email, phone FROM users WHERE id = ? LIMIT 1",
        [req.userId]
      );
      if (!users.length) throw new Error("User not found");

      const user = users[0];
      const p = await pricing(connection, req.body?.model, req.body?.affiliate_code);
      const id = requestRef();
      const affiliateCode = p.affiliateApplied ? String(req.body.affiliate_code).trim() : null;

      await connection.execute(
        `INSERT INTO payment_requests
         (request_id,user_id,provider,razorpay_link,model,affiliate_code,affiliate_id,original_amount_cents,discount_amount_cents,final_amount_cents,paid_amount_cents,currency,status,created_at,updated_at)
         VALUES (?, ?, 'RAZORPAY', NULL, ?, ?, ?, ?, ?, ?, 0, ?, 'REQUESTED', NOW(), NOW())`,
        [id, user.id, p.model, affiliateCode, p.affiliate_user_id, p.originalAmountCents, p.discountAmountCents, p.finalAmountCents, p.currency]
      );
      await connection.commit();

      try {
        await email(
          "support.fundfxt@gmail.com",
          `FundFXT Payment Request ${id}`,
          `<h2>New FundFXT Payment Request</h2><p><b>Request ID:</b> ${id}</p><p><b>Name:</b> ${user.legal_name}</p><p><b>Email:</b> ${user.email}</p><p><b>Challenge:</b> ${p.model}</p><p><b>Payable:</b> ${(p.finalAmountCents / 100).toFixed(2)} ${p.currency}</p><p><b>Affiliate:</b> ${affiliateCode || "None"}</p>`
        );
      } catch (error) {
        console.error("Payment request email failed:", error.message);
      }

      res.json({ success: true, request_id: id, request_ref: id, status: "REQUESTED", manual_payment: true, pricing: p });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      console.error("Payment request error:", error);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  });

  app.post("/api/admin/payment-requests/:id/mark-link-sent", authenticateAdmin, async (req, res) => {
    const link = String(req.body?.razorpay_link || "").trim();
    if (!validPaymentLink(link)) return res.status(400).json({ error: "Enter a valid HTTPS Razorpay payment link (rzp.io)." });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT pr.*, u.email AS user_email, u.legal_name
         FROM payment_requests pr JOIN users u ON u.id = pr.user_id
         WHERE pr.id = ? FOR UPDATE`,
        [req.params.id]
      );
      if (!rows.length) throw new Error("Payment request not found");
      const request = rows[0];
      if (!["REQUESTED", "LINK_SENT", "PAYMENT_PENDING"].includes(String(request.status))) {
        throw new Error(`Payment link cannot be changed from ${request.status}.`);
      }
      await connection.execute(
        "UPDATE payment_requests SET razorpay_link = ?, status = 'LINK_SENT', updated_at = NOW() WHERE id = ?",
        [link, request.id]
      );
      await connection.commit();

      let emailSent = false;
      try { emailSent = await email(request.user_email, `FundFXT payment link — ${request.request_id}`, `<h2>FundFXT Payment</h2><p>Your request <b>${request.request_id}</b> is ready.</p><p>Challenge: <b>${request.model}</b></p><p>Payable: <b>${(Number(request.final_amount_cents || 0) / 100).toFixed(2)} ${request.currency}</b></p><p><a href="${link}">Pay Now</a></p>`); }
      catch (error) { console.error("Payment link email failed:", error.message); }

      res.json({ success: true, status: "LINK_SENT", emailed_to: emailSent ? request.user_email : null, email_sent: emailSent });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      console.error("Mark payment link sent failed:", error);
      res.status(500).json({ error: error.message });
    } finally { connection.release(); }
  });

  app.get("/api/admin/payment-requests", authenticateAdmin, async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const search = String(req.query.request_id || req.query.request_ref || req.query.razorpay_link || "").trim();
      const where = [], params = [];
      if (status) { where.push("pr.status = ?"); params.push(status); }
      if (search) { where.push("(pr.request_id LIKE ? OR pr.razorpay_link LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
      const sql = `SELECT pr.*, u.legal_name, u.email AS user_email, a.legal_name AS affiliate_name
                   FROM payment_requests pr
                   JOIN users u ON pr.user_id = u.id
                   LEFT JOIN users a ON pr.affiliate_id = a.id
                   ${where.length ? "WHERE " + where.join(" AND ") : ""}
                   ORDER BY pr.created_at DESC`;
      const [requests] = await db.execute(sql, params);
      res.json({ success: true, requests, orders: requests });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/admin/payment-requests/:id/status", authenticateAdmin, async (req, res) => {
    const requested = String(req.body?.status || "").trim().toUpperCase();
    const nextStatus = requested === "PAYMENT_APPROVED" || requested === "PAYMENT_DONE" ? "PAYMENT_DONE" : requested === "CANCELLED" || requested === "REJECTED" || requested === "PAYMENT_CANCELLED" ? "PAYMENT_CANCELLED" : requested;
    if (!["PAYMENT_DONE", "PAYMENT_CANCELLED"].includes(nextStatus)) return res.status(400).json({ error: "Allowed payment outcomes are PAYMENT_DONE or PAYMENT_CANCELLED." });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT * FROM payment_requests WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!rows.length) throw new Error("Payment request not found");
      const request = rows[0];
      if (!["LINK_SENT", "PAYMENT_PENDING", "PAYMENT_DONE", "PAYMENT_CANCELLED"].includes(String(request.status))) throw new Error(`Payment outcome cannot be set from ${request.status}`);
      if (request.status === "PAYMENT_CANCELLED" && nextStatus === "PAYMENT_DONE") throw new Error("A cancelled payment cannot be marked done.");

      let code = request.account_code || null;
      if (nextStatus === "PAYMENT_DONE") code = await createAccountAndCommission(connection, request);
      await connection.execute(
        "UPDATE payment_requests SET status = ?, paid_amount_cents = ?, updated_at = NOW() WHERE id = ?",
        [nextStatus, nextStatus === "PAYMENT_DONE" ? Number(request.final_amount_cents || 0) : 0, request.id]
      );
      await connection.commit();
      res.json({ success: true, status: nextStatus, account_code: code });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      console.error("Payment request status transaction failed:", error);
      res.status(500).json({ error: error.message });
    } finally { connection.release(); }
  });

  console.log("Payment Request API registered");
}

express.application.listen = function (...args) {
  installPaymentFlow(this);
  return originalListen.apply(this, args);
};
