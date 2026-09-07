const fs = require('fs');
const { spawnSync } = require('child_process');

const file = 'server.js';
const marker = '// 3. MODIFY SL/TP';
const endMarker = '// 4. PENDING ORDERS';
const source = fs.readFileSync(file, 'utf8');
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

const repaired = source.slice(0, start) + route + source.slice(end);
if (repaired !== source) {
  fs.writeFileSync(file, repaired);
  console.log('FundFXT: SL/TP route repaired before startup.');
}

const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
if (check.status !== 0) {
  throw new Error('server.js syntax validation failed after repair');
}
console.log('FundFXT: server.js syntax OK.');
