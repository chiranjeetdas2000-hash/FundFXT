(() => {
  let active = 0;
  const setBusy = (busy) => document.querySelectorAll('.refresh-action').forEach((button) => button.classList.toggle('refreshing', busy));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    active += 1;
    setBusy(true);
    try { return await originalFetch(...args); }
    finally { active = Math.max(0, active - 1); if (!active) setBusy(false); }
  };
})();
