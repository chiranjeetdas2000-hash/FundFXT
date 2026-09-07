// Render compatibility entrypoint + startup repair for the organized backend.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'server.js');
let source = fs.readFileSync(target, 'utf8');

// Repair the known malformed SL/TP SQL line safely by matching the complete line,
// then keep settled account figures synchronized with persisted trade results.
source = source.split('\n').map(line => {
  if (line.includes("const [trades] = await db.execute('SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = \"OPEN\", [req.params.tradeId, req.userId]);")) {
    return "        const [trades] = await db.execute('SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = ?', [req.params.tradeId, req.userId, 'OPEN']);";
  }
  return line;
}).join('\n');

const balanceTradeLine = "await db.execute('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', [realizedCents, trade.account_id]);";
const balanceAccountLine = "await db.execute('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', [realizedCents, account.id]);";
source = source.split(balanceTradeLine).join("await db.execute('UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = balance_cents + ? WHERE id = ?', [realizedCents, realizedCents, trade.account_id]);");
source = source.split(balanceAccountLine).join("await db.execute('UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = balance_cents + ? WHERE id = ?', [realizedCents, realizedCents, account.id]);");

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
