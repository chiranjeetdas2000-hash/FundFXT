// FundFXT Render compatibility entrypoint + production trade repairs.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'server.js');
let source = fs.readFileSync(target, 'utf8');

const fixedTradeQuery = "        const [trades] = await db.execute(\"SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'\", [req.params.tradeId, req.userId]);";
source = source.split('\n').map(line => line.includes('req.params.tradeId') && line.includes('const [trades]') ? fixedTradeQuery : line).join('\n');

source = source.replace(
  /await db\.execute\('UPDATE accounts SET balance_cents = balance_cents \+ \? WHERE id = \?', \[realizedCents, (trade|account)\.account_id\]\);/g,
  "await db.execute('UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = equity_cents + ? WHERE id = ?', [realizedCents, realizedCents, $1.account_id]);"
);

const groupedPL = `function calculatePL(symbol, side, entry, current, volume) {
    const inst = instruments[symbol];
    if (!inst) throw new Error('Unsupported symbol: ' + symbol);
    const pair = String(symbol).toUpperCase();
    const quote = pair.slice(3, 6);
    const signedMove = String(side).toUpperCase() === 'BUY' ? Number(current) - Number(entry) : Number(entry) - Number(current);
    const quotePL = signedMove * Number(inst.size) * Number(volume);
    if (quote === 'USD') return quotePL;
    const prices = global.prices || {};
    const direct = prices[quote + 'USD'];
    const inverse = prices['USD' + quote];
    let usdPerQuote = 0;
    if (direct) {
        const px = Number(direct.mid || direct.bid || direct.ask);
        if (Number.isFinite(px) && px > 0) usdPerQuote = px;
    } else if (inverse) {
        const px = Number(inverse.mid || inverse.bid || inverse.ask);
        if (Number.isFinite(px) && px > 0) usdPerQuote = 1 / px;
    }
    if (!usdPerQuote) throw new Error('USD conversion quote unavailable for ' + quote);
    return quotePL * usdPerQuote;
}`;
source = source.replace(/function calculatePL\(symbol, side, entry, current, volume\) \{[\s\S]*?\n\}/, groupedPL);

// Rich account metadata is derived from the same challenge model/config used by the risk engine.
const accountRoute = `app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);
        const normalized = [];
        for (const account of accounts) {
            let config = null;
            try { config = await getChallengeConfig(account.challenge_model); } catch (_) {}
            const model = String(account.challenge_model || '').toLowerCase();
            const warrior = model === 'warrior_5k' || model === 'warrior' || model.includes('warrior');
            const direct = model === 'prototype_5k' || model === 'direct' || model === 'direct_funded' || model.includes('direct');
            const initial = Number(account.initial_balance_cents || account.balance_cents || 0);
            const pickNumber = (...values) => {
                for (const value of values) {
                    const n = Number(value);
                    if (Number.isFinite(n)) return n;
                }
                return null;
            };
            // The 5K FundFXT model has a $400 target. Prefer a configured DB value when present; never invent $3,000.
            const configuredTarget = pickNumber(account.profit_target_cents, account.target_profit_cents, account.target_cents, config && config.profit_target_cents, config && config.target_profit_cents, config && config.target_cents);
            const profitTargetCents = configuredTarget != null ? configuredTarget : 40000;
            const consistencyLimit = pickNumber(account.consistency_limit_percent, account.consistency_bps != null ? Number(account.consistency_bps) / 100 : null, config && config.consistency_limit_percent, config && config.consistency_bps != null ? Number(config.consistency_bps) / 100 : null, 35);
            const maxTrades = pickNumber(account.max_trades_per_day, config && config.max_trades_per_day, 3) || 3;
            const dailyDDbps = pickNumber(account.daily_dd_bps, config && config.daily_dd_bps, warrior ? 500 : direct ? 200 : null);
            const maxDDbps = pickNumber(account.max_dd_bps, config && config.max_dd_bps, warrior ? 800 : direct ? 500 : null);
            let consistencyAchieved = 0;
            try {
                const [days] = await db.execute("SELECT trading_day, SUM(CASE WHEN realized_profit_cents > 0 THEN realized_profit_cents ELSE 0 END) AS day_profit FROM trades WHERE account_id = ? AND status = 'CLOSED' GROUP BY trading_day", [account.id]);
                const profits = days.map(r => Number(r.day_profit || 0)).filter(v => v > 0);
                const totalProfit = profits.reduce((s, v) => s + v, 0);
                if (totalProfit > 0) consistencyAchieved = (Math.max(...profits) / totalProfit) * 100;
            } catch (_) {}
            const [todayRows] = await db.execute("SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE()", [account.id]);
            const [openRows] = await db.execute("SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND status = 'OPEN'", [account.id]);
            const balance = Number(account.balance_cents || 0);
            const equity = Number(account.equity_cents || balance);
            const profitAchievedCents = Math.max(0, balance - initial);
            const targetProgress = Math.max(0, Math.min(100, (profitAchievedCents / profitTargetCents) * 100));
            const phase = account.phase || account.account_phase || account.challenge_phase || (warrior ? 'Warrior' : direct ? 'Direct Funded' : 'Phase 1');
            const accountType = account.account_type || (warrior ? 'Warrior' : direct ? 'Direct Funded' : 'Challenge');
            normalized.push({ ...account, account_profile: { accountType, phase, model: account.challenge_model || null, isDirectFunded: direct, isWarrior: warrior, rules: { maxTradesPerDay: Math.min(maxTrades, 3), tradesToday: Number(todayRows[0].count || 0), openPositions: Number(openRows[0].count || 0), maxOpenPositions: 1, consistencyLimitPercent: consistencyLimit, consistencyAchievedPercent: Number(consistencyAchieved.toFixed(2)), dailyDrawdownPercent: dailyDDbps == null ? null : dailyDDbps / 100, maxDrawdownPercent: maxDDbps == null ? null : maxDDbps / 100, dailyDrawdownCents: dailyDDbps == null ? null : Math.round(initial * dailyDDbps / 10000), maxDrawdownCents: maxDDbps == null ? null : Math.round(initial * maxDDbps / 10000), profitTargetCents, profitAchievedCents, targetProgressPercent: Number(targetProgress.toFixed(2)) } } });
        }
        res.json({ accounts: normalized });
    } catch (error) { res.status(500).json({ error: error.message }); }
});`;
source = source.replace(/app\.get\('\/api\/accounts', authenticateToken, async \(req, res\) => \{[\s\S]*?\n\}\);/, accountRoute);

const marker = '// ========== WEBSOCKET SERVER ==========';

if (!source.includes("/api/trades/:tradeId/partial-close")) {
    const partial = `// ========== PARTIAL CLOSE ==========
app.post('/api/trades/:tradeId/partial-close', authenticateToken, async (req, res) => {
    try {
        const closeVolume = Number(req.body.volume);
        if (!Number.isFinite(closeVolume) || closeVolume <= 0) return res.status(400).json({ error: 'Invalid close volume' });
        if (Math.round(closeVolume * 100) !== closeVolume * 100) return res.status(400).json({ error: 'Close volume must use 0.01 lot steps' });
        const [rows] = await db.execute(\"SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'\", [req.params.tradeId, req.userId]);
        if (!rows.length) return res.status(404).json({ error: 'Open trade not found' });
        const trade = rows[0];
        const originalVolume = Number(trade.volume);
        if (closeVolume >= originalVolume) return res.status(400).json({ error: 'Use full close for the complete position' });
        const price = global.priceCache?.[trade.symbol];
        if (!price) return res.status(503).json({ error: 'Live price unavailable' });
        const exitPrice = trade.side === 'BUY' ? Number(price.bid) : Number(price.ask);
        const realizedCents = Math.round(calculatePL(trade.symbol, trade.side, Number(trade.entry_price), exitPrice, closeVolume) * 100);
        const remaining = Math.round((originalVolume - closeVolume) * 100) / 100;
        await db.execute('UPDATE trades SET volume = ?, current_price = ?, floating_profit_cents = 0 WHERE trade_id = ?', [remaining, exitPrice, trade.trade_id]);
        const partialId = 'TRP-' + Date.now().toString(36).toUpperCase();
        await db.execute(\"INSERT INTO trades (trade_id,account_id,account_code,user_id,symbol,side,volume,entry_price,entry_time,trading_day,stop_loss,take_profit,status,exit_price,exit_time,realized_profit_cents,close_reason) VALUES (?,?,?,?,?,?,?, ?, ?,CURDATE(),?,?, 'CLOSED', ?, NOW(), ?, 'MANUAL_PARTIAL')\", [partialId, trade.account_id, trade.account_code, trade.user_id, trade.symbol, trade.side, closeVolume, trade.entry_price, trade.entry_time, trade.stop_loss, trade.take_profit, exitPrice, realizedCents]);
        await db.execute('UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = equity_cents + ? WHERE id = ?', [realizedCents, realizedCents, trade.account_id]);
        res.json({ success: true, trade_id: partialId, remaining_volume: remaining, exit_price: exitPrice, realized_profit: realizedCents / 100 });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

`;
    source = source.replace(marker, partial + marker);
}

if (!source.includes("/api/trades/:tradeId/modify")) {
    const modify = `// ========== MODIFY OPEN TRADE ==========
app.post('/api/trades/:tradeId/modify', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute(\"SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'\", [req.params.tradeId, req.userId]);
        if (!rows.length) return res.status(404).json({ error: 'Open trade not found' });
        const trade = rows[0];
        const side = String(trade.side).toUpperCase();
        const entry = Number(trade.entry_price);
        const hasTP = Object.prototype.hasOwnProperty.call(req.body, 'tp');
        const hasSL = Object.prototype.hasOwnProperty.call(req.body, 'sl');
        const tp = hasTP ? (req.body.tp === null || req.body.tp === '' ? null : Number(req.body.tp)) : trade.take_profit;
        const sl = hasSL ? (req.body.sl === null || req.body.sl === '' ? null : Number(req.body.sl)) : trade.stop_loss;
        if ((tp !== null && !Number.isFinite(tp)) || (sl !== null && !Number.isFinite(sl))) return res.status(400).json({ error: 'Invalid TP or SL price' });
        if (sl !== null && ((side === 'BUY' && sl >= entry) || (side === 'SELL' && sl <= entry))) return res.status(400).json({ error: 'Invalid Stop Loss for this direction' });
        if (tp !== null && ((side === 'BUY' && tp <= entry) || (side === 'SELL' && tp >= entry))) return res.status(400).json({ error: 'Invalid Take Profit for this direction' });
        await db.execute('UPDATE trades SET stop_loss = ?, take_profit = ? WHERE trade_id = ?', [sl, tp, trade.trade_id]);
        res.json({ success: true, trade_id: trade.trade_id, stop_loss: sl, take_profit: tp });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

`;
    source = source.replace(marker, modify + marker);
}

fs.writeFileSync(target, source, 'utf8');
console.log('FundFXT: account profile/rules + correct 5K $400 target + grouped USD P&L + partial close + TP/SL repairs applied before startup.');
require('./backend/server.js');
