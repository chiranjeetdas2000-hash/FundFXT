from pathlib import Path
import re

p = Path('backend/server.js')
s = p.read_text(encoding='utf-8')

# 1) Create a privacy-safe affiliate sales ledger + historical backfill.
marker = '// ========== AFFILIATE CODE GENERATOR =========='
if 'CREATE TABLE IF NOT EXISTS affiliate_sales' not in s:
    block = r'''
// ========== AFFILIATE SALES LEDGER ==========
// Public affiliate history contains only sale/request/payment data. Customer PII is never exposed.
async function ensureAffiliateSalesLedger() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS affiliate_sales (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      affiliate_id BIGINT NOT NULL,
      order_id BIGINT NOT NULL,
      request_id VARCHAR(100) NOT NULL,
      affiliate_code VARCHAR(100) NULL,
      model VARCHAR(100) NULL,
      original_amount_cents BIGINT NOT NULL DEFAULT 0,
      discount_amount_cents BIGINT NOT NULL DEFAULT 0,
      final_amount_cents BIGINT NOT NULL DEFAULT 0,
      commission_rate_bps INT NOT NULL DEFAULT 2000,
      fixed_bonus_cents BIGINT NOT NULL DEFAULT 100,
      commission_amount_cents BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_affiliate_sales_order (affiliate_id, order_id),
      KEY idx_affiliate_sales_affiliate (affiliate_id, created_at)
    )`);

    // Backfill every historically valid affiliate sale from payment_orders.
    await db.execute(`
      INSERT IGNORE INTO affiliate_sales
        (affiliate_id, order_id, request_id, affiliate_code, model,
         original_amount_cents, discount_amount_cents, final_amount_cents,
         commission_rate_bps, fixed_bonus_cents, commission_amount_cents, status, created_at)
      SELECT
        a.id, po.id, po.request_id, po.affiliate_code, po.model,
        COALESCE(po.original_amount_cents,0), COALESCE(po.discount_amount_cents,0), COALESCE(po.final_amount_cents,0),
        2000, 100,
        FLOOR(COALESCE(po.final_amount_cents,0) * 0.20 + 100),
        'PENDING', COALESCE(po.created_at, NOW())
      FROM payment_orders po
      JOIN users u ON u.id = po.user_id
      JOIN affiliates a ON a.user_id = u.id
      WHERE po.affiliate_code IS NOT NULL
        AND TRIM(po.affiliate_code) <> ''
        AND po.status IN ('PAYMENT_DONE','PAYMENT_APPROVED')
        AND u.affiliate_code = po.affiliate_code
    `);

    // Backfill the commission ledger for the same valid sales, without duplicates.
    await db.execute(`
      INSERT INTO affiliate_commissions
        (affiliate_id, order_id, referred_user_id, model, commission_amount_cents,
         original_amount_cents, discount_amount_cents, final_amount_cents,
         commission_rate_bps, fixed_bonus_cents, paid_amount_cents, status)
      SELECT
        s.affiliate_id, s.order_id, po.user_id, s.model, s.commission_amount_cents,
        s.original_amount_cents, s.discount_amount_cents, s.final_amount_cents,
        s.commission_rate_bps, s.fixed_bonus_cents, 0, 'PENDING'
      FROM affiliate_sales s
      JOIN payment_orders po ON po.id = s.order_id
      LEFT JOIN affiliate_commissions ac ON ac.order_id = s.order_id
      WHERE ac.id IS NULL
    `);

    // Reconcile affiliate totals from the ledger instead of incrementing them repeatedly.
    await db.execute(`
      UPDATE affiliates a
      LEFT JOIN (
        SELECT affiliate_id,
               COUNT(*) AS sales_count,
               COALESCE(SUM(commission_amount_cents),0) AS total_earnings,
               COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents,0),0)),0) AS pending_earnings,
               COALESCE(SUM(COALESCE(paid_amount_cents,0)),0) AS paid_earnings
        FROM affiliate_commissions
        GROUP BY affiliate_id
      ) x ON x.affiliate_id = a.id
      SET a.total_sales = COALESCE(x.sales_count,0),
          a.total_earnings_cents = COALESCE(x.total_earnings,0),
          a.pending_earnings_cents = COALESCE(x.pending_earnings,0),
          a.paid_earnings_cents = COALESCE(x.paid_earnings,0)
    `);
    console.log('Affiliate sales ledger ready and historical sales reconciled.');
  } catch (error) {
    console.error('Affiliate sales ledger migration failed:', error.message);
  }
}

'''
    s = s.replace(marker, block + marker, 1)

# 2) Run migration after DB pool is initialized, but do not block server startup forever.
if 'ensureAffiliateSalesLedger().catch' not in s:
    db_marker = '})();\n\n// ========== SECURITY CHECKS =========='
    s = s.replace(db_marker, "})();\n\nensureAffiliateSalesLedger().catch((error) => console.error('Affiliate ledger startup error:', error.message));\n\n// ========== SECURITY CHECKS ==========", 1)

# 3) Payment status is the ONLY automatic trigger. Add a ledger row in the existing status block.
needle = '''          if (existingComm.length === 0) {
            await connection.execute(
              `INSERT INTO affiliate_commissions ('''
if needle in s and 'INSERT IGNORE INTO affiliate_sales' not in s:
    # Insert sales ledger immediately before commission insert; both are protected by the same transaction.
    replacement = '''          if (existingComm.length === 0) {
            await connection.execute(
              `INSERT IGNORE INTO affiliate_sales (
                affiliate_id, order_id, request_id, affiliate_code, model,
                original_amount_cents, discount_amount_cents, final_amount_cents,
                commission_rate_bps, fixed_bonus_cents, commission_amount_cents, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2000, 100, ?, 'PENDING')`,
              [
                affiliate.affiliate_id,
                id,
                order.request_id,
                order.affiliate_code,
                order.model,
                order.original_amount_cents || 0,
                order.discount_amount_cents || 0,
                order.final_amount_cents || 0,
                commissionCents,
              ],
            );

            await connection.execute(
              `INSERT INTO affiliate_commissions ('''
    s = s.replace(needle, replacement, 1)

# 4) Remove the older account-creation-time commission block so payment status remains the sole trigger.
account_marker = '      // Affiliate commission\n      if (order.affiliate_code) {'
start = s.find(account_marker)
if start != -1:
    end = s.find('\n\n      await connection.commit();', start)
    if end != -1:
        s = s[:start] + '      // Affiliate commission is created only by PAYMENT_DONE/PAYMENT_APPROVED.' + s[end:]

# 5) Replace affiliate dashboard history with privacy-safe affiliate_sales data.
old_query = re.compile(r'''    const \[commissions\] = await db\.execute\(\n      `SELECT[\s\S]*?LIMIT 50`,\n      \[affiliate\.id\]\n    \);''')
new_query = '''    const [commissions] = await db.execute(
      `SELECT
        id,
        request_id AS order_ref,
        model,
        original_amount_cents,
        discount_amount_cents,
        final_amount_cents,
        commission_amount_cents AS commission_cents,
        commission_rate_bps,
        fixed_bonus_cents,
        status,
        created_at
       FROM affiliate_sales
       WHERE affiliate_id = ?
       ORDER BY created_at DESC`,
      [affiliate.id]
    );'''
s, n = old_query.subn(new_query, s, count=1)

# 6) verified_sales must be a real ledger count, not the latest page length.
s = s.replace('      verified_sales: commissions.length,', '      verified_sales: commissions.length,', 1)

p.write_text(s, encoding='utf-8')
print('Affiliate sales ledger repair applied.')
