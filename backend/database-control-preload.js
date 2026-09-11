const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const originalListen = express.application.listen;
let installed = false;

function quoteIdentifier(value) {
  return "`" + String(value).replace(/`/g, "``") + "`";
}

function validIdentifier(value) {
  return /^[A-Za-z0-9_$-]+$/.test(String(value || ""));
}

function installDatabaseControl(app) {
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

  function authenticateDatabaseAdmin(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No admin token" });
    jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
      if (err || !decoded?.adminId) {
        return res.status(403).json({ error: "Invalid admin token" });
      }
      req.adminId = decoded.adminId;
      req.adminRole = decoded.role;
      next();
    });
  }

  async function getTableMeta(table) {
    if (!validIdentifier(table)) throw new Error("Invalid table name");
    const [tables] = await db.execute(
      "SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, CREATE_TIME, UPDATE_TIME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
      [table],
    );
    if (!tables.length) throw new Error("Table not found");
    const [columns] = await db.execute(
      `SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [table],
    );
    return { table: tables[0], columns };
  }

  app.get("/api/admin/database/tables", authenticateDatabaseAdmin, async (req, res) => {
    try {
      const [tables] = await db.execute(
        `SELECT t.TABLE_NAME AS name, t.TABLE_TYPE AS type, t.ENGINE AS engine,
                t.TABLE_ROWS AS estimated_rows, t.CREATE_TIME AS created_at,
                t.UPDATE_TIME AS updated_at,
                (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c
                 WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME) AS column_count
         FROM INFORMATION_SCHEMA.TABLES t
         WHERE t.TABLE_SCHEMA = DATABASE()
         ORDER BY t.TABLE_NAME ASC`,
      );
      res.json({ success: true, database: process.env.DB_NAME, tables });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/database/tables/:table/schema", authenticateDatabaseAdmin, async (req, res) => {
    try {
      const meta = await getTableMeta(req.params.table);
      const [indexes] = await db.execute(
        `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [req.params.table],
      );
      res.json({ success: true, ...meta, indexes });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/admin/database/tables/:table/rows", authenticateDatabaseAdmin, async (req, res) => {
    try {
      const table = req.params.table;
      const meta = await getTableMeta(table);
      const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
      const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 50, 1), 200);
      const search = String(req.query.search || "").trim();
      const where = [];
      const params = [];

      if (search) {
        const searchable = meta.columns.slice(0, 40);
        where.push("(" + searchable.map((c) => `CAST(${quoteIdentifier(c.COLUMN_NAME)} AS CHAR) LIKE ?`).join(" OR ") + ")");
        searchable.forEach(() => params.push(`%${search}%`));
      }

      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
      const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}${whereSql}`,
        params,
      );
      const total = Number(countRows[0]?.total || 0);
      const offset = (page - 1) * pageSize;
      const [rows] = await db.execute(
        `SELECT * FROM ${quoteIdentifier(table)}${whereSql} ORDER BY 1 DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      );

      res.json({
        success: true,
        table: meta.table,
        columns: meta.columns,
        rows,
        page,
        pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/admin/database/tables/:table/rows", authenticateDatabaseAdmin, async (req, res) => {
    try {
      const table = req.params.table;
      const meta = await getTableMeta(table);
      const input = req.body?.data;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return res.status(400).json({ error: "data object is required" });
      }
      const allowed = new Set(meta.columns.map((c) => c.COLUMN_NAME));
      const entries = Object.entries(input).filter(([key]) => allowed.has(key));
      if (!entries.length) return res.status(400).json({ error: "No valid columns supplied" });
      const names = entries.map(([key]) => quoteIdentifier(key)).join(", ");
      const placeholders = entries.map(() => "?").join(", ");
      const values = entries.map(([, value]) => value === "" ? null : value);
      const [result] = await db.execute(
        `INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders})`,
        values,
      );
      res.json({ success: true, insertId: result.insertId });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/admin/database/tables/:table/rows/:id", authenticateDatabaseAdmin, async (req, res) => {
    try {
      const table = req.params.table;
      const meta = await getTableMeta(table);
      const primary = meta.columns.filter((c) => c.COLUMN_KEY === "PRI");
      if (primary.length !== 1) return res.status(400).json({ error: "Edit requires exactly one primary key column" });
      const pk = primary[0].COLUMN_NAME;
      const input = req.body?.data;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return res.status(400).json({ error: "data object is required" });
      }
      const allowed = new Set(meta.columns.map((c) => c.COLUMN_NAME));
      const entries = Object.entries(input).filter(([key]) => allowed.has(key) && key !== pk);
      if (!entries.length) return res.status(400).json({ error: "No editable columns supplied" });
      const setSql = entries.map(([key]) => `${quoteIdentifier(key)} = ?`).join(", ");
      const values = entries.map(([, value]) => value === "" ? null : value);
      values.push(req.params.id);
      const [result] = await db.execute(
        `UPDATE ${quoteIdentifier(table)} SET ${setSql} WHERE ${quoteIdentifier(pk)} = ? LIMIT 1`,
        values,
      );
      res.json({ success: true, affectedRows: result.affectedRows });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/admin/database/tables/:table/rows/:id", authenticateDatabaseAdmin, async (req, res) => {
    try {
      const table = req.params.table;
      const meta = await getTableMeta(table);
      const primary = meta.columns.filter((c) => c.COLUMN_KEY === "PRI");
      if (primary.length !== 1) return res.status(400).json({ error: "Delete requires exactly one primary key column" });
      const pk = primary[0].COLUMN_NAME;
      const [result] = await db.execute(
        `DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(pk)} = ? LIMIT 1`,
        [req.params.id],
      );
      res.json({ success: true, affectedRows: result.affectedRows });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  console.log("Database Control API registered");
}

express.application.listen = function (...args) {
  installDatabaseControl(this);
  return originalListen.apply(this, args);
};
