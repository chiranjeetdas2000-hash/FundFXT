/* ===== FUNDFXT TRADING WORKSPACE =====
   Desktop: full-width chart + one right control rail.
   Right rail contains Pairs, Orders and Trades sections.
   Mobile/tablet portrait uses the existing full-screen mobile navigation.
*/
(function () {
  "use strict";

  const STORAGE_KEY = "fundfxt_terminal_workspace_v2";
  const workspace = document.querySelector(".workspace");
  const right = document.getElementById("right");
  if (!workspace || !right) return;

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  })();

  const state = { right: saved.right === "hidden" ? "hidden" : "expanded" };

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function setRight(mode) {
    state.right = mode;
    workspace.classList.toggle("right-hidden", mode === "hidden");
    const button = document.getElementById("rightCollapseBtn");
    if (button) {
      button.textContent = mode === "hidden" ? "‹" : "›";
      button.setAttribute("aria-label", mode === "hidden" ? "Show terminal controls" : "Hide terminal controls");
      button.title = mode === "hidden" ? "Show terminal controls" : "Hide terminal controls";
    }
    const rail = workspace.querySelector('[data-workspace-rail="right"]');
    rail?.classList.toggle("visible", mode === "hidden");
    save();
  }

  function showSection(name) {
    document.querySelectorAll(".right-section-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.section === name);
    });
    document.querySelectorAll(".terminal-section").forEach((section) => {
      section.classList.toggle("active", section.id === "terminal" + name.charAt(0).toUpperCase() + name.slice(1));
    });

    if (name === "trades") {
      if (typeof window.loadTrades === "function") window.loadTrades();
    }
    if (name === "orders") {
      const refresh = document.getElementById("ordersRefresh");
      refresh?.click();
    }
  }

  document.querySelectorAll(".right-section-tab").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });

  document.getElementById("rightCollapseBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setRight(state.right === "hidden" ? "expanded" : "hidden");
  });

  document.querySelector('[data-workspace-rail="right"]')?.addEventListener("click", () => setRight("expanded"));

  document.getElementById("ordersRefresh")?.addEventListener("click", () => {
    const box = document.getElementById("pendingOrderScroll");
    if (!box) return;
    // trading-terminal-pending.js owns the actual endpoint and card renderer.
    // Its refresh hook is exposed below when that script is loaded.
    if (typeof window.showPendingOrders === "function") window.showPendingOrders();
  });

  /* Keep account data in the chart header, not beside the FundFXT brand. */
  const syncChartAccount = () => {
    const account = (() => { try { return typeof T !== "undefined" ? T.account : null; } catch { return null; } })();
    const money = (c) => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (account) {
      const balance = document.getElementById("chartBalance");
      const equity = document.getElementById("chartEquity");
      if (balance) balance.textContent = "Balance " + money(account.balance_cents);
      if (equity) equity.textContent = "Equity " + money(account.equity_cents);
    }
    const symbol = (() => { try { return typeof T !== "undefined" ? T.selected : "EURUSD"; } catch { return "EURUSD"; } })();
    const selected = document.getElementById("selectedSymbol");
    const execution = document.getElementById("executionSymbol");
    if (selected) selected.textContent = symbol;
    if (execution) execution.textContent = symbol;
  };
  setInterval(syncChartAccount, 500);
  syncChartAccount();

  /* Original controller still calls openPanel('right'/'center'). On mobile,
     map those calls to the new section-based rail without changing trade logic. */
  const originalOpenPanel = window.openPanel;
  if (typeof originalOpenPanel === "function") {
    window.openPanel = function (name) {
      if (name === "center") {
        originalOpenPanel.call(this, name);
        return;
      }
      if (name === "right") {
        originalOpenPanel.call(this, name);
        showSection("trades");
        return;
      }
      if (name === "pairs") {
        originalOpenPanel.call(this, "right");
        showSection("pairs");
        return;
      }
      if (name === "trades") {
        originalOpenPanel.call(this, "right");
        showSection("trades");
        return;
      }
      originalOpenPanel.call(this, name);
    };
  }

  /* Mobile/tablet portrait navigation: Pairs / Chart / Trades. */
  document.querySelectorAll(".mobile-nav button").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "pairs") showSection("pairs");
      if (view === "trades") showSection("trades");
    });
  });

  setRight(state.right);
  showSection("pairs");
})();
