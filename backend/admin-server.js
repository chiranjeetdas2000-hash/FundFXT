const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || process.env.ADMIN_SERVER_PORT || 10001);
app.use(express.json({ limit: '2mb' }));
app.use(cors());

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
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Admin token required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!(decoded.isAdmin || decoded.admin || decoded.role === 'ADMIN' || decoded.role === 'SUPER_ADMIN' || decoded.adminId || decoded.admin_id)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.admin = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_$]+$/.test(value)) throw new Error('Invalid identifier');
  return `\`${value}\``;
}

function tableName(value) {
  return quoteIdentifier(String(value));
}

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ success: true, database: process.env.DB_NAME || null, status: 'connected' });
  } catch (e) {
    res.status(500).json({ success: false, status: 'disconnected', error: e.message });
  }
});

app.use('/api/admin/db', authenticateAdmin);

app.get('/api/admin/db/overview', async (_req, res) => {
  try {
    const [[status]] = await db.query('SELECT DATABASE() AS database_name, VERSION() AS mysql_version');
    const [[tables]] = await db.query(`SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE()`);
    const [[size]] = await db.query(`SELECT COALESCE(SUM(data_length + index_length),0) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE()`);
    res.json({ success: true, database: status.database_name, mysql_version: status.mysql_version, table_count: Number(tables.table_count), database_size_bytes: Number(size.bytes || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/db/tables', async (_req, res) => {
  try {
    const [rows] = await db.query(`SELECT table_name, table_rows, data_length, index_length, engine FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`);
    res.json({ success: true, tables: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/db/tables/:table/schema', async (req, res) => {
  try {
    const table = String(req.params.table);
    const [rows] = await db.query(`SELECT ordinal_position, column_name, column_type, is_nullable, column_default, column_key, extra FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`, [table]);
    if (!rows.length) return res.status(404).json({ error: 'Table not found' });
    res.json({ success: true, table, columns: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/db/tables/:table/rows', async (req, res) => {
  try {
    const table = tableName(req.params.table);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = String(req.query.search || '').trim();
    const [columns] = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`, [req.params.table]);
    if (!columns.length) return res.status(404).json({ error: 'Table not found' });
    let where = '';
    const params = [];
    if (search) {
      const textColumns = columns.map(c => `CAST(${quoteIdentifier(c.column_name)} AS CHAR) LIKE ?`);
      where = `WHERE ${textColumns.join(' OR ')}`;
      params.push(...columns.map(() => `%${search}%`));
    }
    const [rows] = await db.query(`SELECT * FROM ${table} ${where} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM ${table} ${where}`, params);
    res.json({ success: true, rows, total: Number(count.total), limit, offset });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/admin/db/tables/:table/rows', async (req, res) => {
  try {
    const table = tableName(req.params.table);
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'data object required' });
    const keys = Object.keys(data);
    if (!keys.length) return res.status(400).json({ error: 'At least one field required' });
    const cols = keys.map(quoteIdentifier).join(', ');
    const marks = keys.map(() => '?').join(', ');
    const [result] = await db.execute(`INSERT INTO ${table} (${cols}) VALUES (${marks})`, keys.map(k => data[k]));
    res.json({ success: true, insertId: result.insertId });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/admin/db/tables/:table/rows', async (req, res) => {
  try {
    const table = tableName(req.params.table);
    const { key, value, data } = req.body || {};
    if (!key || value === undefined || !data || typeof data !== 'object') return res.status(400).json({ error: 'key, value and data are required' });
    const keys = Object.keys(data);
    if (!keys.length) return res.status(400).json({ error: 'No changes supplied' });
    const set = keys.map(k => `${quoteIdentifier(k)} = ?`).join(', ');
    const [result] = await db.execute(`UPDATE ${table} SET ${set} WHERE ${quoteIdentifier(key)} = ?`, [...keys.map(k => data[k]), value]);
    res.json({ success: true, affectedRows: result.affectedRows });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/db/tables/:table/rows', async (req, res) => {
  try {
    const table = tableName(req.params.table);
    const { key, value, confirm } = req.body || {};
    if (confirm !== true) return res.status(400).json({ error: 'Explicit confirmation required' });
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value are required' });
    const [result] = await db.execute(`DELETE FROM ${table} WHERE ${quoteIdentifier(key)} = ? LIMIT 1`, [value]);
    res.json({ success: true, affectedRows: result.affectedRows });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/admin/db/query', async (req, res) => {
  try {
    const sql = String(req.body?.sql || '').trim();
    const confirmWrite = req.body?.confirmWrite === true;
    if (!sql) return res.status(400).json({ error: 'SQL query required' });
    if (sql.includes(';') && sql.replace(/;\s*$/, '').includes(';')) return res.status(400).json({ error: 'Multiple SQL statements are not allowed' });
    const first = sql.match(/^([A-Za-z]+)/i)?.[1]?.toUpperCase();
    const readOnly = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(first);
    if (!readOnly && !confirmWrite) return res.status(403).json({ error: 'Write query requires confirmWrite=true' });
    const [rows, fields] = await db.query(sql);
    res.json({ success: true, readOnly, rows, fields: fields?.map(f => ({ name: f.name, type: f.type })) || [], affectedRows: rows?.affectedRows });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`FundFXT Admin DB Server running on port ${PORT}`));
