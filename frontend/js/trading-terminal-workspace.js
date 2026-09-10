/* ===== FUNDFXT TRADING WORKSPACE =====
   Desktop: full-width chart + one right control rail.
   Right rail contains Pairs, Orders and Trades sections.
   Mobile/tablet uses the full-screen terminal navigation.
*/
(function () {
  "use strict";

  const STORAGE_KEY = "fundfxt_terminal_workspace_v2";
  const workspace = document.querySelector(".workspace");
  const right = document.getElementById("right");
  const center = document.getElementById("center");
  if (!workspace || !right || !center) return;

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  })();
  const state = { right: saved.right === "hidden" ? "hidden" : "expanded" };

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  function setRight(mode) {
    state.right = mode;
    workspace.classList.toggle("right-hidden", mode === "hidden");
    const button = document.getElementById("rightCollapseBtn");
    if (button) {
      button.textContent = mode === "hidden" ? "‹" : "›";
      button.setAttribute("aria-label", mode === "hidden" ? "Show terminal controls" : "Hide terminal controls");
      button.title = mode === "hidden" ? "Show terminal controls" : "Hide terminal controls";
    }
    workspace.querySelector('[data-workspace-rail="right"]')?.classList.toggle("visible", mode === "hidden");
    save();
  }

  function showSection(name) {
    document.querySelectorAll(".right-section-tab").forEach((button) => button.classList.toggle("active", button.dataset.section === name));
    document.querySelectorAll(".terminal-section").forEach((section) => {
      section.classList.toggle("active", section.id === "terminal" + name.charAt(0).toUpperCase() + name.slice(1));
    });
    if (name === "trades" && typeof window.loadTrades === "function") window.loadTrades();
    if (name === "orders" && typeof window.showPendingOrders === "function") window.showPendingOrders();
  }

  document.querySelectorAll(".right-section-tab").forEach((button) => button.addEventListener("click", () => showSection(button.dataset.section)));
  document.getElementById("rightCollapseBtn")?.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation(); setRight(state.right === "hidden" ? "expanded" : "hidden");
  });
  workspace.querySelector('[data-workspace-rail="right"]')?.addEventListener("click", () => setRight("expanded"));
  document.getElementById("ordersRefresh")?.addEventListener("click", () => {
    if (typeof window.showPendingOrders === "function") window.showPendingOrders();
  });

  const syncChartAccount = () => {
    const account = (() => { try { return typeof T !== "undefined" ? T.account : null; } catch { return null; } })();
    const symbol = (() => { try { return typeof T !== "undefined" ? T.selected : "EURUSD"; } catch { return "EURUSD"; } })();
    const money = (c) => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (account) {
      document.getElementById("chartBalance")?.replaceChildren(document.createTextNode("Balance " + money(account.balance_cents)));
      document.getElementById("chartEquity")?.replaceChildren(document.createTextNode("Equity " + money(account.equity_cents)));
    }
    const selected = document.getElementById("selectedSymbol");
    const execution = document.getElementById("executionSymbol");
    if (selected) selected.textContent = symbol;
    if (execution) execution.textContent = symbol;
  };
  setInterval(syncChartAccount, 500);
  syncChartAccount();

  /* Mobile/tablet nav must run before the old controller's generic panel handler. */
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".mobile-nav button");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const view = button.dataset.view;
    document.querySelectorAll(".mobile-nav button").forEach((b) => b.classList.toggle("active", b === button));
    if (view === "center") {
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("mobile-active"));
      center.classList.add("mobile-active");
      if (typeof window.loadChart === "function") window.loadChart();
      return;
    }
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("mobile-active"));
    right.classList.add("mobile-active");
    showSection(view === "pairs" ? "pairs" : "trades");
  }, true);

  setRight(state.right);
  showSection("pairs");
})();
