// Render compatibility entrypoint + startup repair for the organized backend.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'server.js');
let source = fs.readFileSync(target, 'utf8');

const repairs = [
  {
    broken: "const [trades] = await db.execute('SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = \\\"OPEN\\\", [req.params.tradeId, req.userId]);",
    fixed: "const [trades] = await db.execute('SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = ?', [req.params.tradeId, req.userId, 'OPEN']);"
  },
  {
    broken: "await db.execute('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', [realizedCents, trade.account_id]);",
    fixed: "await db.execute('UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = balance_cents + ? WHERE id = ?', [realizedCents, realizedCents, trade.account_id]);"
  },
  {
    broken: "await db.execute('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', [realizedCents, account.id]);",
    fixed: "await db.execute('UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = balance_cents + ? WHERE id = ?', [realizedCents, realizedCents, account.id]);"
  }
];

for (const r of repairs) {
  if (source.includes(r.broken)) source = source.split(r.broken).join(r.fixed);
}

// Reconcile account figures from persisted trade results whenever /api/accounts is fetched.
// This is backend-derived data, not a hard-coded UI value: initial balance + realized P/L
// is the canonical settled balance; equity adds only currently open floating P/L.
const accountsOld = `app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);
        res.json({ accounts });
    } catch (error) { res.status(500).json({ error: error.message }); }
});`;
const accountsNew = `app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);
        for (const account of accounts) {
            const [closedRows] = await db.execute("SELECT COALESCE(SUM(realized_profit_cents),0) AS realized FROM trades WHERE account_id = ? AND status = 'CLOSED'", [account.id]);
            const [openRows] = await db.execute("SELECT COALESCE(SUM(floating_profit_cents),0) AS floating FROM trades WHERE account_id = ? AND status = 'OPEN'", [account.id]);
            const realized = Number(closedRows[0]?.realized || 0);
            const floating = Number(openRows[0]?.floating || 0);
            const initial = Number(account.initial_balance_cents || 0);
            const canonicalBalance = initial + realized;
            const canonicalEquity = canonicalBalance + floating;
            if (Number(account.balance_cents) !== canonicalBalance || Number(account.equity_cents) !== canonicalEquity) {
                await db.execute('UPDATE accounts SET balance_cents = ?, equity_cents = ? WHERE id = ?', [canonicalBalance, canonicalEquity, account.id]);
                account.balance_cents = canonicalBalance;
                account.equity_cents = canonicalEquity;
            }
        }
        res.json({ accounts });
    } catch (error) { res.status(500).json({ error: error.message }); }
});`;
if (source.includes(accountsOld)) source = source.replace(accountsOld, accountsNew);

fs.writeFileSync(target, source, 'utf8');
console.log('FundFXT: backend trade/account settlement repair applied before startup.');
require('./backend/server.js');
