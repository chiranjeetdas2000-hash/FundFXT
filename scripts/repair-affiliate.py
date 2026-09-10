from pathlib import Path

FILE = Path('backend/server.js')
src = FILE.read_text(encoding='utf-8')


def replace_once(label, old, new):
    global src
    if old not in src:
        if new in src:
            return
        raise RuntimeError(f'Affiliate repair could not find: {label}')
    src = src.replace(old, new, 1)


old_commission = '''          const commissionCents = Math.floor(
            order.final_amount_cents * 0.2 + 100,
          );
          const [existingComm] = await connection.execute(
            "SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1",
            [id],
          );
          if (existingComm.length === 0) {
            await connection.execute(
              `INSERT INTO affiliate_commissions (affiliate_id, order_id, referred_user_id, model, commission_amount_cents, status) 
                         VALUES (?, ?, ?, ?, ?, 'PENDING')`,
              [
                affiliate.affiliate_id,
                id,
                order.user_id,
                order.model,
                commissionCents,
              ],
            );
            await connection.execute(
              `UPDATE affiliates SET total_sales = total_sales + 1, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?`,
              [commissionCents, affiliate.affiliate_id],
            );
          }'''

new_commission = '''          const commissionRateBps = 2000; // 20%
          const fixedBonusCents = 100; // $1.00
          const commissionCents = Math.floor(
            order.final_amount_cents * commissionRateBps / 10000 + fixedBonusCents,
          );
          const [existingComm] = await connection.execute(
            "SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1",
            [id],
          );
          if (existingComm.length === 0) {
            await connection.execute(
              `INSERT INTO affiliate_commissions (
                affiliate_id, order_id, referred_user_id, model,
                commission_amount_cents, original_amount_cents,
                discount_amount_cents, final_amount_cents, commission_rate_bps,
                fixed_bonus_cents, paid_amount_cents, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING')`,
              [
                affiliate.affiliate_id,
                id,
                order.user_id,
                order.model,
                commissionCents,
                order.original_amount_cents || 0,
                order.discount_amount_cents || 0,
                order.final_amount_cents || 0,
                commissionRateBps,
                fixedBonusCents,
              ],
            );
            await connection.execute(
              `UPDATE affiliates
               SET total_sales = total_sales + 1,
                   total_earnings_cents = COALESCE(total_earnings_cents, 0) + ?,
                   pending_earnings_cents = COALESCE(pending_earnings_cents, 0) + ?
               WHERE id = ?`,
              [commissionCents, commissionCents, affiliate.affiliate_id],
            );
          }'''
replace_once('commission ledger', old_commission, new_commission)

old_query = '''      `SELECT 
        ac.id,
        po.request_id AS order_ref,
        ac.model,
        po.paid_amount_cents,
        ac.commission_amount_cents AS commission_cents,
        ac.status,
        ac.created_at,
        u.legal_name AS customer_name
       FROM affiliate_commissions ac
       LEFT JOIN payment_orders po ON po.id = ac.order_id
       LEFT JOIN users u ON u.id = ac.referred_user_id
       WHERE ac.affiliate_id = ?
       ORDER BY ac.created_at DESC
       LIMIT 50`,'''

new_query = '''      `SELECT 
        ac.id,
        po.request_id AS order_ref,
        ac.model,
        po.original_amount_cents,
        po.discount_amount_cents,
        po.final_amount_cents,
        po.paid_amount_cents,
        ac.commission_amount_cents AS commission_cents,
        COALESCE(ac.paid_amount_cents, 0) AS paid_commission_cents,
        ac.commission_rate_bps,
        ac.fixed_bonus_cents,
        ac.status,
        ac.paid_at,
        ac.created_at,
        u.legal_name AS customer_name,
        u.email AS customer_email,
        po.affiliate_code
       FROM affiliate_commissions ac
       LEFT JOIN payment_orders po ON po.id = ac.order_id
       LEFT JOIN users u ON u.id = ac.referred_user_id
       WHERE ac.affiliate_id = ?
       ORDER BY ac.created_at DESC
       LIMIT 50`,'''
replace_once('dashboard commission query', old_query, new_query)

old_totals = '''    const totalEarnings = commissions.reduce(
      (sum, c) => sum + Number(c.commission_cents || 0), 0
    );
    const pendingEarnings = commissions
      .filter(c => String(c.status).toUpperCase() === 'PENDING')
      .reduce((sum, c) => sum + Number(c.commission_cents || 0), 0);'''

new_totals = '''    const [commissionTotals] = await db.execute(
      `SELECT
        COALESCE(SUM(commission_amount_cents), 0) AS total_earnings_cents,
        COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents, 0), 0)), 0) AS pending_earnings_cents,
        COALESCE(SUM(COALESCE(paid_amount_cents, 0)), 0) AS paid_earnings_cents
       FROM affiliate_commissions
       WHERE affiliate_id = ?`,
      [affiliate.id]
    );
    const totalEarnings = Number(commissionTotals[0]?.total_earnings_cents || 0);
    const pendingEarnings = Number(commissionTotals[0]?.pending_earnings_cents || 0);
    const paidEarnings = Number(commissionTotals[0]?.paid_earnings_cents || 0);'''
replace_once('dashboard totals', old_totals, new_totals)

old_response = '''      total_earnings_cents: totalEarnings,
      available_earnings_cents: pendingEarnings,
      commissions: commissions'''
new_response = '''      total_earnings_cents: totalEarnings,
      available_earnings_cents: pendingEarnings,
      pending_earnings_cents: pendingEarnings,
      paid_earnings_cents: paidEarnings,
      commissions: commissions'''
replace_once('dashboard response', old_response, new_response)

old_paid = '''      // If PAID, mark associated commissions as PAID
      if (status === "PAID") {
        await db.execute(
          `UPDATE affiliate_commissions SET status = 'PAID' 
                 WHERE affiliate_id = (SELECT id FROM affiliates WHERE user_id = ?) 
                 AND status = 'PENDING'`,
          [payout.user_id],
        );
        // Update affiliate paid earnings
        await db.execute(
          `UPDATE affiliates SET paid_earnings_cents = paid_earnings_cents + ? WHERE user_id = ?`,
          [payout.amount_cents, payout.user_id],
        );
      }'''

new_paid = '''      // If PAID, allocate this payout against the oldest unpaid commission balances.
      if (status === "PAID") {
        let remaining = Number(payout.amount_cents || 0);
        const [pendingCommissions] = await db.execute(
          `SELECT id, commission_amount_cents, COALESCE(paid_amount_cents, 0) AS paid_amount_cents
           FROM affiliate_commissions
           WHERE affiliate_id = (SELECT id FROM affiliates WHERE user_id = ?)
             AND status IN ('PENDING', 'PARTIALLY_PAID')
           ORDER BY created_at ASC, id ASC`,
          [payout.user_id],
        );

        for (const commission of pendingCommissions) {
          if (remaining <= 0) break;
          const outstanding = Math.max(
            0,
            Number(commission.commission_amount_cents || 0) -
              Number(commission.paid_amount_cents || 0),
          );
          if (!outstanding) continue;
          const allocation = Math.min(remaining, outstanding);
          const newPaid = Number(commission.paid_amount_cents || 0) + allocation;
          const newStatus = newPaid >= Number(commission.commission_amount_cents || 0)
            ? 'PAID'
            : 'PARTIALLY_PAID';

          await db.execute(
            `UPDATE affiliate_commissions
             SET paid_amount_cents = ?, status = ?, paid_at = CASE WHEN ? = 'PAID' THEN NOW() ELSE paid_at END
             WHERE id = ?`,
            [newPaid, newStatus, newStatus, commission.id],
          );
          remaining -= allocation;
        }

        await db.execute(
          `UPDATE affiliates SET paid_earnings_cents = COALESCE(paid_earnings_cents, 0) + ? WHERE user_id = ?`,
          [Number(payout.amount_cents || 0) - remaining, payout.user_id],
        );
      }'''
replace_once('partial payout handling', old_paid, new_paid)

marker = '// ========== AFFILIATE SCHEMA SELF-HEAL =========='
if marker not in src:
    migration = '''
// ========== AFFILIATE SCHEMA SELF-HEAL ==========
async function ensureAffiliateSchema() {
  const addColumnIfMissing = async (table, column, definition) => {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if (!Number(rows[0]?.n)) {
      await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  };

  await addColumnIfMissing('affiliates', 'total_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliates', 'pending_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliates', 'paid_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'original_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'discount_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'final_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'commission_rate_bps', 'INT NOT NULL DEFAULT 2000');
  await addColumnIfMissing('affiliate_commissions', 'fixed_bonus_cents', 'BIGINT NOT NULL DEFAULT 100');
  await addColumnIfMissing('affiliate_commissions', 'paid_amount_cents', 'BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('affiliate_commissions', 'paid_at', 'DATETIME NULL');

  await db.execute(
    `UPDATE affiliate_commissions
     SET paid_amount_cents = commission_amount_cents, paid_at = COALESCE(paid_at, created_at)
     WHERE status = 'PAID' AND COALESCE(paid_amount_cents, 0) = 0`
  );

  await db.execute(
    `UPDATE affiliate_commissions ac
     JOIN payment_orders po ON po.id = ac.order_id
     SET ac.original_amount_cents = COALESCE(po.original_amount_cents, 0),
         ac.discount_amount_cents = COALESCE(po.discount_amount_cents, 0),
         ac.final_amount_cents = COALESCE(po.final_amount_cents, 0)
     WHERE COALESCE(ac.final_amount_cents, 0) = 0`
  );

  await db.execute(
    `UPDATE affiliates a
     LEFT JOIN (
       SELECT affiliate_id,
              COUNT(*) AS sales,
              COALESCE(SUM(commission_amount_cents), 0) AS total_earnings,
              COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents, 0), 0)), 0) AS pending_earnings,
              COALESCE(SUM(COALESCE(paid_amount_cents, 0)), 0) AS paid_earnings
       FROM affiliate_commissions
       GROUP BY affiliate_id
     ) c ON c.affiliate_id = a.id
     SET a.total_sales = COALESCE(c.sales, 0),
         a.total_earnings_cents = COALESCE(c.total_earnings, 0),
         a.pending_earnings_cents = COALESCE(c.pending_earnings, 0),
         a.paid_earnings_cents = COALESCE(c.paid_earnings, 0)`
  );

  console.log('Affiliate schema/ledger repair completed');
}
'''
    replace_once('schema insertion', '// ========== AFFILIATE STATS (Frontend Dashboard) ==========', migration + '\n// ========== AFFILIATE STATS (Frontend Dashboard) ==========')

old_start = '''const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`),
);'''
new_start = '''const PORT = process.env.PORT || 3000;
let server;
(async () => {
  try {
    await ensureAffiliateSchema();
  } catch (migrationError) {
    console.error('Affiliate schema repair failed:', migrationError.message);
  }
  server = app.listen(PORT, () =>
    console.log(`🚀 Server running on port ${PORT}`),
  );
})();'''
replace_once('server startup', old_start, new_start)

FILE.write_text(src, encoding='utf-8')
print('Affiliate backend repair applied successfully.')
