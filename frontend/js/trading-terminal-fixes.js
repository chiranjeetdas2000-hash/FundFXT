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

  function selected(list) {
    const q = new URLSearchParams(location.search);
    const wanted = q.get("account_code") || q.get("account") || localStorage.getItem("fundfxt_selected_account");
    return list.find((a) => String(a.account_code) === String(wanted)) || list[0] || null;
  }

  function pctFromBps(v) { return v == null ? null : n(v) / 100; }
  function progress(label, value, detail, tone = "green") {
    const p = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="terminal-rule-progress"><div><span>${esc(label)}</span><b>${p.toFixed(1)}%</b></div><i class="${tone}" style="width:${p}%"></i><small>${esc(detail)}</small></div>`;
  }

  async function renderAccountRules() {
    document.querySelector(".terminal-account-rules")?.remove();
    const shell = document.createElement("div");
    shell.className = "terminal-account-rules";
    shell.innerHTML = `<div class="terminal-rules-card"><header><div><small>LIVE ACCOUNT</small><h3>Account Rules</h3><span>Loading…</span></div><button type="button" class="terminal-rules-close">×</button></header><div class="terminal-rules-loading">Loading live account rules &amp; progress…</div></div>`;
    document.body.appendChild(shell);
    shell.querySelector(".terminal-rules-close").onclick = () => shell.remove();

    try {
      const accountsResponse = await api("/api/accounts");
      const a = selected(accountsResponse.accounts || accountsResponse);
      if (!a) throw Error("No trading account available");
      localStorage.setItem("fundfxt_selected_account", a.account_code);

      const model = encodeURIComponent(a.challenge_model || "");
      const [configResponse, tradesResponse] = await Promise.all([
        model ? api("/api/challenges/" + model) : Promise.resolve({ config: {} }),
        api("/api/trade/get?account_code=" + encodeURIComponent(a.account_code)),
      ]);
      const config = configResponse.config || {};
      const trades = Array.isArray(tradesResponse.trades) ? tradesResponse.trades : [];

      const initial = n(a.initial_balance_cents || config.starting_balance_cents || a.balance_cents);
      const closed = trades.filter((t) => String(t.status).toUpperCase() === "CLOSED");
      const open = trades.filter((t) => String(t.status).toUpperCase() === "OPEN");
      const realized = closed.reduce((s, t) => s + n(t.realized_profit_cents), 0);
      const floating = open.reduce((s, t) => s + n(t.floating_profit_cents), 0);
      const balance = initial + realized;
      const equity = balance + floating;

      const targetPct = pctFromBps(config.profit_target_bps);
      const targetAmount = targetPct != null ? Math.round(initial * targetPct / 100) : null;
      const achieved = Math.max(0, balance - initial);
      const targetProgress = targetAmount > 0 ? achieved / targetAmount * 100 : null;

      const dailyLimit = config.daily_dd_bps != null ? Math.round(n(config.daily_dd_bps) / 10000 * n(a.day_start_balance_cents || initial)) : null;
      const dailyUsed = Math.max(0, n(a.day_start_balance_cents || initial) - balance);
      const warrior = String(a.challenge_model || "").toLowerCase().includes("warrior");
      const maxLimit = config.max_dd_bps != null ? Math.round(n(config.max_dd_bps) / 10000 * (warrior ? initial : n(a.equity_hwm_cents || initial))) : null;
      const maxBase = warrior ? initial : n(a.equity_hwm_cents || initial);
      const maxUsed = Math.max(0, maxBase - equity);
      const maxTrades = config.max_trades_per_day != null ? n(config.max_trades_per_day) : null;
      const today = new Date().toISOString().slice(0, 10);
      const tradesToday = trades.filter((t) => String(t.trading_day || t.entry_time || t.created_at || "").slice(0, 10) === today).length;

      const ruleRows = [
        ["Challenge Model", a.challenge_model],
        ["Phase", a.phase],
        ["Starting Balance", money(initial)],
        ["Profit Target", targetPct == null ? "—" : targetPct.toFixed(2) + "%"],
        ["Daily Drawdown", dailyLimit == null ? "—" : money(dailyLimit)],
        ["Maximum Drawdown", maxLimit == null ? "—" : money(maxLimit)],
        ["Max Trades / Day", maxTrades == null ? "—" : maxTrades],
        ["Account Status", a.status],
      ].map(([label, value]) => `<div class="terminal-rule-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("");

      shell.querySelector(".terminal-rules-card").innerHTML = `<header><div><small>LIVE ACCOUNT</small><h3>${esc(a.account_code)}</h3><span>${esc(a.challenge_model || "Trading Account")}</span></div><button type="button" class="terminal-rules-close">×</button></header><section class="terminal-account-metrics"><div><span>Balance</span><b>${money(balance)}</b></div><div><span>Equity</span><b>${money(equity)}</b></div><div><span>Realized P/L</span><b>${money(realized)}</b></div><div><span>Floating P/L</span><b>${money(floating)}</b></div></section><section class="terminal-progress"><div class="terminal-progress-title"><span>PROGRESS REPORT</span><b>${targetProgress == null ? "—" : Math.min(100, Math.max(0, targetProgress)).toFixed(1) + "%"}</b></div>${targetProgress == null ? "<div class=\"terminal-rule-empty\">Profit target is not available from the challenge configuration.</div>" : progress("Target achieved", targetProgress, `${money(achieved)} achieved of ${money(targetAmount)}`)}${dailyLimit == null ? "" : progress("Daily drawdown used", dailyLimit ? dailyUsed / dailyLimit * 100 : 0, `${money(dailyUsed)} used of ${money(dailyLimit)} limit`, dailyUsed / dailyLimit >= .8 ? "danger" : "amber")}${maxLimit == null ? "" : progress("Maximum drawdown used", maxLimit ? maxUsed / maxLimit * 100 : 0, `${money(maxUsed)} used of ${money(maxLimit)} limit`, maxUsed / maxLimit >= .8 ? "danger" : "amber")}${maxTrades == null ? "" : progress("Daily trades used", maxTrades ? tradesToday / maxTrades * 100 : 0, `${tradesToday} of ${maxTrades} trades`, tradesToday >= maxTrades ? "danger" : "green")}</section><section class="terminal-rules-list"><div class="terminal-rules-list-title">ACCOUNT RULES</div>${ruleRows}</section>`;
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
      document.querySelectorAll(".right-section-tab").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
    }
    document.querySelectorAll(".mobile-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  }

  function install() {
    document.addEventListener("click", (e) => {
      if (e.target.closest("#accountMenuBtn")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (document.querySelector(".terminal-account-rules")) document.querySelector(".terminal-account-rules")?.remove(); else renderAccountRules();
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