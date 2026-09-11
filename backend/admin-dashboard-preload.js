const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const originalListen = express.application.listen;
let installed = false;

function installDashboard(app) {
  if (installed) return;
  installed = true;
  const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 5,
    ssl: { rejectUnauthorized: false },
  });

  function authenticateAdmin(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No admin token" });
    jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
      if (err || !decoded?.adminId) return res.status(403).json({ error: "Invalid admin token" });
      req.adminId = decoded.adminId;
      next();
    });
  }

  app.get("/api/admin/dashboard-stats", authenticateAdmin, async (_req, res) => {
    try {
      const [[payments]] = await db.query(`SELECT COUNT(*) AS total FROM payment_requests WHERE DATE(created_at)=CURDATE()`);
      const [[withdrawals]] = await db.query(`SELECT COUNT(*) AS total FROM withdrawal_request WHERE DATE(created_at)=CURDATE()`);
      const [[passed]] = await db.query(`SELECT COUNT(*) AS total FROM accounts WHERE DATE(created_at)=CURDATE() AND status='PASSED'`);
      const [[failed]] = await db.query(`SELECT COUNT(*) AS total FROM accounts WHERE DATE(created_at)=CURDATE() AND status IN ('BREACHED','EXPIRED','CLOSED')`);
      const [[revenue]] = await db.query(`SELECT COALESCE(SUM(final_amount_cents),0) AS total FROM payment_requests WHERE status='PAYMENT_DONE'`);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        success: true,
        stats: {
          payment_requests_today: Number(payments?.total || 0),
          withdrawal_requests_today: Number(withdrawals?.total || 0),
          passed_accounts_today: Number(passed?.total || 0),
          failed_accounts_today: Number(failed?.total || 0),
          successful_revenue_cents: Number(revenue?.total || 0),
        },
      });
    } catch (error) {
      console.error("Admin dashboard stats failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  console.log("Admin Dashboard API registered");
}

express.application.listen = function (...args) {
  installDashboard(this);
  return originalListen.apply(this, args);
};
