from pathlib import Path
import re

p = Path('backend/server.js')
s = p.read_text(encoding='utf-8')

# 1) Repair the affiliate ledger migration so it only depends on columns that
# are known to exist in the live schema, while keeping full sale details in
# affiliate_sales. The referrer is identified by the affiliate code itself.
start = s.find('// ========== AFFILIATE SALES LEDGER ==========')
end = s.find('// ========== AFFILIATE CODE GENERATOR ==========', start)
if start == -1 or end == -1:
    raise SystemExit('Affiliate ledger section markers not found')

ledger = r'''// ========== AFFILIATE SALES LEDGER ==========
// Sale history is stored separately and contains no customer PII.
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

    // Rebuild missing historical affiliate sales from successful payments.
    // IMPORTANT: affiliate_code identifies the referrer, not the buyer.
    await db.execute(`
      INSERT IGNORE INTO affiliate_sales
        (affiliate_id, order_id, request_id, affiliate_code, model,
         original_amount_cents, discount_amount_cents, final_amount_cents,
         commission_rate_bps, fixed_bonus_cents, commission_amount_cents, status, created_at)
      SELECT
        a.id, po.id, po.request_id, po.affiliate_code, po.model,
        COALESCE(po.original_amount_cents,0),
        COALESCE(po.discount_amount_cents,0),
        COALESCE(po.final_amount_cents,0),
        2000, 100,
        FLOOR(COALESCE(po.final_amount_cents,0) * 0.20 + 100),
        'PENDING', COALESCE(po.created_at, NOW())
      FROM payment_requests po
      JOIN affiliates a ON a.affiliate_code = po.affiliate_code
      WHERE po.affiliate_code IS NOT NULL
        AND TRIM(po.affiliate_code) <> ''
        AND po.status IN ('PAYMENT_DONE','PAYMENT_APPROVED')
    `);

    // Keep the existing commission table compatible with the live schema.
    // Do not assume optional reporting columns exist there.
    await db.execute(`
      INSERT INTO affiliate_commissions
        (affiliate_id, order_id, referred_user_id, model, commission_amount_cents, status)
      SELECT
        s.affiliate_id, s.order_id, po.user_id, s.model, s.commission_amount_cents, 'PENDING'
      FROM affiliate_sales s
      JOIN payment_requests po ON po.id = s.order_id
      LEFT JOIN affiliate_commissions ac ON ac.order_id = s.order_id
      WHERE ac.id IS NULL
    `);

    // Reconcile totals using only stable commission columns.
    await db.execute(`
      UPDATE affiliates a
      LEFT JOIN (
        SELECT affiliate_id,
               COUNT(*) AS sales_count,
               COALESCE(SUM(commission_amount_cents),0) AS total_earnings
        FROM affiliate_commissions
        GROUP BY affiliate_id
      ) x ON x.affiliate_id = a.id
      SET a.total_sales = COALESCE(x.sales_count,0),
          a.total_earnings_cents = COALESCE(x.total_earnings,0),
          a.pending_earnings_cents = COALESCE(x.total_earnings,0)
    `);

    console.log('Affiliate sales ledger ready and historical sales reconciled.');
  } catch (error) {
    console.error('Affiliate sales ledger migration failed:', error.message);
  }
}

'''
s = s[:start] + ledger + s[end:]

# 2) Repair WebSocket startup ordering. The WebSocket server must be created
# only after app.listen() returns the HTTP server instance.
ws_pattern = re.compile(
    r'// ========== WEBSOCKET SERVER ==========.*?\n// ========== SEED DEFAULT ADMIN ==========',
    re.S,
)
ws = r'''// ========== WEBSOCKET SERVER ==========
const PORT = process.env.PORT || 3000;
let server;
let wss;

(async () => {
  try {
    await ensureAffiliateSchema();
  } catch (migrationError) {
    console.error('Affiliate schema repair failed:', migrationError.message);
  }

  server = app.listen(PORT, () =>
    console.log(`🚀 Server running on port ${PORT}`),
  );

  wss = new WebSocket.Server({ server, path: "/ws" });
  wss.on("connection", (client) => {
    console.log("Frontend WebSocket connected");
    client.send(JSON.stringify({ type: "price", data: global.prices || {} }));
  });
})();

setInterval(() => {
  if (wss && global.prices && Object.keys(global.prices).length > 0) {
    const msg = JSON.stringify({ type: "price", data: global.prices });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }
}, 1000);

// ========== SEED DEFAULT ADMIN ==========='''
if not ws_pattern.search(s):
    raise SystemExit('WebSocket/server startup section not found')
s = ws_pattern.sub(ws, s, count=1)

p.write_text(s, encoding='utf-8')
print('Final structure repair applied')
