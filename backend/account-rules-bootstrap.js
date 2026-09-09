// FundFXT account rules bootstrap.
// Keeps account rule metadata database-first and prevents the terminal from
// inventing challenge targets when the database does not contain them.
const fs = require('fs');
const mysql = require('mysql2/promise');

const originalReadFileSync = fs.readFileSync;
const originalCreatePool = mysql.createPool;
const DEFAULTS = {
  prototype_5k: {
    account_type: 'Direct Funded Account',
    funding_model: 'Direct Funded',
    phase: 'Direct Funded',
    max_trades_per_day: null,
    consistency_percent: null,
    daily_drawdown_percent: 2,
    max_drawdown_percent: 5,
    profit_target_percent: null
  },
  warrior_5k: {
    account_type: 'Warrior Account',
    funding_model: 'Warrior',
    phase: 'Phase 1',
    max_trades_per_day: 3,
    consistency_percent: 30,
    daily_drawdown_percent: 5,
    max_drawdown_percent: 8,
    profit_target_percent: null
  }
};

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function first(...xs) { return xs.find(v => v !== null && v !== undefined && v !== ''); }
// Compatibility for the production entrypoint's account normalizer.
global.first = first;

// The production entrypoint rewrites /api/accounts. Make that rewrite skip the
// route so the database-aware normalization below owns the response.
fs.readFileSync = function(file, encoding, ...rest) {
  const value = originalReadFileSync.call(this, file, encoding, ...rest);
  if (typeof file !== 'string' || !/backend[\\/]server\\.js$/.test(file) || typeof value !== 'string') return value;
  return value
    .replace(/app\.get\('\/api\/accounts'/g, "app.get /*ACCOUNT_RULES_BOOTSTRAP*/ ('/api/accounts'")
    .replace(/SELECT COUNT\(\*\) AS count FROM trades WHERE account_id = \? AND trading_day = CURDATE\(\) AND status = 'OPEN'/g,
      "SELECT COUNT(*) AS count FROM trades WHERE account_id = ? AND trading_day = CURDATE()");
};

let ready;
async function ensureDefaults(pool) {
  if (ready) return ready;
  ready = (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS account_rule_defaults (
        model_key VARCHAR(64) NOT NULL PRIMARY KEY,
        account_type VARCHAR(100) NULL,
        funding_model VARCHAR(100) NULL,
        default_phase VARCHAR(100) NULL,
        max_trades_per_day INT NULL,
        consistency_percent DECIMAL(8,3) NULL,
        daily_drawdown_percent DECIMAL(8,3) NULL,
        max_drawdown_percent DECIMAL(8,3) NULL,
        profit_target_percent DECIMAL(8,3) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      for (const [model, d] of Object.entries(DEFAULTS)) {
        await pool.execute(`INSERT INTO account_rule_defaults
          (model_key,account_type,funding_model,default_phase,max_trades_per_day,consistency_percent,daily_drawdown_percent,max_drawdown_percent,profit_target_percent)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE
            account_type=COALESCE(account_rule_defaults.account_type,VALUES(account_type)),
            funding_model=COALESCE(account_rule_defaults.funding_model,VALUES(funding_model)),
            default_phase=COALESCE(account_rule_defaults.default_phase,VALUES(default_phase)),
            max_trades_per_day=COALESCE(account_rule_defaults.max_trades_per_day,VALUES(max_trades_per_day)),
            consistency_percent=COALESCE(account_rule_defaults.consistency_percent,VALUES(consistency_percent)),
            daily_drawdown_percent=COALESCE(account_rule_defaults.daily_drawdown_percent,VALUES(daily_drawdown_percent)),
            max_drawdown_percent=COALESCE(account_rule_defaults.max_drawdown_percent,VALUES(max_drawdown_percent)),
            profit_target_percent=COALESCE(account_rule_defaults.profit_target_percent,VALUES(profit_target_percent))`,
          [model,d.account_type,d.funding_model,d.phase,d.max_trades_per_day,d.consistency_percent,d.daily_drawdown_percent,d.max_drawdown_percent,d.profit_target_percent]);
      }
      console.log('FundFXT: account_rule_defaults ready.');
    } catch (e) {
      console.error('FundFXT: account rule bootstrap warning:', e.message);
    }
  })();
  return ready;
}

mysql.createPool = function(...args) {
  const pool = originalCreatePool.apply(this, args);
  const rawExecute = pool.execute.bind(pool);
  const rawQuery = pool.query.bind(pool);

  pool.query = async function(sql, params) { return rawQuery(sql, params); };
  pool.execute = async function(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (!/^SELECT \* FROM accounts WHERE user_id = \?/i.test(text)) return rawExecute(sql, params);
    await ensureDefaults(pool);
    const [accounts] = await rawExecute(sql, params);
    const out = [];

    for (const account of accounts) {
      const id = account.id;
      const initial = first(finite(account.initial_balance_cents), finite(account.balance_cents), 0);
      const [closed] = await rawExecute("SELECT COALESCE(SUM(realized_profit_cents),0) AS realized FROM trades WHERE account_id=? AND status='CLOSED'", [id]);
      const [open] = await rawExecute("SELECT COALESCE(SUM(floating_profit_cents),0) AS floating FROM trades WHERE account_id=? AND status='OPEN'", [id]);
      const realized = first(finite(closed[0]?.realized), 0);
      const floating = first(finite(open[0]?.floating), 0);
      const balance = initial + realized;
      const equity = balance + floating;

      const model = String(account.challenge_model || '').toLowerCase();
      const [cfgRows] = await rawExecute('SELECT * FROM challenge_configs WHERE model_key=? LIMIT 1', [model]);
      const cfg = cfgRows[0] || {};
      const [defRows] = await rawExecute('SELECT * FROM account_rule_defaults WHERE model_key=? LIMIT 1', [model]);
      const def = defRows[0] || DEFAULTS[model] || {};
      const pick = (...keys) => first(...keys.map(k => cfg[k]), ...keys.map(k => account[k]), ...keys.map(k => def[k]));

      const isWarrior = model === 'warrior_5k';
      const isDirect = model === 'prototype_5k';
      const accountType = first(account.account_type, def.account_type, isWarrior ? 'Warrior Account' : isDirect ? 'Direct Funded Account' : 'Challenge Account');
      const fundingModel = first(account.funding_model, def.funding_model, isWarrior ? 'Warrior' : isDirect ? 'Direct Funded' : 'Challenge');
      const phase = String(first(account.phase, account.account_phase, account.challenge_phase, def.default_phase, isWarrior ? 'Phase 1' : isDirect ? 'Direct Funded' : '—'));
      const phase2 = /phase\s*2|(?:^|[^0-9])2(?:$|[^0-9])/i.test(phase);

      const targetCentsRaw = pick('profit_target_cents','target_profit_cents','target_cents');
      const targetCents = targetCentsRaw == null ? null : finite(targetCentsRaw);
      const targetBpsRaw = first(
        ...([phase2 ? 'phase2_profit_target_bps' : 'phase1_profit_target_bps', phase2 ? 'profit_target_phase2_bps' : 'profit_target_phase1_bps','profit_target_bps','target_bps','profit_target_percent_bps']).map(k => cfg[k]),
        ...([phase2 ? 'phase2_profit_target_bps' : 'phase1_profit_target_bps', phase2 ? 'profit_target_phase2_bps' : 'profit_target_phase1_bps','profit_target_bps','target_bps','profit_target_percent_bps']).map(k => account[k]),
        ...([phase2 ? 'phase2_profit_target_bps' : 'phase1_profit_target_bps', phase2 ? 'profit_target_phase2_bps' : 'profit_target_phase1_bps','profit_target_bps','target_bps','profit_target_percent_bps']).map(k => def[k])
      );
      const targetPercentField = first(cfg.profit_target_percent,cfg.target_percent,cfg.profit_target_pct,cfg.target_pct,account.profit_target_percent,account.target_percent,account.profit_target_pct,account.target_pct,def.profit_target_percent);
      const targetPercent = targetCents != null ? (initial > 0 ? targetCents / initial * 100 : null) : targetBps != null ? finite(targetBps) / 100 : targetPercentField != null ? finite(targetPercentField) : null;
      const resolvedTarget = targetCents != null ? targetCents : targetPercent != null ? Math.round(initial * targetPercent / 100) : null;

      const dailyPercent = first(
        cfg.daily_drawdown_percent,cfg.daily_dd_percent,account.daily_drawdown_percent,account.daily_dd_percent,def.daily_drawdown_percent,
        cfg.daily_dd_bps != null ? finite(cfg.daily_dd_bps)/100 : null
      );
      const maxPercent = first(
        cfg.max_drawdown_percent,cfg.max_dd_percent,account.max_drawdown_percent,account.max_dd_percent,def.max_drawdown_percent,
        cfg.max_dd_bps != null ? finite(cfg.max_dd_bps)/100 : null
      );
      const maxTrades = first(account.max_trades_per_day,account.max_daily_trades,cfg.max_trades_per_day,cfg.max_daily_trades,def.max_trades_per_day);
      const consistencyLimit = first(account.consistency_percent,account.consistency_limit_percent,cfg.consistency_percent,cfg.consistency_pct,def.consistency_percent);

      const dayStart = first(finite(account.day_start_balance_cents), initial);
      const hwm = first(finite(account.equity_hwm_cents), initial);
      const dailyLimit = dailyPercent == null ? null : Math.round(dayStart * finite(dailyPercent) / 100);
      const maxBase = isDirect ? hwm : initial;
      const maxLimit = maxPercent == null ? null : Math.round(maxBase * finite(maxPercent) / 100);
      const dailyUsed = Math.max(0, dayStart - balance);
      const maxUsed = isDirect ? Math.max(0, hwm - equity) : Math.max(0, initial - balance);

      const [days] = await rawExecute("SELECT trading_day,SUM(CASE WHEN realized_profit_cents>0 THEN realized_profit_cents ELSE 0 END) AS day_profit FROM trades WHERE account_id=? AND status='CLOSED' GROUP BY trading_day", [id]);
      const profits = days.map(x => finite(x.day_profit)).filter(x => x > 0);
      const totalPositive = profits.reduce((s,x)=>s+x,0);
      const bestDay = profits.length ? Math.max(...profits) : 0;
      const consistencyAchieved = totalPositive > 0 ? bestDay / totalPositive * 100 : 0;
      const [today] = await rawExecute('SELECT COUNT(*) AS count FROM trades WHERE account_id=? AND trading_day=CURDATE()', [id]);
      const [opens] = await rawExecute("SELECT COUNT(*) AS count FROM trades WHERE account_id=? AND status='OPEN'", [id]);
      const achieved = Math.max(0, balance - initial);
      const progress = resolvedTarget != null && resolvedTarget > 0 ? Math.max(0, Math.min(100, achieved / resolvedTarget * 100)) : null;

      out.push({ ...account, balance_cents: balance, equity_cents: equity, realized_profit_cents: realized, floating_profit_cents: floating,
        account_profile: { accountType, fundingModel, phase, model: account.challenge_model || null, isDirectFunded:isDirect, isWarrior,
          rules:{ maxTradesPerDay: maxTrades == null ? null : finite(maxTrades), tradesToday: finite(today[0]?.count)||0, openPositions: finite(opens[0]?.count)||0,
            maxOpenPositions: first(finite(cfg.max_open_positions),finite(account.max_open_positions),1), consistencyLimitPercent:consistencyLimit==null?null:finite(consistencyLimit),
            consistencyAchievedPercent:Number(consistencyAchieved.toFixed(2)), consistencyMet:consistencyLimit==null||consistencyAchieved<=finite(consistencyLimit),
            dailyDrawdownPercent:dailyPercent==null?null:finite(dailyPercent), dailyDrawdownCents:dailyLimit, dailyDrawdownUsedCents:dailyUsed,
            dailyDrawdownRemainingCents:dailyLimit==null?null:Math.max(0,dailyLimit-dailyUsed), maximumDrawdownPercent:maxPercent==null?null:finite(maxPercent),
            maxDrawdownCents:maxLimit,maxDrawdownUsedCents:maxUsed,maxDrawdownRemainingCents:maxLimit==null?null:Math.max(0,maxLimit-maxUsed),
            profitTargetPercent:targetPercent,profitTargetCents:resolvedTarget,profitAchievedCents:achieved,targetProgressPercent:progress } }
      });
    }
    return [out, undefined];
  };
  return pool;
};
