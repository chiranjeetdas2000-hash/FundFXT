// FundFXT Render compatibility entrypoint + production trade repairs.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'server.js');
let source = fs.readFileSync(target, 'utf8');

const fixedTradeQuery = "        const [trades] = await db.execute(\"SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'\", [req.params.tradeId, req.userId]);";
source = source.split('\n').map(line => line.includes('req.params.tradeId') && line.includes('const [trades]') ? fixedTradeQuery : line).join('\n');

source = source.replace(/await db\.execute\('UPDATE accounts SET balance_cents = balance_cents \+ \? WHERE id = \?', \[(trade|account)\.account_id\]\);/g,"await db.execute('UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = equity_cents + ? WHERE id = ?', [realizedCents, realizedCents, $1.account_id]);");

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
    if (direct) { const px = Number(direct.mid || direct.bid || direct.ask); if (Number.isFinite(px) && px > 0) usdPerQuote = px; }
    else if (inverse) { const px = Number(inverse.mid || inverse.bid || inverse.ask); if (Number.isFinite(px) && px > 0) usdPerQuote = 1 / px; }
    if (!usdPerQuote) throw new Error('USD conversion quote unavailable for ' + quote);
    return quotePL * usdPerQuote;
}`;
source = source.replace(/function calculatePL\(symbol, side, entry, current, volume\) \{[\s\S]*?\n\}/, groupedPL);

// ========== DATABASE-DRIVEN ACCOUNT RULES / PROGRESS ==========
// Never invent a profit target. Values come from challenge_configs (or account overrides).
const accountRoute = `app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);
        const normalized = [];
        for (const account of accounts) {
            const model = String(account.challenge_model || '').toLowerCase();
            const [configs] = await db.execute('SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1', [model]);
            const config = configs[0] || {};
            const num = v => v === null || v === undefined || v === '' ? null : Number(v);
            const pick = (...keys) => { for (const k of keys) if (config[k] !== null && config[k] !== undefined && config[k] !== '') return config[k]; return null; };
            const accountPick = (...keys) => { for (const k of keys) if (account[k] !== null && account[k] !== undefined && account[k] !== '') return account[k]; return null; };
            const warrior = model.includes('warrior');
            const direct = model === 'prototype_5k' || model === 'direct' || model.includes('direct');
            const initial = num(account.initial_balance_cents) ?? num(account.balance_cents) ?? 0;
            const targetCents = num(accountPick('profit_target_cents','target_profit_cents','target_cents')) ?? num(pick('profit_target_cents','target_profit_cents','target_cents'));
            const targetBps = num(pick('profit_target_bps','target_bps','profit_target_percent_bps'));
            const targetPercent = targetBps == null ? num(pick('profit_target_percent','target_percent','profit_target_pct','target_pct')) : targetBps / 100;
            const resolvedTargetCents = targetCents != null ? targetCents : (targetPercent != null ? Math.round(initial * targetPercent / 100) : null);
            const consistencyBps = num(pick('consistency_bps','consistency_rule_bps','consistency_percent_bps'));
            const consistencyLimit = num(accountPick('consistency_limit_percent')) ?? (consistencyBps == null ? num(pick('consistency_limit_percent','consistency_percent','consistency_rule_percent','consistency')) : consistencyBps / 100);
            const maxTrades = num(accountPick('max_trades_per_day','max_daily_trades')) ?? num(pick('max_trades_per_day','max_daily_trades')) ?? (warrior ? 3 : null);
            const dailyDDbps = num(accountPick('daily_dd_bps')) ?? num(config.daily_dd_bps);
            const maxDDbps = num(accountPick('max_dd_bps')) ?? num(config.max_dd_bps);
            let consistencyAchieved = 0;
            try {
                const [days] = await db.execute(\"SELECT trading_day, SUM(CASE WHEN realized_profit_cents > 0 THEN realized_profit_cents ELSE 0 END) AS day_profit FROM trades WHERE account_id = ? AND status = 'CLOSED' GROUP BY trading_day\", [account.id]);
                const profits = days.map(r => Number(r.day_profit || 0)).filter(v => v > 0);
                const totalProfit = profits.reduce((s,v) => s + v, 0);
                if (totalProfit > 0) consistencyAchieved = Math.max(...profits) / totalProfit * 100;
            } catch (_) {}
            const [todayRows] = await db.execute(\"SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE() AND (close_reason IS NULL OR close_reason <> 'MANUAL_PARTIAL')\", [account.id]);
            const balance = num(account.balance_cents) ?? 0;
            const equity = num(account.equity_cents) ?? balance;
            const profitAchievedCents = Math.max(0, balance - initial);
            const targetProgress = resolvedTargetCents && resolvedTargetCents > 0 ? Math.max(0, Math.min(100, profitAchievedCents / resolvedTargetCents * 100)) : null;
            const phase = account.phase || account.account_phase || account.challenge_phase || (warrior ? 'Phase 1' : direct ? 'Direct Funded' : '—');
            const accountType = account.account_type || (warrior ? 'Warrior Account' : direct ? 'Direct Funded Account' : 'Challenge Account');
            normalized.push({ ...account, account_profile: { accountType, phase, model: account.challenge_model || null, isDirectFunded: direct, isWarrior: warrior, rules: { maxTradesPerDay: maxTrades, tradesToday: Number(todayRows[0].count || 0), consistencyLimitPercent: consistencyLimit, consistencyAchievedPercent: Number(consistencyAchieved.toFixed(2)), dailyDrawdownPercent: dailyDDbps == null ? null : dailyDDbps / 100, maxDrawdownPercent: maxDDbps == null ? null : maxDDbps / 100, dailyDrawdownCents: dailyDDbps == null ? null : Math.round(initial * dailyDDbps / 10000), maxDrawdownCents: maxDDbps == null ? null : Math.round(initial * maxDDbps / 10000), profitTargetCents: resolvedTargetCents, profitAchievedCents, targetProgressPercent: targetProgress } } });
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
        const trade = rows[0]; const originalVolume = Number(trade.volume);
        if (closeVolume >= originalVolume) return res.status(400).json({ error: 'Use full close for the complete position' });
        const price = global.priceCache?.[trade.symbol]; if (!price) return res.status(503).json({ error: 'Live price unavailable' });
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
        const trade = rows[0], side = String(trade.side).toUpperCase(), entry = Number(trade.entry_price);
        const hasTP = Object.prototype.hasOwnProperty.call(req.body, 'tp'), hasSL = Object.prototype.hasOwnProperty.call(req.body, 'sl');
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
console.log('FundFXT: database-driven account rules + grouped USD P&L + partial close + TP/SL repairs applied before startup.');
require('./backend/server.js');
