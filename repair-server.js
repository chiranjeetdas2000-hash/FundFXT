const fs = require('fs');
const { spawnSync } = require('child_process');

const file = 'server.js';
let source = fs.readFileSync(file, 'utf8');

// Repair every malformed trade lookup created by the earlier automated patch.
const malformed = /const\s+\[trades\]\s*=\s*await\s+db\.execute\(\s*'SELECT \* FROM trades WHERE trade_id = \? AND user_id = \? AND status = "OPEN",\s*\[req\.params\.tradeId,\s*req\.userId\]\s*\);/g;
const validLookup = `const [trades] = await db.execute(
            "SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'",
            [req.params.tradeId, req.userId]
        );`;

const before = source;
source = source.replace(malformed, validLookup);

// If the dedicated SL/TP route still contains the old implementation, replace it safely.
const marker = '// 3. MODIFY SL/TP';
const endMarker = '// 4. PENDING ORDERS';
const start = source.indexOf(marker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  throw new Error('Cannot safely locate the SL/TP route in server.js');
}

const route = `// 3. MODIFY SL/TP
app.patch('/api/trades/:tradeId', authenticateToken, async (req, res) => {
    const tradeId = String(req.params.tradeId || '').trim();
    const rawSL = req.body?.stop_loss ?? req.body?.sl ?? null;
    const rawTP = req.body?.take_profit ?? req.body?.tp ?? null;
    const stopLoss = rawSL === '' || rawSL === null ? null : Number(rawSL);
    const takeProfit = rawTP === '' || rawTP === null ? null : Number(rawTP);

    try {
        if (!tradeId) return res.status(400).json({ error: 'Trade ID is required' });
        if ((stopLoss !== null && !Number.isFinite(stopLoss)) || (takeProfit !== null && !Number.isFinite(takeProfit))) {
            return res.status(400).json({ error: 'Invalid stop loss or take profit price' });
        }

        const [trades] = await db.execute(
            "SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'",
            [tradeId, req.userId]
        );
        if (!trades.length) return res.status(404).json({ error: 'Open trade not found' });

        const trade = trades[0];
        const entry = Number(trade.entry_price);
        if (trade.side === 'BUY') {
            if (stopLoss !== null && stopLoss >= entry) return res.status(400).json({ error: 'BUY stop loss must be below entry' });
            if (takeProfit !== null && takeProfit <= entry) return res.status(400).json({ error: 'BUY take profit must be above entry' });
        } else if (trade.side === 'SELL') {
            if (stopLoss !== null && stopLoss <= entry) return res.status(400).json({ error: 'SELL stop loss must be above entry' });
            if (takeProfit !== null && takeProfit >= entry) return res.status(400).json({ error: 'SELL take profit must be below entry' });
        } else {
            return res.status(400).json({ error: 'Invalid trade side' });
        }

        const [result] = await db.execute(
            "UPDATE trades SET stop_loss = ?, take_profit = ? WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'",
            [stopLoss, takeProfit, tradeId, req.userId]
        );
        if (result.affectedRows !== 1) return res.status(409).json({ error: 'Trade could not be modified' });

        const [updated] = await db.execute(
            'SELECT trade_id, symbol, side, volume, entry_price, stop_loss, take_profit, status FROM trades WHERE trade_id = ? AND user_id = ? LIMIT 1',
            [tradeId, req.userId]
        );

        console.log('SL/TP modified:', tradeId, stopLoss, takeProfit);
        return res.json({ success: true, trade: updated[0] || { trade_id: tradeId, stop_loss: stopLoss, take_profit: takeProfit } });
    } catch (error) {
        console.error('SL/TP modify error:', error.message);
        return res.status(400).json({ error: error.message });
    }
});

`;

source = source.slice(0, start) + route + source.slice(end);

// The live terminal reads /api/trade/get. The current server.js did not expose
// that route, so the terminal could execute trades but could never retrieve them.
// Inject the authenticated endpoint once, before the websocket/server startup.
const tradeGetMarker = '// ========== TERMINAL OPEN TRADE API ==========';
if (!source.includes(tradeGetMarker)) {
  const websocketMarker = '// ========== WEBSOCKET SERVER ==========';
  const websocketAt = source.indexOf(websocketMarker);
  if (websocketAt < 0) throw new Error('Cannot locate websocket startup marker for trade GET route');
  const tradeGetRoute = `${tradeGetMarker}\napp.get('/api/trade/get', authenticateToken, async (req, res) => {\n    try {\n        const accountCode = String(req.query.account_code || '').trim();\n        if (!accountCode) return res.status(400).json({ success: false, error: 'account_code is required' });\n        const [accounts] = await db.execute('SELECT id FROM accounts WHERE account_code = ? AND user_id = ? LIMIT 1', [accountCode, req.userId]);\n        if (!accounts.length) return res.status(404).json({ success: false, error: 'Account not found' });\n        const [trades] = await db.execute(\n            'SELECT * FROM trades WHERE account_id = ? AND user_id = ? ORDER BY entry_time DESC, id DESC',\n            [accounts[0].id, req.userId]\n        );\n        return res.json({ success: true, trades });\n    } catch (error) {\n        console.error('Trade fetch error:', error.message);\n        return res.status(500).json({ success: false, error: error.message });\n    }\n});\n\n`;
  source = source.slice(0, websocketAt) + tradeGetRoute + source.slice(websocketAt);
}

if (source !== before) {
  fs.writeFileSync(file, source);
  console.log('FundFXT: SL/TP SQL repaired and terminal trade GET route injected.');
} else {
  console.log('FundFXT: no source changes were necessary.');
}

const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
if (check.status !== 0) {
  throw new Error('server.js syntax validation failed after repair');
}
console.log('FundFXT: server.js syntax OK.');
