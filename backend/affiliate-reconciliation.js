// FundFXT affiliate commission reconciliation.
// Rule: commission = customer-paid amount * 20% + $1, only after a successful payment/account creation state.
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 4,
  ssl: { rejectUnauthorized: false }
});

const SUCCESS_STATUSES = new Set([
  'PAYMENT_DONE', 'PAYMENT_APPROVED', 'ACCOUNT_CREATED', 'ACCOUNT_PROVIDED',
  'PAID', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED'
]);

async function tableExists(name) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [name]
  );
  return Number(rows[0]?.n || 0) > 0;
}

async function columns(table) {
  const [rows] = await pool.execute(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    [table]
  );
  return new Set(rows.map(r => String(r.column_name)));
}

async function ensureLedger() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS affiliate_commissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    affiliate_user_id BIGINT NOT NULL,
    affiliate_code VARCHAR(128) NULL,
    customer_user_id BIGINT NULL,
    order_id BIGINT NULL,
    order_ref VARCHAR(128) NULL,
    model VARCHAR(64) NULL,
    paid_amount_cents BIGINT NOT NULL,
    commission_cents BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
    source VARCHAR(32) NOT NULL DEFAULT 'RECONCILIATION',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_affiliate_order (affiliate_user_id, order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

function pick(cols, names) {
  return names.find(n => cols.has(n)) || null;
}

function sqlIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

async function reconcileAffiliateCommissions() {
  try {
    if (!(await tableExists('users'))) return { checked: 0, credited: 0 };
    const orderTable = ['payment_orders', 'payment_requests', 'orders', 'challenge_orders']
      .find(asyncName => false);
    let ordersTable = null;
    for (const candidate of ['payment_orders', 'payment_requests', 'orders', 'challenge_orders']) {
      if (await tableExists(candidate)) { ordersTable = candidate; break; }
    }
    if (!ordersTable) return { checked: 0, credited: 0 };

    await ensureLedger();
    const cols = await columns(ordersTable);
    const userCols = await columns('users');
    const idCol = pick(cols, ['id', 'order_id']);
    const statusCol = pick(cols, ['status', 'payment_status']);
    const amountCol = pick(cols, ['final_amount_cents', 'paid_amount_cents', 'amount_cents', 'price_cents', 'total_cents']);
    const userIdCol = pick(cols, ['user_id', 'customer_id']);
    const affiliateCol = pick(cols, ['affiliate_code', 'referred_by_code', 'referral_code']);
    const modelCol = pick(cols, ['model', 'challenge_model']);
    const refCol = pick(cols, ['order_ref', 'order_code', 'reference']);
    if (!idCol || !amountCol || !statusCol) return { checked: 0, credited: 0 };

    const select = [
      `o.${sqlIdent(idCol)} AS order_id`,
      `o.${sqlIdent(amountCol)} AS paid_amount_cents`,
      `o.${sqlIdent(statusCol)} AS order_status`,
      userIdCol ? `o.${sqlIdent(userIdCol)} AS customer_user_id` : 'NULL AS customer_user_id',
      affiliateCol ? `o.${sqlIdent(affiliateCol)} AS order_affiliate_code` : 'NULL AS order_affiliate_code',
      modelCol ? `o.${sqlIdent(modelCol)} AS model` : 'NULL AS model',
      refCol ? `o.${sqlIdent(refCol)} AS order_ref` : 'NULL AS order_ref'
    ];
    const join = userIdCol && userCols.has('id') ? ` LEFT JOIN users u ON u.id = o.${sqlIdent(userIdCol)}` : '';
    const customerReferral = userCols.has('referred_by_code') ? 'u.referred_by_code' : 'NULL';
    select.push(`${customerReferral} AS customer_affiliate_code`);

    const [orders] = await pool.execute(`SELECT ${select.join(', ')} FROM ${sqlIdent(ordersTable)} o${join} WHERE UPPER(o.${sqlIdent(statusCol)}) IN (${[...SUCCESS_STATUSES].map(() => '?').join(',')})`, [...SUCCESS_STATUSES]);

    let credited = 0;
    for (const o of orders) {
      const affiliateCode = String(o.order_affiliate_code || o.customer_affiliate_code || '').trim();
      const paid = Number(o.paid_amount_cents || 0);
      if (!affiliateCode || !Number.isFinite(paid) || paid <= 0) continue;

      const [affRows] = await pool.execute('SELECT id, affiliate_code FROM users WHERE affiliate_code = ? LIMIT 1', [affiliateCode]);
      if (!affRows.length) continue;
      const affiliate = affRows[0];
      const commission = Math.round(paid * 0.20) + 100;

      const [result] = await pool.execute(
        `INSERT IGNORE INTO affiliate_commissions
          (affiliate_user_id, affiliate_code, customer_user_id, order_id, order_ref, model, paid_amount_cents, commission_cents, status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', 'RECONCILIATION')`,
        [affiliate.id, affiliate.affiliate_code || affiliateCode, o.customer_user_id || null, o.order_id, o.order_ref || null, o.model || null, Math.round(paid), commission]
      );
      if (result.affectedRows) credited += 1;
    }
    return { checked: orders.length, credited };
  } catch (error) {
    console.error('FundFXT affiliate reconciliation error:', error.message);
    return { checked: 0, credited: 0, error: error.message };
  }
}

module.exports = { reconcileAffiliateCommissions, pool };