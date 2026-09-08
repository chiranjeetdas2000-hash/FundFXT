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

async function ensureCommissionTable() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS affiliate_commissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    affiliate_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    referred_user_id BIGINT NULL,
    model VARCHAR(64) NULL,
    commission_amount_cents BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_affiliate_order (affiliate_id, order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function reconcileAffiliateCommissions() {
  try {
    if (!(await tableExists('payment_orders')) || !(await tableExists('affiliates')) || !(await tableExists('users'))) {
      return { checked: 0, credited: 0, reason: 'Required affiliate/payment tables are not present' };
    }

    await ensureCommissionTable();
    const [orders] = await pool.execute(`
      SELECT po.id AS order_id,
             po.user_id AS customer_user_id,
             po.affiliate_code,
             po.model,
             po.final_amount_cents,
             po.status,
             po.order_ref
      FROM payment_orders po
      WHERE UPPER(po.status) IN (${[...SUCCESS_STATUSES].map(() => '?').join(',')})
        AND po.affiliate_code IS NOT NULL
        AND TRIM(po.affiliate_code) <> ''
    `, [...SUCCESS_STATUSES]);

    let credited = 0;
    for (const order of orders) {
      const paid = Number(order.final_amount_cents || 0);
      if (!Number.isFinite(paid) || paid <= 0) continue;

      const [affiliateRows] = await pool.execute(
        'SELECT a.id AS affiliate_id, a.user_id FROM affiliates a JOIN users u ON u.id = a.user_id WHERE u.affiliate_code = ? LIMIT 1',
        [String(order.affiliate_code).trim()]
      );
      if (!affiliateRows.length) continue;
      const affiliate = affiliateRows[0];

      const [existing] = await pool.execute(
        'SELECT id FROM affiliate_commissions WHERE affiliate_id = ? AND order_id = ? LIMIT 1',
        [affiliate.affiliate_id, order.order_id]
      );
      if (existing.length) continue;

      const commissionCents = Math.floor(paid * 0.20 + 100);
      await pool.execute(
        `INSERT INTO affiliate_commissions
          (affiliate_id, order_id, referred_user_id, model, commission_amount_cents, status)
         VALUES (?, ?, ?, ?, ?, 'PENDING')`,
        [affiliate.affiliate_id, order.order_id, order.customer_user_id || null, order.model || null, commissionCents]
      );
      await pool.execute(
        'UPDATE affiliates SET total_sales = total_sales + 1, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?',
        [commissionCents, affiliate.affiliate_id]
      );
      credited += 1;
    }

    return { checked: orders.length, credited };
  } catch (error) {
    console.error('FundFXT affiliate reconciliation error:', error.message);
    return { checked: 0, credited: 0, error: error.message };
  }
}

module.exports = { reconcileAffiliateCommissions, pool };