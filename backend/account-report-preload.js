// FundFXT account-report preload. Loaded with NODE_OPTIONS so the existing backend keeps its trade engine untouched.
const mysql = require('mysql2/promise');
const originalCreatePool = mysql.createPool;

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

mysql.createPool = function patchedCreatePool(...args) {
  const pool = originalCreatePool.apply(this, args);
  const rawExecute = pool.execute.bind(pool);

  pool.execute = async function patchedExecute(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (!/^SELECT \* FROM accounts WHERE user_id = \?/i.test(text)) {
      return rawExecute(sql, params);
    }

    const [accounts] = await rawExecute(sql, params);
    const normalized = [];

    for (const account of accounts) {
      const id = account.id;
      const initial = n(account.initial_balance_cents, n(account.balance_cents));

      const [closed] = await rawExecute(
        "SELECT COALESCE(SUM(realized_profit_cents),0) AS realized FROM trades WHERE account_id=? AND status='CLOSED'",
        [id]
      );
      const [open] = await rawExecute(
        "SELECT COALESCE(SUM(floating_profit_cents),0) AS floating FROM trades WHERE account_id=? AND status='OPEN'",
        [id]
      );
      const realized = n(closed[0]?.realized);
      const floating = n(open[0]?.floating);

      // Canonical ledger values. Do not trust stale cached balance/equity columns.
      const balance = initial + realized;
      const equity = balance + floating;

      const model = String(account.challenge_model || '').toLowerCase();
      const [cfgRows] = await rawExecute(
        'SELECT * FROM challenge_configs WHERE model_key=? LIMIT 1',
        [model]
      );
      const cfg = cfgRows[0] || {};
      const pick = (...keys) => {
        for (const key of keys) {
          const value = cfg[key] ?? account[key];
          if (value !== null && value !== undefined && value !== '') return n(value, null);
        }
        return null;
      };

      const warrior = model === 'warrior_5k';
      const direct = model === 'prototype_5k';
      const phase = String(account.phase || account.account_phase || account.challenge_phase || (warrior ? 'Phase 1' : direct ? 'Direct Funded' : '—'));
      const phase2 = /2/.test(phase);

      // Prefer the actual DB-configured target. Only use the model's documented phase fallback if the DB has no target field.
      const targetCents = pick('profit_target_cents', 'target_profit_cents', 'target_cents');
      const targetBps = pick(
        phase2 ? 'phase2_profit_target_bps' : 'phase1_profit_target_bps',
        phase2 ? 'profit_target_phase2_bps' : 'profit_target_phase1_bps',
        'profit_target_bps', 'target_bps', 'profit_target_percent_bps'
      );
      const targetPercent = targetBps !== null ? targetBps / 100 : (warrior ? (phase2 ? 5 : 8) : null);
      const resolvedTarget = targetCents !== null ? targetCents : (targetPercent === null ? null : Math.round(initial * targetPercent / 100));

      const dailyBps = pick('daily_dd_bps', 'daily_drawdown_bps');
      const maxBps = pick('max_dd_bps', 'max_drawdown_bps');
      const maxTrades = pick('max_trades_per_day', 'max_daily_trades') ?? (warrior ? 3 : null);
      const consistencyBps = pick('consistency_bps', 'consistency_rule_bps', 'consistency_percent_bps');
      const consistencyLimit = consistencyBps !== null ? consistencyBps / 100 : (warrior ? 30 : null);

      const dayStart = n(account.day_start_balance_cents, initial);
      const dailyLimit = dailyBps === null ? null : Math.round(dayStart * dailyBps / 10000);
      const maxLimit = maxBps === null ? null : Math.round(initial * maxBps / 10000);
      const dailyUsed = Math.max(0, dayStart - balance);
      const maxUsed = Math.max(0, initial - equity);

      const [days] = await rawExecute(
        "SELECT trading_day, SUM(CASE WHEN realized_profit_cents>0 THEN realized_profit_cents ELSE 0 END) AS day_profit FROM trades WHERE account_id=? AND status='CLOSED' GROUP BY trading_day",
        [id]
      );
      const dayProfits = days.map(row => n(row.day_profit)).filter(v => v > 0);
      const totalPositiveProfit = dayProfits.reduce((sum, value) => sum + value, 0);
      const bestDay = dayProfits.length ? Math.max(...dayProfits) : 0;
      const consistencyAchieved = totalPositiveProfit > 0 ? bestDay / totalPositiveProfit * 100 : 0;

      const [todayRows] = await rawExecute(
        'SELECT COUNT(*) AS count FROM trades WHERE account_id=? AND trading_day=CURDATE()',
        [id]
      );
      const [openRows] = await rawExecute(
        "SELECT COUNT(*) AS count FROM trades WHERE account_id=? AND status='OPEN'",
        [id]
      );

      normalized.push({
        ...account,
        balance_cents: balance,
        equity_cents: equity,
        realized_profit_cents: realized,
        floating_profit_cents: floating,
        account_profile: {
          accountType: account.account_type || (warrior ? 'two-step challenge' : direct ? 'Direct Funded Account' : 'Challenge Account'),
          fundingModel: warrior ? 'warrior' : direct ? 'direct' : (account.funding_model || '—'),
          phase,
          model: account.challenge_model || null,
          isDirectFunded: direct,
          isWarrior: warrior,
          rules: {
            maxTradesPerDay: maxTrades,
            tradesToday: n(todayRows[0]?.count),
            openPositions: n(openRows[0]?.count),
            consistencyLimitPercent: consistencyLimit,
            consistencyAchievedPercent: Number(consistencyAchieved.toFixed(2)),
            consistencyMet: consistencyLimit === null || consistencyAchieved <= consistencyLimit,
            dailyDrawdownPercent: dailyBps === null ? null : dailyBps / 100,
            dailyDrawdownCents: dailyLimit,
            dailyDrawdownUsedCents: dailyUsed,
            dailyDrawdownRemainingCents: dailyLimit === null ? null : Math.max(0, dailyLimit - dailyUsed),
            maximumDrawdownPercent: maxBps === null ? null : maxBps / 100,
            maxDrawdownCents: maxLimit,
            maxDrawdownUsedCents: maxUsed,
            maxDrawdownRemainingCents: maxLimit === null ? null : Math.max(0, maxLimit - maxUsed),
            profitTargetPercent: targetPercent,
            profitTargetCents: resolvedTarget,
            profitAchievedCents: Math.max(0, balance - initial),
            targetProgressPercent: resolvedTarget > 0 ? Math.max(0, Math.min(100, (balance - initial) / resolvedTarget * 100)) : null
          }
        }
      });
    }
    return [normalized, undefined];
  };

  return pool;
};