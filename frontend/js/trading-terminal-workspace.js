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

  function getRail(side) {
    return workspace.querySelector(`[data-workspace-rail="${side}"]`);
  }

  function setPanel(side, mode) {
    state[side] = mode;
    workspace.classList.toggle(`${side}-compact`, mode === "compact");
    workspace.classList.toggle(`${side}-hidden`, mode === "hidden");

    const panel = side === "left" ? watch : right;
    const button = panel.querySelector(`[data-workspace-toggle="${side}"]`);
    if (button) {
      button.textContent = mode === "expanded" ? "−" : mode === "compact" ? "‹" : "›";
      button.title = mode === "expanded"
        ? `Minimize ${side} panel`
        : mode === "compact"
          ? `Hide ${side} panel`
          : `Show ${side} panel`;
      button.setAttribute("aria-label", button.title);
    }

    panel.classList.toggle("workspace-panel-hidden", mode === "hidden");
    getRail("left")?.classList.toggle("visible", state.left === "hidden");
    getRail("right")?.classList.toggle("visible", state.right === "hidden");
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
    if (!title || title.querySelector(`[data-workspace-toggle="${side}"]`)) return;

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
    setPanel("left", "hidden");
    setPanel("right", "hidden");
  }

  function restorePanels() {
    workspace.classList.remove("chart-focus-mode");
    setPanel("left", "expanded");
    setPanel("right", "expanded");
  }

  const chartHead = document.querySelector(".chart-head");
  if (chartHead) {
    const focus = document.getElementById("chartFocusBtn");
    focus?.addEventListener("click", () => {
      if (workspace.classList.contains("chart-focus-mode")) restorePanels();
      else focusChart();
    }, { once: false });
  }

  // Keyboard shortcuts: [ = pairs, ] = trades, F = chart focus.
  document.addEventListener("keydown", (event) => {
    if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
    if (event.key === "[") cycle("left");
    if (event.key === "]") cycle("right");
    if (event.key.toLowerCase() === "f") {
      if (workspace.classList.contains("chart-focus-mode")) restorePanels();
      else focusChart();
    }
  });

  // Keep the existing mobile navigation authoritative. These controls are desktop UX.
  setPanel("left", state.left);
  setPanel("right", state.right);
})();
