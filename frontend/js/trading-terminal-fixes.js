/* ===== FUNDFXT TERMINAL ACCOUNT RULES / RESPONSIVE CONTROLS ===== */
(function () {
  "use strict";

  const API = "https://fundfxt.onrender.com";
  const token = () => localStorage.getItem("fundfxt_token") || "";
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const money = (c) =>
    "$" +
    (n(c) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const esc = (v) =>
    String(v ?? "—").replace(/[&<>"']/g, (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[m],
    );

  async function api(path) {
    const r = await fetch(API + path, {
      headers: {
        Authorization: "Bearer " + token(),
        "Content-Type": "application/json",
      },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || d.message || `Request failed (${r.status})`);
    return d;
  }

  function selected(list) {
    const q = new URLSearchParams(location.search);
    const wanted =
      q.get("account_code") ||
      q.get("account") ||
      localStorage.getItem("fundfxt_selected_account");
    return (
      list.find((a) => String(a.account_code) === String(wanted)) ||
      list[0] ||
      null
    );
  }

  function pctFromBps(v) {
    return v == null ? null : n(v) / 100;
  }

  function progress(label, value, detail, tone = "green") {
    const p = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="terminal-rule-progress"><div><span>${esc(label)}</span><b>${p.toFixed(1)}%</b></div><i class="${tone}" style="width:${p}%"></i><small>${esc(detail)}</small></div>`;
  }

  async function renderAccountRules() {
    document.querySelector(".terminal-account-rules")?.remove();

    const shell = document.createElement("div");
    shell.className = "terminal-account-rules";
    shell.innerHTML =
      `<div class="terminal-rules-card"><header><div><small>LIVE ACCOUNT</small><h3>Account Rules</h3><span>Loading…</span></div><button type="button" class="terminal-rules-close">×</button></header><div class="terminal-rules-loading">Loading live account rules &amp; progress…</div></div>`;
    document.body.appendChild(shell);
    shell.querySelector(".terminal-rules-close").onclick = () => shell.remove();

    try {
      const accountsResponse = await api("/api/accounts");
      const accounts = accountsResponse.accounts || accountsResponse;
      const a = selected(accounts);
      if (!a) throw Error("No trading account available");
      localStorage.setItem("fundfxt_selected_account", a.account_code);

      const model = encodeURIComponent(a.challenge_model || "");
      const [configResponse, tradesResponse] = await Promise.all([
        model
          ? api("/api/challenges/" + model)
          : Promise.resolve({}),
        api(
          "/api/trade/get?account_code=" +
            encodeURIComponent(a.account_code),
        ),
      ]);

      // The challenge endpoint has existed in more than one response shape.
      // Accept the actual config object without inventing fallback rule values.
      const config =
        configResponse?.config ||
        configResponse?.challenge_config ||
        configResponse?.challenge ||
        configResponse ||
        {};

      const trades = Array.isArray(tradesResponse.trades)
        ? tradesResponse.trades
        : [];

      const initial = n(
        a.initial_balance_cents ||
          config.starting_balance_cents ||
          a.balance_cents,
      );

      const closed = trades.filter(
        (t) => String(t.status).toUpperCase() === "CLOSED",
      );
      const open = trades.filter(
        (t) => String(t.status).toUpperCase() === "OPEN",
      );

      // Realized P/L is the sum of closed trades only.
      const realized = closed.reduce(
        (sum, t) => sum + n(t.realized_profit_cents),
        0,
      );
      const floating = open.reduce(
        (sum, t) => sum + n(t.floating_profit_cents),
        0,
      );
      const balance = initial + realized;
      const equity = balance + floating;

      // Profit target is based on realized progress, not floating P/L.
      const targetPct = pctFromBps(config.profit_target_bps);
      const targetAmount =
        targetPct != null ? Math.round((initial * targetPct) / 100) : null;
      const achieved = Math.max(0, realized);
      const targetProgress =
        targetAmount > 0 ? (achieved / targetAmount) * 100 : null;

      /*
       * Daily drawdown:
       * Only today's P/L is allowed to consume today's loss limit.
       * Previous-day profit/loss must not be treated as today's loss.
       * A profitable day has zero drawdown used until today's net P/L turns negative.
       * Floating P/L from positions opened today is included because it affects today's
       * current equity. Closed trades contribute their realized P/L for today.
       */
      const today = new Date().toISOString().slice(0, 10);
      const todayTrades = trades.filter((t) =>
        String(t.trading_day || t.entry_time || t.created_at || "").slice(0, 10) ===
          today,
      );
      const todayRealized = todayTrades
        .filter((t) => String(t.status).toUpperCase() === "CLOSED")
        .reduce((sum, t) => sum + n(t.realized_profit_cents), 0);
      const todayFloating = todayTrades
        .filter((t) => String(t.status).toUpperCase() === "OPEN")
        .reduce((sum, t) => sum + n(t.floating_profit_cents), 0);
      const todayNetPnL = todayRealized + todayFloating;
      const dayStart = n(a.day_start_balance_cents || initial);
      const dailyLimit =
        config.daily_dd_bps != null
          ? Math.round((n(config.daily_dd_bps) / 10000) * dayStart)
          : null;
      const dailyUsed = Math.max(0, -todayNetPnL);

      /*
       * Maximum drawdown for the current FundFXT rules is static/balance based:
       * initial balance is the fixed base. It is NOT calculated from floating equity
       * and it does NOT move with an equity watermark.
       */
      const maxLimit =
        config.max_dd_bps != null
          ? Math.round((n(config.max_dd_bps) / 10000) * initial)
          : null;
      const maxUsed = Math.max(0, initial - balance);

      const maxTrades =
        config.max_trades_per_day != null
          ? n(config.max_trades_per_day)
          : null;
      const tradesToday = todayTrades.length;

      const ruleRows = [
        ["Challenge Model", a.challenge_model],
        ["Phase", a.phase],
        ["Starting Balance", money(initial)],
        [
          "Profit Target",
          targetPct == null ? "—" : targetPct.toFixed(2) + "%",
        ],
        ["Daily Drawdown", dailyLimit == null ? "—" : money(dailyLimit)],
        ["Maximum Drawdown", maxLimit == null ? "—" : money(maxLimit)],
        ["Max Trades / Day", maxTrades == null ? "—" : maxTrades],
        ["Account Status", a.status],
      ]
        .map(
          ([label, value]) =>
            `<div class="terminal-rule-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`,
        )
        .join("");

      const targetBlock =
        targetProgress == null
          ? `<div class="terminal-rule-empty">Profit target is not available from the challenge configuration.</div>`
          : progress(
              "Profit target progress",
              targetProgress,
              `${money(achieved)} realized of ${money(targetAmount)} target`,
              targetProgress >= 100 ? "green" : "green",
            );

      const dailyBlock =
        dailyLimit == null
          ? ""
          : progress(
              "Daily drawdown used",
              dailyLimit ? (dailyUsed / dailyLimit) * 100 : 0,
              `${money(dailyUsed)} used of ${money(dailyLimit)} limit · Today P/L ${
                todayNetPnL >= 0 ? "+" : ""
              }${money(todayNetPnL)}`,
              dailyUsed / dailyLimit >= 0.8 ? "danger" : "amber",
            );

      const maxBlock =
        maxLimit == null
          ? ""
          : progress(
              "Maximum drawdown used",
              maxLimit ? (maxUsed / maxLimit) * 100 : 0,
              `${money(maxUsed)} used of ${money(maxLimit)} limit · Static base ${money(initial)}`,
              maxUsed / maxLimit >= 0.8 ? "danger" : "amber",
            );

      const tradesBlock =
        maxTrades == null
          ? ""
          : progress(
              "Daily trades used",
              maxTrades ? (tradesToday / maxTrades) * 100 : 0,
              `${tradesToday} of ${maxTrades} trades`,
              tradesToday >= maxTrades ? "danger" : "green",
            );

      shell.querySelector(".terminal-rules-card").innerHTML =
        `<header><div><small>LIVE ACCOUNT</small><h3>${esc(a.account_code)}</h3><span>${esc(a.challenge_model || "Trading Account")}</span></div><button type="button" class="terminal-rules-close">×</button></header><section class="terminal-account-metrics"><div><span>Balance</span><b>${money(balance)}</b></div><div><span>Equity</span><b>${money(equity)}</b></div><div><span>Realized P/L</span><b>${money(realized)}</b></div><div><span>Floating P/L</span><b>${money(floating)}</b></div></section><section class="terminal-progress"><div class="terminal-progress-title"><span>PROGRESS REPORT</span><b>${targetProgress == null ? "—" : Math.min(100, Math.max(0, targetProgress)).toFixed(1) + "%"}</b></div>${targetBlock}${dailyBlock}${maxBlock}${tradesBlock}</section><section class="terminal-rules-list"><div class="terminal-rules-list-title">ACCOUNT RULES</div>${ruleRows}</section>`;

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

  function activateMobileView(name) {
    const valid = ["pairs", "center", "trades"];
    const view = valid.includes(name) ? name : "center";

    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.remove("mobile-active"),
    );

    if (view === "center") {
      document.getElementById("center")?.classList.add("mobile-active");
    } else {
      const right = document.getElementById("right");
      right?.classList.add("mobile-active");

      // Mobile/tablet must show exactly one terminal section at a time.
      document.querySelectorAll(".terminal-section").forEach((section) => {
        section.classList.toggle(
          "active",
          section.id ===
            "terminal" + view.charAt(0).toUpperCase() + view.slice(1),
        );
      });

      document.querySelectorAll(".right-section-tab").forEach((button) =>
        button.classList.toggle("active", button.dataset.section === view),
      );

      if (view === "trades") window.loadTrades?.();
    }

    document.querySelectorAll(".mobile-nav button").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view),
    );
  }

  function openSection(name) {
    activateMobileView(name);
  }

  function install() {
    document.addEventListener(
      "click",
      (e) => {
        if (e.target.closest("#accountMenuBtn")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (document.querySelector(".terminal-account-rules")) {
            document.querySelector(".terminal-account-rules")?.remove();
          } else {
            renderAccountRules();
          }
        }

        if (e.target.closest("#terminalLogoutBtn")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          logout();
        }
      },
      true,
    );

    document.querySelectorAll(".right-section-tab").forEach((button) =>
      button.addEventListener("click", () => {
        const section = button.dataset.section;
        document
          .querySelectorAll(".right-section-tab")
          .forEach((x) => x.classList.remove("active"));
        document
          .querySelectorAll(".terminal-section")
          .forEach((x) => x.classList.remove("active"));
        button.classList.add("active");
        document
          .getElementById(
            "terminal" + section.charAt(0).toUpperCase() + section.slice(1),
          )
          ?.classList.add("active");
      }),
    );

    document.querySelectorAll(".mobile-nav button").forEach(
      (button) =>\ {
        button.onclick = () => activateMobileView(button.dataset.view);
      },
    );

    document
      .getElementById("ordersRefresh")
      ?.addEventListener("click", () => window.showPendingOrders?.());

    window.openTerminalSection = openSection;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
