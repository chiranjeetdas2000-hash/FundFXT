/* ===== FUNDFXT TERMINAL UI / ACCOUNT OVERVIEW ===== */
(function () {
  "use strict";

  const API = "https://fundfxt.onrender.com";
  const token = () => localStorage.getItem("fundfxt_token") || "";
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const money = (c) =>
    "$" +
    (num(c) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const pct = (v) =>
    v == null || !Number.isFinite(Number(v)) ? "—" : num(v).toFixed(1) + "%";
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

  async function rawJson(path, opt = {}) {
    const r = await fetch(API + path, {
      ...opt,
      headers: {
        Authorization: "Bearer " + token(),
        "Content-Type": "application/json",
        ...(opt.headers || {}),
      },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || "Request failed");
    return d;
  }

  function selectedAccount(list) {
    const q = new URLSearchParams(location.search);
    const wanted =
      q.get("account_code") ||
      q.get("account") ||
      localStorage.getItem("fundfxt_selected_account");
    return list.find((a) => String(a.account_code) === String(wanted)) || list[0] || null;
  }

  async function tradesFor(account) {
    if (!account) return [];
    try {
      const d = await rawJson(
        "/api/trade/get?account_code=" + encodeURIComponent(account.account_code),
      );
      return Array.isArray(d.trades) ? d.trades : [];
    } catch {
      return [];
    }
  }

  function ledger(account, trades) {
    const initial = Math.round(
      num(account.initial_balance_cents ?? account.balance_cents),
    );
    const closed = trades.filter(
      (t) => String(t.status).toUpperCase() === "CLOSED",
    );
    const open = trades.filter(
      (t) => String(t.status).toUpperCase() === "OPEN",
    );
    const realized = Math.round(
      closed.reduce((s, t) => s + num(t.realized_profit_cents), 0),
    );
    const floating = Math.round(
      open.reduce((s, t) => s + num(t.floating_profit_cents), 0),
    );
    return {
      initial,
      balance: initial + realized,
      equity: initial + realized + floating,
      realized,
      floating,
      openCount: open.length,
    };
  }

  /* Keep the account list ledger consistent with the closed/open trade ledger. */
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const response = await originalFetch(input, init);
    if (!url.includes("/api/accounts")) return response;

    try {
      const payload = await response.clone().json();
      const list = Array.isArray(payload.accounts) ? payload.accounts : [];
      const account = selectedAccount(list);
      if (!account) return response;

      const trades = await tradesFor(account);
      const x = ledger(account, trades);
      const normalized = list.map((a) =>
        String(a.account_code) === String(account.account_code)
          ? { ...a, balance_cents: x.balance, equity_cents: x.equity }
          : a,
      );

      return new Response(JSON.stringify({ ...payload, accounts: normalized }), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };

  function modelInfo(a) {
    const p = a.account_profile || {};
    const r = p.rules || {};
    return {
      profile: p,
      rules: r,
      type: p.accountType || "Trading Account",
      funding: p.fundingModel || "—",
      phase: p.phase || "—",
      model: p.model || a.challenge_model || "—",
      warrior: !!p.isWarrior,
    };
  }

  function progressBar(label, value, variant = "green", detail = "") {
    const safe = Math.max(0, Math.min(100, num(value)));
    return `<div class="ao-progress-block">
      <div class="ao-progress-head"><span>${esc(label)}</span><b>${pct(value)}</b></div>
      <div class="ao-progress-track"><i class="ao-progress-fill ${variant}" style="width:${safe}%"></i></div>
      ${detail ? `<small>${esc(detail)}</small>` : ""}
    </div>`;
  }

  function metric(label, value, sub = "", tone = "") {
    return `<div class="ao-metric ${tone}"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  }

  function buildOverview(a, trades) {
    const { profile, rules, type, funding, phase, model, warrior } = modelInfo(a);
    const x = ledger(a, trades);

    const profitTarget =
      rules.profitTargetCents != null ? num(rules.profitTargetCents) : null;
    const profitProgress =
      profitTarget > 0
        ? Math.max(0, Math.min(100, ((x.balance - x.initial) / profitTarget) * 100))
        : null;

    const dailyLimit =
      rules.dailyDrawdownCents != null ? num(rules.dailyDrawdownCents) : null;
    const dayStart = num(a.day_start_balance_cents || x.initial);
    const dailyUsed = Math.max(0, dayStart - x.balance);
    const dailyUsedPct =
      dailyLimit > 0 ? Math.min(100, (dailyUsed / dailyLimit) * 100) : null;

    /* Match the backend risk-engine basis: prototype uses equity HWM;
       warrior uses initial balance for maximum drawdown. */
    const maxLimit =
      rules.maxDrawdownCents != null ? num(rules.maxDrawdownCents) : null;
    const maxBase = warrior ? x.initial : num(a.equity_hwm_cents || x.initial);
    const maxUsed = Math.max(0, maxBase - x.equity);
    const maxUsedPct =
      maxLimit > 0 ? Math.min(100, (maxUsed / maxLimit) * 100) : null;

    const maxTrades =
      rules.maxTradesPerDay != null ? num(rules.maxTradesPerDay) : null;
    const tradesToday =
      rules.tradesToday != null
        ? num(rules.tradesToday)
        : trades.filter((t) => {
            const stamp = t.trading_day || t.entry_time || t.created_at || "";
            return String(stamp).slice(0, 10) === new Date().toISOString().slice(0, 10);
          }).length;

    const consistencyLimit =
      rules.consistencyLimitPercent != null
        ? num(rules.consistencyLimitPercent)
        : null;
    const consistency =
      rules.consistencyAchievedPercent != null
        ? num(rules.consistencyAchievedPercent)
        : null;

    const passed =
      profitProgress != null &&
      profitProgress >= 100 &&
      (dailyUsedPct == null || dailyUsedPct < 100) &&
      (maxUsedPct == null || maxUsedPct < 100);

    return `<section class="account-overview-card">
      <div class="ao-hero">
        <div class="ao-hero-copy">
          <div class="ao-kicker"><span class="ao-live-dot"></span>ACCOUNT OVERVIEW</div>
          <h3>${esc(a.account_code)}</h3>
          <p>${esc(type)} · ${esc(funding)} · ${esc(phase)}</p>
        </div>
        <div class="ao-status ${passed ? "positive" : "neutral"}"><span></span>${passed ? "Target Reached" : "In Progress"}</div>
      </div>

      <div class="ao-balance-grid">
        ${metric("Balance", money(x.balance), `Initial ${money(x.initial)}`)}
        ${metric("Equity", money(x.equity), x.floating >= 0 ? `+${money(x.floating)} floating` : `${money(x.floating)} floating`, x.floating >= 0 ? "positive" : "negative")}
        ${metric("Realized P/L", `${x.realized >= 0 ? "+" : ""}${money(x.realized)}`, "Closed trades", x.realized >= 0 ? "positive" : "negative")}
        ${metric("Open Positions", String(x.openCount), maxLimit != null ? `Max DD ${money(maxLimit)}` : "Live positions")}
      </div>

      <div class="ao-section-title"><div><span>PROGRESS REPORT</span><b>Challenge performance</b></div><strong>${profitProgress == null ? "—" : pct(profitProgress)}</strong></div>
      <div class="ao-progress-list">
        ${profitProgress != null ? progressBar("Profit target", profitProgress, "green", `${money(Math.max(0, x.balance - x.initial))} achieved of ${money(profitTarget)}`) : `<div class="ao-empty-rule">Profit target is not configured by the backend.</div>`}
        ${dailyUsedPct != null ? progressBar("Daily drawdown used", dailyUsedPct, dailyUsedPct >= 80 ? "danger" : "amber", `${money(dailyUsed)} used of ${money(dailyLimit)} limit`) : ""}
        ${maxUsedPct != null ? progressBar("Maximum drawdown used", maxUsedPct, maxUsedPct >= 80 ? "danger" : "amber", `${money(maxUsed)} used of ${money(maxLimit)} limit`) : ""}
        ${maxTrades != null ? progressBar("Daily trades used", maxTrades ? (tradesToday / maxTrades) * 100 : 0, tradesToday >= maxTrades ? "danger" : "green", `${tradesToday} of ${maxTrades} trades`) : ""}
        ${consistencyLimit != null && consistency != null ? progressBar("Consistency usage", consistencyLimit ? (consistency / consistencyLimit) * 100 : 0, consistency >= consistencyLimit ? "danger" : "green", `${pct(consistency)} achieved · ${pct(consistencyLimit)} limit`) : ""}
      </div>

      <div class="ao-rule-strip">
        <div><span>CHALLENGE</span><b>${esc(model)}</b></div>
        <div><span>DAILY LOSS</span><b>${dailyLimit == null ? "—" : money(dailyLimit)}</b></div>
        <div><span>MAX DRAWDOWN</span><b>${maxLimit == null ? "—" : money(maxLimit)}</b></div>
        <div><span>TRADES TODAY</span><b>${maxTrades == null ? tradesToday : `${tradesToday}/${maxTrades}`}</b></div>
      </div>
    </section>`;
  }

  async function getAccount() {
    const d = await rawJson("/api/accounts");
    const list = d.accounts || d;
    const a = selectedAccount(list);
    if (!a) throw Error("No trading account available");
    const trades = await tradesFor(a);
    const x = ledger(a, trades);
    return {
      ...a,
      balance_cents: x.balance,
      equity_cents: x.equity,
      __trades: trades,
    };
  }

  function createOverviewShell(accountCode) {
    const el = document.createElement("div");
    el.className = "account-popover account-popover-v2";
    el.innerHTML = `<div class="account-popover-head"><div><div class="ao-loading-kicker">ACCOUNT OVERVIEW</div><h3>${esc(accountCode || "Trading Account")}</h3></div><button class="account-popover-close" type="button" aria-label="Close">×</button></div><div class="ao-loading"><div class="ao-skeleton hero"></div><div class="ao-skeleton row"></div><div class="ao-skeleton row"></div><span>Loading live account data…</span></div>`;
    document.body.appendChild(el);
    el.querySelector(".account-popover-close").onclick = () => el.remove();
    return el;
  }

  function paintOverview(el, a, trades) {
    if (!el.isConnected) return;
    el.innerHTML = `<div class="account-popover-head"><div><div class="ao-loading-kicker">LIVE ACCOUNT</div><h3>Account Overview</h3><div class="account-id">${esc(a.account_code)}</div></div><button class="account-popover-close" type="button" aria-label="Close">×</button></div>${buildOverview(a, trades)}`;
    el.querySelector(".account-popover-close").onclick = () => el.remove();
  }

  async function renderAccountPopover() {
    document.querySelector(".account-popover")?.remove();

    /* Render the surface immediately. Network work happens after the panel is visible. */
    const wanted =
      new URLSearchParams(location.search).get("account_code") ||
      localStorage.getItem("fundfxt_selected_account") ||
      "";
    const shell = createOverviewShell(wanted);

    try {
      const a = await getAccount();
      localStorage.setItem("fundfxt_selected_account", a.account_code);
      paintOverview(shell, a, a.__trades || []);
    } catch (err) {
      if (shell.isConnected) {
        shell.querySelector(".ao-loading")?.remove();
        shell.insertAdjacentHTML(
          "beforeend",
          `<div class="ao-error"><strong>Account data unavailable</strong><span>${esc(err.message)}</span></div>`,
        );
      }
    }
  }

  async function refreshAccountPopover() {
    const p = document.querySelector(".account-popover-v2");
    if (!p || p.querySelector(".ao-loading")) return;
    try {
      const a = await getAccount();
      paintOverview(p, a, a.__trades || []);
    } catch {
      /* Keep the last good snapshot visible if a refresh fails. */
    }
  }

  function setActiveTradeTab(tab) {
    document.querySelectorAll(".right-tab").forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function install() {
    const btn = document.getElementById("accountMenuBtn");
    if (btn) {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (document.querySelector(".account-popover")) {
          document.querySelector(".account-popover")?.remove();
          return;
        }
        await renderAccountPopover();
      };
    }

    document.querySelectorAll(".right-tab").forEach((button) =>
      button.addEventListener(
        "click",
        () => setActiveTradeTab(button.dataset.tab),
        true,
      ),
    );
    setActiveTradeTab("OPEN");

    document.addEventListener("click", (e) => {
      const p = document.querySelector(".account-popover");
      if (p && !p.contains(e.target) && e.target !== btn) p.remove();
    });

    setInterval(refreshAccountPopover, 5000);
  }

  const wait = setInterval(() => {
    if (
      document.readyState !== "loading" &&
      document.getElementById("accountMenuBtn")
    ) {
      clearInterval(wait);
      install();
    }
  }, 50);
})();
