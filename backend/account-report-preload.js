// FundFXT account-report preload / canonical account rules layer.
// This module is loaded with NODE_OPTIONS on Render so /api/accounts always exposes
// authoritative account metadata, live balances and rule progress without fabricating targets.
const mysql = require('mysql2/promise');
const fs = require('fs');

const originalCreatePool = mysql.createPool;
const originalReadFileSync = fs.readFileSync;

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function canonicalAccountSource(value) {
  if (typeof value !== 'string' || !/backend[\\/]server\.js$/.test(String(value))) return null;
  return null;
}

// Make the legacy risk-engine trade limit count every trade opened today,
// not just positions that happen to remain OPEN.
fs.readFileSync = function patchedReadFileSync(file, encoding, ...rest) {
  const value = originalReadFileSync.call(this, file, encoding, ...rest);
  if (typeof file !== 'string' || !/backend[\\/]server\.js$/.test(file) || typeof value !== 'string') return value;

  return value.replace(
    /SELECT COUNT\(\*\) AS count FROM trades WHERE account_id = \? AND trading_day = CURDATE\(\) AND status = 'OPEN'/g,
    "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE()"
  );
};

mysql.createPool = function patchedCreatePool(...args) {
  const pool = originalCreatePool.apply(this, args);
  const rawExecute = pool.execute.bind(pool);

  pool.execute = async function patchedExecute(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (!/^SELECT \* FROM accounts WHERE user_id = \?/i.test(text)) return rawExecute(sql, params);

    const [accounts] = await rawExecute(sql, params);
    const normalized = [];

    for (const account of accounts) {
      const id = account.id;
      const initial = n(firstValue(account.initial_balance_cents, account.balance_cents), 0);

      const [closed] = await rawExecute(
        "SELECT COALESCE(SUM(realized_profit_cents),0) AS realized FROM trades WHERE account_id=? AND status='CLOSED'",
        [id]
      );
      const [open] = await rawExecute(
        "SELECT COALESCE(SUM(floating_profit_cents),0) AS floating FROM trades WHERE account_id=? AND status='OPEN'",
        [id]
      );

      const realized = n(closed[0]?.realized, 0);
      const floating = n(open[0]?.floating, 0);
      const balance = initial + realized;
      const equity = balance + floating;

      const model = String(account.challenge_model || '').toLowerCase();
      let cfg = {};
      try {
        const [cfgRows] = await rawExecute('SELECT * FROM challenge_configs WHERE model_key=? LIMIT 1', [model]);
        cfg = cfgRows[0] || {};
      } catch (_) {}

      const pick = (...keys) => firstValue(...keys.map(key => cfg[key] ?? account[key]));
      const warrior = model === 'warrior_5k';
      const direct = model === 'prototype_5k';
      const phase = String(firstValue(
        account.phase,
        account.account_phase,
        account.challenge_phase,
        warrior ? 'Phase 1' : direct ? 'Direct Funded' : '—'
      ));
      const phase2 = /(?:^|[^0-9])2(?:$|[^0-9])|phase\s*2/i.test(phase);

      // IMPORTANT: no invented profit target. Only a value explicitly configured in DB is shown.
      const targetCentsRaw = pick('profit_target_cents', 'target_profit_cents', 'target_cents');
      const targetCents = targetCentsRaw === null ? null : n(targetCentsRaw, null);
      const targetBpsRaw = pick(
        phase2 ? 'phase2_profit_target_bps' : 'phase1_profit_target_bps',
        phase2 ? 'profit_target_phase2_bps' : 'profit_target_phase1_bps',
        'profit_target_bps',
        'target_bps',
        'profit_target_percent_bps'
      );
      const targetPercentRaw = pick('profit_target_percent', 'target_percent', 'profit_target_pct', 'target_pct');
      const targetBps = targetBpsRaw === null ? null : n(targetBpsRaw, null);
      const targetPercentField = targetPercentRaw === null ? null : n(targetPercentRaw, null);
      const targetPercent = targetCents !== null
        ? (initial > 0 ? targetCents / initial * 100 : null)
        : targetBps !== null
          ? targetBps / 100
          : targetPercentField;
      const resolvedTarget = targetCents !== null
        ? targetCents
        : targetPercent !== null
          ? Math.round(initial * targetPercent / 100)
          : null;

      const dailyBpsRaw = pick('daily_dd_bps', 'daily_drawdown_bps');
      const maxBpsRaw = pick('max_dd_bps', 'max_drawdown_bps');
      const dailyBps = dailyBpsRaw === null ? null : n(dailyBpsRaw, null);
      const maxBps = maxBpsRaw === null ? null : n(maxBpsRaw, null);
      const maxTradesRaw = pick('max_trades_per_day', 'max_daily_trades');
      const maxTrades = maxTradesRaw === null ? (warrior ? 3 : null) : n(maxTradesRaw, null);

      const consistencyBpsRaw = pick('consistency_bps', 'consistency_rule_bps', 'consistency_percent_bps');
      const consistencyPctRaw = pick('consistency_percent', 'consistency_pct', 'consistency_rule_percent');
      const consistencyBps = consistencyBpsRaw === null ? null : n(consistencyBpsRaw, null);
      const consistencyPctField = consistencyPctRaw === null ? null : n(consistencyPctRaw, null);
      const consistencyLimit = consistencyBps !== null
        ? consistencyBps / 100
        : consistencyPctField !== null
          ? consistencyPctField
          : (warrior ? 30 : null);

      const dayStart = n(firstValue(account.day_start_balance_cents, initial), initial);
      const equityHwm = n(firstValue(account.equity_hwm_cents, initial), initial);
      const dailyLimit = dailyBps === null ? null : Math.round(dayStart * dailyBps / 10000);
      const maxBase = direct ? equityHwm : initial;
      const maxLimit = maxBps === null ? null : Math.round(maxBase * maxBps / 10000);
      const dailyUsed = Math.max(0, dayStart - balance);
      const maxUsed = direct ? Math.max(0, equityHwm - equity) : Math.max(0, initial - balance);

      const [days] = await rawExecute(
        "SELECT trading_day, SUM(CASE WHEN realized_profit_cents>0 THEN realized_profit_cents ELSE 0 END) AS day_profit FROM trades WHERE account_id=? AND status='CLOSED' GROUP BY trading_day",
        [id]
      );
      const dayProfits = days.map(row => n(row.day_profit, 0)).filter(v => v > 0);
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

      const profitAchievedCents = Math.max(0, balance - initial);
      const targetProgressPercent = resolvedTarget !== null && resolvedTarget > 0
        ? Math.max(0, Math.min(100, profitAchievedCents / resolvedTarget * 100))
        : null;

      normalized.push({
        ...account,
        balance_cents: balance,
        equity_cents: equity,
        realized_profit_cents: realized,
        floating_profit_cents: floating,
        account_size_cents: n(firstValue(account.account_size_cents, initial), initial),
        account_profile: {
          accountType: account.account_type || (warrior ? 'Warrior Account' : direct ? 'Direct Funded Account' : 'Challenge Account'),
          fundingModel: direct ? 'Direct Funded' : warrior ? 'Warrior' : (account.funding_model || 'Challenge'),
          phase,
          model: account.challenge_model || null,
          isDirectFunded: direct,
          isWarrior: warrior,
          rules: {
            maxTradesPerDay: maxTrades,
            tradesToday: n(todayRows[0]?.count, 0),
            openPositions: n(openRows[0]?.count, 0),
            maxOpenPositions: n(pick('max_open_positions', 'max_open_trades'), 1),
            consistencyLimitPercent: consistencyLimit,
            consistencyAchievedPercent: Number(consistencyAchieved.toFixed(2)),
            consistencyMet: consistencyLimit === null || consistencyAchieved <= Number(consistencyLimit),
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
            profitAchievedCents,
            targetProgressPercent
          }
        }
      });
    }

    return [normalized, undefined];
  };

  return pool;
};
