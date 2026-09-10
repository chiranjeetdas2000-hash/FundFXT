/* ===== FUNDFXT TERMINAL ACCOUNT RULES / RESPONSIVE CONTROLS ===== */
(function () {
  "use strict";

  const API = "https://fundfxt.onrender.com";
  const token = () => localStorage.getItem("fundfxt_token") || "";
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const money = (c) => "$" + (n(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (v) => String(v ?? "—").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  async function api(path) {
    const r = await fetch(API + path, { headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || d.message || `Request failed (${r.status})`);
    return d;
  }

  function accountFrom(list) {
    const q = new URLSearchParams(location.search);
    const wanted = q.get("account_code") || q.get("account") || localStorage.getItem("fundfxt_selected_account");
    return list.find((a) => String(a.account_code) === String(wanted)) || list[0] || null;
  }

  function rulesOf(a) {
    const p = a?.account_profile || {};
    return p.rules || a?.rules || {};
  }

  function readRule(a, ...keys) {
    const r = rulesOf(a);
    for (const key of keys) {
      if (r[key] != null) return r[key];
      if (a?.[key] != null) return a[key];
    }
    return null;
  }

  function percentRule(v) {
    if (v == null || !Number.isFinite(Number(v))) return null;
    const x = Number(v);
    return x > 100 ? x / 100 : x;
  }

  function progress(label, value, detail, tone = "green") {
    const p = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="terminal-rule-progress"><div><span>${esc(label)}</span><b>${p.toFixed(1)}%</b></div><i class="${tone}" style="width:${p}%"></i><small>${esc(detail)}</small></div>`;
  }

  async function renderAccountRules() {
    document.querySelector(".terminal-account-rules")?.remove();
    const shell = document.createElement("div");
    shell.className = "terminal-account-rules";
    shell.innerHTML = `<div class="terminal-rules-card"><header><div><small>LIVE ACCOUNT</small><h3>Account Rules</h3><span id="rulesAccountId">Loading…</span></div><button type="button" class="terminal-rules-close">×</button></header><div class="terminal-rules-loading">Loading live account rules &amp; progress…</div></div>`;
    document.body.appendChild(shell);
    shell.querySelector(".terminal-rules-close").onclick = () => shell.remove();

    try {
      const d = await api("/api/accounts");
      const list = d.accounts || d;
      const a = accountFrom(list);
      if (!a) throw Error("No trading account available");
      localStorage.setItem("fundfxt_selected_account", a.account_code);

      const tradesResponse = await api("/api/trade/get?account_code=" + encodeURIComponent(a.account_code));
      const trades = Array.isArray(tradesResponse.trades) ? tradesResponse.trades : [];
      const initial = n(a.initial_balance_cents || a.balance_cents);
      const closed = trades.filter((t) => String(t.status).toUpperCase() === "CLOSED");
      const open = trades.filter((t) => String(t.status).toUpperCase() === "OPEN");
      const realized = closed.reduce((s, t) => s + n(t.realized_profit_cents), 0);
      const floating = open.reduce((s, t) => s + n(t.floating_profit_cents), 0);
      const balance = initial + realized;
      const equity = balance + floating;

      const targetPct = percentRule(readRule(a, "profitTargetPercent", "profit_target_percent"));
      const targetCents = readRule(a, "profitTargetCents", "profit_target_cents");
      const targetAmount = targetCents != null ? n(targetCents) : targetPct != null ? Math.round(initial * targetPct / 100) : null;
      const achieved = Math.max(0, balance - initial);
      const targetProgress = targetAmount > 0 ? achieved / targetAmount * 100 : null;

      const dailyLimit = readRule(a, "dailyDrawdownCents", "daily_drawdown_cents");
      const maxLimit = readRule(a, "maxDrawdownCents", "max_drawdown_cents");
      const dayStart = n(a.day_start_balance_cents || initial);
      const dailyUsed = Math.max(0, dayStart - balance);
      const model = String(a.challenge_model || "").toLowerCase();
      const warrior = model.includes("warrior") || Boolean(a.account_profile?.isWarrior);
      const maxBase = warrior ? initial : n(a.equity_hwm_cents || initial);
      const maxUsed = Math.max(0, maxBase - equity);
      const maxTrades = readRule(a, "maxTradesPerDay", "max_trades_per_day");
      const today = new Date().toISOString().slice(0, 10);
      const tradesToday = trades.filter((t) => String(t.trading_day || t.entry_time || t.created_at || "").slice(0, 10) === today).length;

      const rules = rulesOf(a);
      const rows = [];
      if (targetAmount != null) rows.push(`<div class="terminal-rule-row"><span>Profit Target</span><b>${targetPct != null ? targetPct.toFixed(2) + "%" : money(targetAmount)}</b></div>`);
      if (dailyLimit != null) rows.push(`<div class="terminal-rule-row"><span>Daily Drawdown Limit</span><b>${money(dailyLimit)}</b></div>`);
      if (maxLimit != null) rows.push(`<div class="terminal-rule-row"><span>Maximum Drawdown Limit</span><b>${money(maxLimit)}</b></div>`);
      if (maxTrades != null) rows.push(`<div class="terminal-rule-row"><span>Maximum Trades / Day</span><b>${maxTrades}</b></div>`);
      Object.entries(rules).filter(([k]) => !/profitTarget|dailyDrawdown|maxDrawdown|maxTrades|tradesToday|consistency/i.test(k)).slice(0, 8).forEach(([k, v]) => rows.push(`<div class="terminal-rule-row"><span>${esc(k.replace(/([A-Z])/g, " $1").replace(/_/g, " "))}</span><b>${esc(v)}</b></div>`));

      shell.querySelector(".terminal-rules-card").innerHTML = `<header><div><small>LIVE ACCOUNT</small><h3>${esc(a.account_code)}</h3><span>${esc(a.challenge_model || "Trading Account")}</span></div><button type="button" class="terminal-rules-close">×</button></header><section class="terminal-account-metrics"><div><span>Balance</span><b>${money(balance)}</b></div><div><span>Equity</span><b>${money(equity)}</b></div><div><span>Realized P/L</span><b>${money(realized)}</b></div><div><span>Floating P/L</span><b>${money(floating)}</b></div></section><section class="terminal-progress"><div class="terminal-progress-title"><span>PROGRESS REPORT</span><b>${targetProgress == null ? "—" : Math.min(100, Math.max(0, targetProgress)).toFixed(1) + "%"}</b></div>${targetProgress == null ? "<div class=\"terminal-rule-empty\">Profit target is not exposed by the account data.</div>" : progress("Target achieved", targetProgress, `${money(achieved)} achieved of ${money(targetAmount)}`)}${dailyLimit == null ? "" : progress("Daily drawdown used", dailyLimit ? dailyUsed / n(dailyLimit) * 100 : 0, `${money(dailyUsed)} used of ${money(dailyLimit)} limit`, dailyUsed / n(dailyLimit) >= .8 ? "danger" : "amber")}${maxLimit == null ? "" : progress("Maximum drawdown used", maxLimit ? maxUsed / n(maxLimit) * 100 : 0, `${money(maxUsed)} used of ${money(maxLimit)} limit`, maxUsed / n(maxLimit) >= .8 ? "danger" : "amber")}${maxTrades == null ? "" : progress("Daily trades used", maxTrades ? tradesToday / n(maxTrades) * 100 : 0, `${tradesToday} of ${maxTrades} trades`, tradesToday >= n(maxTrades) ? "danger" : "green")}</section><section class="terminal-rules-list"><div class="terminal-rules-list-title">ACCOUNT RULES</div>${rows.join("") || "<div class=\"terminal-rule-empty\">No additional rule fields were returned by the backend.</div>"}</section>`;
      shell.querySelector(".terminal-rules-close").onclick = () => shell.remove();
    } catch (e) {
      shell.querySelector(".terminal-rules-loading").textContent = e.message;
    }
  }

  function logout() {
    localStorage.removeItem("fundfxt_token");
    localStorage.removeItem("fundfxt_selected_account");
    location.href = "/dashboard.html";
  }

  function openSection(name) {
    if (name === "center") {
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("mobile-active"));
      document.getElementById("center")?.classList.add("mobile-active");
    } else {
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("mobile-active"));
      document.getElementById("right")?.classList.add("mobile-active");
      document.querySelectorAll(".terminal-section").forEach((s) => s.classList.toggle("active", s.id === "terminal" + name.charAt(0).toUpperCase() + name.slice(1)));
    }
    document.querySelectorAll(".mobile-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  }

  function install() {
    const account = document.getElementById("accountMenuBtn");
    const power = document.getElementById("terminalLogoutBtn");
    document.addEventListener("click", (e) => {
      if (e.target.closest("#accountMenuBtn")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const open = document.querySelector(".terminal-account-rules");
        if (open) open.remove(); else renderAccountRules();
      }
      if (e.target.closest("#terminalLogoutBtn")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        logout();
      }
    }, true);

    document.querySelectorAll(".right-section-tab").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll(".right-section-tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".terminal-section").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("terminal" + b.dataset.section.charAt(0).toUpperCase() + b.dataset.section.slice(1))?.classList.add("active");
    }));

    document.querySelectorAll(".mobile-nav button").forEach((b) => b.onclick = () => openSection(b.dataset.view));
    document.getElementById("ordersRefresh")?.addEventListener("click", () => window.showPendingOrders?.());
    window.openTerminalSection = openSection;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();