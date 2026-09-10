/* ===== FUNDFXT TRADING WORKSPACE =====
   Chart-first layout controls. This layer only manages panel presentation;
   trading, pricing, account and order execution remain in the existing terminal controller.
*/
(function () {
  "use strict";

  const STORAGE_KEY = "fundfxt_terminal_workspace";
  const workspace = document.querySelector(".workspace");
  const watch = document.getElementById("watch");
  const right = document.getElementById("right");
  if (!workspace || !watch || !right) return;

  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  })();

  const state = {
    left: saved.left || "expanded",
    right: saved.right || "expanded",
  };

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function addRail(panel, side) {
    const rail = document.createElement("button");
    rail.type = "button";
    rail.className = `workspace-rail ${side}-rail`;
    rail.dataset.workspaceRail = side;
    rail.setAttribute("aria-label", side === "left" ? "Open pairs panel" : "Open trades panel");
    rail.innerHTML = side === "left"
      ? '<span>★</span><b>PAIRS</b>'
      : '<span>▣</span><b>TRADES</b>';
    workspace.appendChild(rail);
    rail.addEventListener("click", () => setPanel(side, "compact"));
    return rail;
  }

  const leftRail = addRail(watch, "left");
  const rightRail = addRail(right, "right");

  function setPanel(side, mode) {
    state[side] = mode;
    workspace.classList.toggle(`${side}-compact`, mode === "compact");
    workspace.classList.toggle(`${side}-hidden`, mode === "hidden");
    const panel = side === "left" ? watch : right;
    const button = panel.querySelector(`[data-workspace-toggle="${side}"]`);
    if (button) {
      const next = mode === "expanded" ? "compact" : mode === "compact" ? "hidden" : "expanded";
      button.textContent = mode === "expanded" ? "−" : mode === "compact" ? "‹" : "›";
      button.title = mode === "expanded"
        ? `Minimize ${side} panel`
        : mode === "compact"
          ? `Hide ${side} panel`
          : `Show ${side} panel`;
      button.setAttribute("aria-label", button.title);
      button.dataset.nextMode = next;
    }
    panel.classList.toggle("workspace-panel-hidden", mode === "hidden");
    leftRail.classList.toggle("visible", side === "left" && mode === "hidden");
    rightRail.classList.toggle("visible", side === "right" && mode === "hidden");
    save();
  }

  function cycle(side) {
    const current = state[side];
    setPanel(side, current === "expanded" ? "compact" : current === "compact" ? "hidden" : "expanded");
  }

  [
    [watch, "left"],
    [right, "right"],
  ].forEach(([panel, side]) => {
    const title = panel.querySelector(".panel-title");
    if (!title) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-slider-btn";
    button.dataset.workspaceToggle = side;
    button.textContent = "−";
    button.setAttribute("aria-label", `Minimize ${side} panel`);
    title.appendChild(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycle(side);
    });
  });

  function focusChart() {
    workspace.classList.add("chart-focus-mode");
    state.left = "hidden";
    state.right = "hidden";
    setPanel("left", "hidden");
    setPanel("right", "hidden");
  }

  function restorePanels() {
    workspace.classList.remove("chart-focus-mode");
    setPanel("left", "expanded");
    setPanel("right", "expanded");
  }

  const chartHead = document.querySelector(".chart-head");
  if (chartHead && !document.getElementById("chartFocusBtn")) {
    const focus = document.createElement("button");
    focus.id = "chartFocusBtn";
    focus.type = "button";
    focus.className = "chart-focus-btn";
    focus.innerHTML = '<span>Focus</span><b>⛶</b>';
    focus.title = "Focus chart — hide side panels";
    focus.addEventListener("click", () => {
      if (workspace.classList.contains("chart-focus-mode")) restorePanels();
      else focusChart();
    });
    chartHead.insertBefore(focus, document.getElementById("chartMaxBtn"));
  }

  document.addEventListener("keydown", (event) => {
    if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
    if (event.key === "[") cycle("left");
    if (event.key === "]") cycle("right");
    if (event.key.toLowerCase() === "f") {
      if (workspace.classList.contains("chart-focus-mode")) restorePanels();
      else focusChart();
    }
  });

  // Keep the existing mobile navigation authoritative. Side-panel sliders are desktop UX.
  function applyInitial() {
    setPanel("left", state.left);
    setPanel("right", state.right);
  }

  applyInitial();
})();
