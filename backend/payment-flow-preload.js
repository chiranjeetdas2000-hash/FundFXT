console.log("[PRELOAD-LOAD] payment-flow loaded");
const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const originalListen = express.application.listen;
let installed = false;

function installPaymentFlow(app) {
  console.log("[PRELOAD] payment-flow installer called");
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
    const normalizedModel = String(model || "").trim();
    const parsed = {
      warrior_5k: { model_key: "warrior", size_key: "5k" },
      warrior_10k: { model_key: "warrior", size_key: "10k" },
      warrior_15k: { model_key: "warrior", size_key: "15k" },
      warrior_25k: { model_key: "warrior", size_key: "25k" },
      prime_10k: { model_key: "prime", size_key: "10k" },
      prime: { model_key: "prime", size_key: "10k" },
      prototype_5k: { model_key: "prototype", size_key: "5k" },
      prototype: { model_key: "prototype", size_key: "5k" },
      warrior: { model_key: "warrior", size_key: "5k" },
    }[normalizedModel] || null;

    let priceCents;
    let affiliateDiscountBps;
    let resolvedModel;
    let config;

    if (parsed) {
      const [sizes] = await connection.execute(
        "SELECT * FROM challenge_sizes WHERE model_key = ? AND size_key = ? AND is_active = 1 LIMIT 1",
        [parsed.model_key, parsed.size_key]
      );
      if (sizes.length) {
        const size = sizes[0];
        priceCents = Number(size.price_cents || 0);
        affiliateDiscountBps = Number(size.affiliate_discount_bps || 0);
        resolvedModel = parsed.model_key + "_" + parsed.size_key;
        config = size;
      }
    }

    if (priceCents === undefined) {
      const [configs] = await connection.execute(
        "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
        [model]
      );
      if (!configs.length) throw new Error("Invalid challenge model");
      config = configs[0];
      priceCents = Number(config.price_cents || 0);
      affiliateDiscountBps = Number(config.affiliate_discount_bps || 0);
      resolvedModel = model;
    }

    let discountAmountCents = 0;
    let affiliateId = null;
    let affiliateApplied = false;

    if (affiliateCode) {
      const [affiliates] = await connection.execute(
        "SELECT id FROM users WHERE affiliate_code = ? LIMIT 1",
        [String(affiliateCode).trim()]
      );
      if (affiliates.length) {
        affiliateId = affiliates[0].id;
        discountAmountCents = Math.floor(priceCents * affiliateDiscountBps / 10000);
        affiliateApplied = true;
      }
    }

    return {
      model: resolvedModel,
      originalAmountCents: priceCents,
      discountAmountCents,
      finalAmountCents: Math.max(priceCents - discountAmountCents, 0),
      currency: String(process.env.PAYMENT_CURRENCY || "USD").toUpperCase(),
      affiliateApplied,
      affiliate_user_id: affiliateId,
      config,
    };
  }

  async function createAccountAndCommission(connection, order) {
    if (order.account_code) return order.account_code;

    const parsed = ({
      warrior_5k: { model_key: "warrior", size_key: "5k" },
      warrior_10k: { model_key: "warrior", size_key: "10k" },
      warrior_15k: { model_key: "warrior", size_key: "15k" },
      warrior_25k: { model_key: "warrior", size_key: "25k" },
      prototype_5k: { model_key: "prototype", size_key: "5k" },
      prototype: { model_key: "prototype", size_key: "5k" },
      warrior: { model_key: "warrior", size_key: "5k" },
    })[String(order.model || "").trim()] || null;

    let startingBalanceCents;
    let resolvedModel = order.model;
    let initialPhase = "PHASE_1";

    if (parsed) {
      const [sizes] = await connection.execute(
        "SELECT * FROM challenge_sizes WHERE model_key = ? AND size_key = ? AND is_active = 1 LIMIT 1",
        [parsed.model_key, parsed.size_key]
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
      const [configs] = await connection.execute(
        "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
        [order.model]
      );
      if (!configs.length) throw new Error("Challenge config not found for model: " + order.model);
      const config = configs[0];
      startingBalanceCents = Number(config.starting_balance_cents);

      if (order.model === "prototype_5k") {
        initialPhase = "FUNDED";
      } else {
        initialPhase = "PHASE_1";
      }
    }

    const code = accountCode();
    await connection.execute(
      `INSERT INTO accounts
       (account_code,user_id,challenge_model,phase,initial_balance_cents,balance_cents,equity_cents,day_start_balance_cents,day_start_equity_cents,equity_hwm_cents,status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [code, order.user_id, resolvedModel, initialPhase, startingBalanceCents, startingBalanceCents, startingBalanceCents, startingBalanceCents, startingBalanceCents, startingBalanceCents]
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
        [affiliateId, order.id, order.request_id, order.affiliate_code, order.model, order.original_amount_cents || 0, order.discount_amount_cents || 0, order.final_amount_cents || 0, commissionCents]
      );
    }

    await connection.execute(
      "UPDATE payment_requests SET account_code = ?, updated_at = NOW() WHERE id = ?",
      [code, order.id]
    );
    return code;
  }



  app.post("/api/admin/payment-requests/:id/mark-link-sent", authenticateAdmin, async (req, res) => {
    const link = String(req.body?.razorpay_link || "").trim();
    if (!validPaymentLink(link)) return res.status(400).json({ error: "Enter a valid HTTPS Razorpay payment link (rzp.io)." });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT pr.*, u.email AS user_email, u.legal_name
         FROM payment_requests pr LEFT JOIN users u ON u.id = pr.user_id
         WHERE pr.id = ? FOR UPDATE`,
        [req.params.id]
      );
      if (!rows.length) throw new Error("Payment request not found");
      const request = rows[0];
      if (!["REQUESTED", "LINK_SENT", "PAYMENT_PENDING"].includes(String(request.status))) throw new Error(`Payment link cannot be changed from ${request.status}.`);
      await connection.execute("UPDATE payment_requests SET razorpay_link = ?, status = 'LINK_SENT', updated_at = NOW() WHERE id = ?", [link, request.id]);
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

  async function listPaymentRequests(req, res) {
    try {
      const status = String(req.query.status || "").trim();
      const search = String(req.query.request_id || req.query.request_ref || req.query.razorpay_link || "").trim();
      const where = [], params = [];
      if (status) { where.push("pr.status = ?"); params.push(status); }
      if (search) {
        where.push("(pr.request_id LIKE ? OR pr.razorpay_link LIKE ? OR u.email LIKE ? OR u.legal_name LIKE ? OR pr.model LIKE ? OR pr.affiliate_code LIKE ?)");
        for (let i = 0; i < 6; i++) params.push(`%${search}%`);
      }
      const sql = `SELECT pr.*, u.legal_name, u.email AS user_email, a.legal_name AS affiliate_name
                   FROM payment_requests pr
                   LEFT JOIN users u ON pr.user_id = u.id
                   LEFT JOIN users a ON pr.affiliate_id = a.id
                   ${where.length ? "WHERE " + where.join(" AND ") : ""}
                   ORDER BY pr.created_at DESC`;
      const [requests] = await db.execute(sql, params);
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, requests, orders: requests });
    } catch (error) {
      console.error("Admin payment request fetch failed:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // Canonical endpoint.
  app.get("/api/admin/payment-requests", authenticateAdmin, listPaymentRequests);
  // Compatibility endpoint for any cached/older admin JS. It still reads payment_requests.
  app.get("/api/admin/payment-orders", authenticateAdmin, listPaymentRequests);

  app.post("/api/admin/payment-requests/:id/status", authenticateAdmin, async (req, res) => {
    const requested = String(req.body?.status || "").trim().toUpperCase();
    const nextStatus = requested;
    if (!["REQUESTED", "PAYMENT_PENDING", "PAYMENT_DONE", "REJECTED", "CANCELLED"].includes(nextStatus)) return res.status(400).json({ error: "Allowed payment statuses are REQUESTED, PAYMENT_PENDING, PAYMENT_DONE, REJECTED or CANCELLED." });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT * FROM payment_requests WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!rows.length) throw new Error("Payment request not found");
      const request = rows[0];
      if (!["LINK_SENT", "PAYMENT_PENDING", "PAYMENT_DONE", "CANCELLED"].includes(String(request.status))) throw new Error(`Payment outcome cannot be set from ${request.status}`);
      if (request.status === "CANCELLED" && nextStatus === "PAYMENT_DONE") throw new Error("A cancelled payment cannot be marked done.");
      let code = request.account_code || null;
      if (nextStatus === "PAYMENT_DONE") code = await createAccountAndCommission(connection, request);
      await connection.execute("UPDATE payment_requests SET status = ?, paid_amount_cents = ?, updated_at = NOW() WHERE id = ?", [nextStatus, nextStatus === "PAYMENT_DONE" ? Number(request.final_amount_cents || 0) : 0, request.id]);
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
