const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const originalListen = express.application.listen;
let installed = false;

function installPaymentFlow(app) {
  if (installed) return;
  installed = true;
  const db = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT), waitForConnections: true, connectionLimit: 5, ssl: { rejectUnauthorized: false } });

  function authenticateAdmin(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No admin token" });
    jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
      if (err || !decoded?.adminId) return res.status(403).json({ error: "Invalid admin token" });
      req.adminId = decoded.adminId; req.adminRole = decoded.role; next();
    });
  }

  function validPaymentLink(value) {
    try {
      const u = new URL(String(value || "").trim());
      return u.protocol === "https:" && /(^|\.)rzp\.io$/i.test(u.hostname);
    } catch { return false; }
  }

  function makeAccountCode() {
    return "ACC-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  }

  async function sendPaymentLinkEmail(to, order, link) {
    const key = process.env.EMAIL_PASS;
    if (!key || !to) return { sent: false, reason: "email_not_configured" };
    const from = process.env.EMAIL_USER || "onboarding@resend.dev";
    const amount = (Number(order.final_amount_cents || 0) / 100).toFixed(2);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `FundFXT payment link — ${order.request_id}`, html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>FundFXT Payment</h2><p>Your payment request <b>${order.request_id}</b> is ready.</p><p>Challenge: <b>${order.model}</b></p><p>Payable: <b>${amount} ${order.currency}</b></p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#00b56a;color:#fff;text-decoration:none;border-radius:8px">Pay Now</a></p></div>` })
    });
    if (!response.ok) throw new Error("Email API Error: " + response.status);
    return { sent: true };
  }

  async function upsertAffiliateSale(connection, order, status) {
    if (!order.affiliate_code || !String(order.affiliate_code).trim()) return;
    const [affiliateRows] = await connection.execute("SELECT id FROM affiliates WHERE affiliate_code = ? LIMIT 1", [String(order.affiliate_code).trim()]);
    if (!affiliateRows.length) return;
    const affiliateId = affiliateRows[0].id;
    const original = Number(order.original_amount_cents || 0);
    const discount = Number(order.discount_amount_cents || 0);
    const finalAmount = Number(order.final_amount_cents || 0);
    const commissionRate = 2000;
    const fixedBonus = 100;
    const commissionTotal = Math.floor(finalAmount * commissionRate / 10000 + fixedBonus);
    await connection.execute(`INSERT INTO affiliate_sales (affiliate_id, order_id, request_id, affiliate_code, model, original_amount_cents, discount_amount_cents, final_amount_cents, commission_rate_bps, fixed_bonus_cents, commission_amount_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE request_id=VALUES(request_id), affiliate_code=VALUES(affiliate_code), model=VALUES(model), original_amount_cents=VALUES(original_amount_cents), discount_amount_cents=VALUES(discount_amount_cents), final_amount_cents=VALUES(final_amount_cents), commission_rate_bps=VALUES(commission_rate_bps), fixed_bonus_cents=VALUES(fixed_bonus_cents), commission_amount_cents=VALUES(commission_amount_cents), status=VALUES(status)`, [affiliateId, order.id, order.request_id, order.affiliate_code, order.model, original, discount, finalAmount, commissionRate, fixedBonus, commissionTotal, status]);
  }

  async function createAccountAndCommission(connection, order) {
    if (order.account_code) return order.account_code;
    const [configs] = await connection.execute("SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1", [order.model]);
    if (!configs.length) throw new Error("Challenge config not found for model: " + order.model);
    const config = configs[0];
    const accountCode = makeAccountCode();
    await connection.execute(`INSERT INTO accounts (account_code,user_id,challenge_model,phase,initial_balance_cents,balance_cents,equity_cents,status) VALUES (?, ?, ?, 'PHASE_1', ?, ?, ?, 'ACTIVE')`, [accountCode, order.user_id, order.model, config.starting_balance_cents, config.starting_balance_cents, config.starting_balance_cents]);

    if (order.affiliate_code) {
      const [affiliateRows] = await connection.execute("SELECT a.id AS affiliate_id FROM affiliates a JOIN users u ON u.id = a.user_id WHERE u.affiliate_code = ? LIMIT 1", [order.affiliate_code]);
      if (affiliateRows.length) {
        const affiliateId = affiliateRows[0].affiliate_id;
        const commissionCents = Math.floor(Number(order.final_amount_cents || 0) * 0.20 + 100);
        const [existing] = await connection.execute("SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1", [order.id]);
        if (!existing.length) {
          await connection.execute(`INSERT INTO affiliate_commissions (affiliate_id,order_id,referred_user_id,model,commission_amount_cents,original_amount_cents,discount_amount_cents,final_amount_cents,commission_rate_bps,fixed_bonus_cents,paid_amount_cents,status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2000, 100, ?, 'PENDING')`, [affiliateId, order.id, order.user_id, order.model, commissionCents, order.original_amount_cents || 0, order.discount_amount_cents || 0, order.final_amount_cents || 0, order.paid_amount_cents || order.final_amount_cents || 0]);
          await connection.execute(`UPDATE affiliates SET total_sales = COALESCE(total_sales,0)+1, total_earnings_cents = COALESCE(total_earnings_cents,0)+?, pending_earnings_cents = COALESCE(pending_earnings_cents,0)+? WHERE id = ?`, [commissionCents, commissionCents, affiliateId]);
        }
      }
    }
    await upsertAffiliateSale(connection, order, "PAYMENT_DONE");
    await connection.execute("UPDATE payment_orders SET account_code = ?, updated_at = NOW() WHERE id = ?", [accountCode, order.id]);
    return accountCode;
  }

  app.post("/api/admin/payment-requests/:id/mark-link-sent", authenticateAdmin, async (req, res) => {
    const link = String(req.body?.razorpay_link || "").trim();
    if (!validPaymentLink(link)) return res.status(400).json({ error: "Enter a valid HTTPS Razorpay payment link (rzp.io)." });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.execute(`SELECT po.*, u.email AS user_email, u.legal_name FROM payment_orders po JOIN users u ON u.id = po.user_id WHERE po.id = ? FOR UPDATE`, [req.params.id]);
      if (!orders.length) { await connection.rollback(); return res.status(404).json({ error: "Payment request not found" }); }
      const order = orders[0];
      if (!["REQUESTED", "LINK_SENT", "PAYMENT_PENDING"].includes(String(order.status))) { await connection.rollback(); return res.status(400).json({ error: `Payment link cannot be changed from ${order.status}.` }); }
      await connection.execute("UPDATE payment_orders SET razorpay_link = ?, status = 'LINK_SENT', updated_at = NOW() WHERE id = ?", [link, order.id]);
      await upsertAffiliateSale(connection, order, "LINK_SENT");
      await connection.commit();
      let emailResult = { sent: false, reason: "not_attempted" };
      try { emailResult = await sendPaymentLinkEmail(order.user_email, order, link); } catch (emailError) { console.error("Payment link customer email failed:", emailError.message); emailResult = { sent: false, reason: emailError.message }; }
      res.json({ success: true, status: "LINK_SENT", emailed_to: emailResult.sent ? order.user_email : null, email_sent: emailResult.sent, email_error: emailResult.sent ? null : emailResult.reason });
    } catch (error) { try { await connection.rollback(); } catch {} console.error("Mark payment link sent failed:", error); res.status(500).json({ error: error.message }); }
    finally { connection.release(); }
  });

  app.get("/api/admin/payment-orders", authenticateAdmin, async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const search = String(req.query.request_id || req.query.request_ref || req.query.razorpay_link || "").trim();
      const where = [], params = [];
      if (status) { where.push("po.status = ?"); params.push(status); }
      if (search) { where.push("(po.request_id LIKE ? OR po.razorpay_link LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
      const sql = `SELECT po.*, u.legal_name, u.email AS user_email, a.legal_name AS affiliate_name FROM payment_orders po JOIN users u ON po.user_id = u.id LEFT JOIN users a ON po.affiliate_id = a.id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY po.created_at DESC`;
      const [orders] = await db.execute(sql, params);
      res.json({ success: true, orders });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/admin/payment-orders/:id/status", authenticateAdmin, async (req, res) => {
    const requested = String(req.body?.status || "").trim().toUpperCase();
    const nextStatus = requested === "CANCELLED" || requested === "REJECTED" || requested === "PAYMENT_CANCELLED" ? "PAYMENT_CANCELLED" : requested === "PAYMENT_APPROVED" || requested === "PAYMENT_DONE" ? "PAYMENT_DONE" : requested;
    if (!["PAYMENT_CANCELLED", "PAYMENT_DONE"].includes(nextStatus)) return res.status(400).json({ error: "Allowed payment outcomes are PAYMENT_CANCELLED or PAYMENT_DONE." });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.execute("SELECT * FROM payment_orders WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!orders.length) throw new Error("Order not found");
      const order = orders[0];
      if (!["LINK_SENT", "PAYMENT_PENDING", "PAYMENT_DONE", "PAYMENT_CANCELLED"].includes(String(order.status))) throw new Error(`Payment outcome cannot be set from ${order.status}`);
      if (order.status === "PAYMENT_CANCELLED" && nextStatus === "PAYMENT_DONE") throw new Error("A cancelled payment cannot be marked done.");
      let accountCode = order.account_code || null;
      if (nextStatus === "PAYMENT_DONE") accountCode = await createAccountAndCommission(connection, order);
      if (nextStatus === "PAYMENT_CANCELLED") await upsertAffiliateSale(connection, order, "PAYMENT_CANCELLED");
      await connection.execute("UPDATE payment_orders SET status = ?, paid_amount_cents = ?, updated_at = NOW() WHERE id = ?", [nextStatus, nextStatus === "PAYMENT_DONE" ? (order.final_amount_cents || 0) : 0, order.id]);
      await connection.commit();
      res.json({ success: true, status: nextStatus, account_code: accountCode });
    } catch (error) { try { await connection.rollback(); } catch {} console.error("Payment status transaction failed:", error); res.status(500).json({ error: error.message }); }
    finally { connection.release(); }
  });

  console.log("Payment Flow API registered");
}

express.application.listen = function (...args) { installPaymentFlow(this); return originalListen.apply(this, args); };
