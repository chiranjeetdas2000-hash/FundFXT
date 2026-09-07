'use strict';

// FundFXT terminal UI fixes: Market Watch shows Pair, MID, Spread and Change only.
(function () {
  const originalRenderQuotes = window.renderQuotes;

  if (typeof originalRenderQuotes !== 'function') return;

  window.renderQuotes = function () {
    originalRenderQuotes();
    const box = document.getElementById('watchlist');
    if (!box) return;

    box.querySelectorAll('.quote').forEach(button => {
      const symbol = button.dataset.symbol || button.querySelector('.quote-main b')?.textContent || '';
      const priceBox = button.querySelector('.quote-prices');
      const mid = priceBox?.querySelector('.last')?.textContent || '—';
      const rawStats = priceBox?.querySelector('small')?.textContent || '';
      const changeMatch = rawStats.match(/Δ\s*([+-]?\d+(?:\.\d+)?%)/i);
      const spreadMatch = rawStats.match(/(?:SPR|S)\s*([0-9.]+)/i);
      const change = changeMatch ? changeMatch[1] : '—';
      const spread = spreadMatch ? spreadMatch[1] : '—';

      button.innerHTML = `
        <span class="quote-main">
          <b>${symbol}</b>
          <span class="quote-detail">S ${spread}</span>
          <span class="quote-detail">Δ ${change}</span>
        </span>
        <span class="quote-mid">
          <small>MID</small>
          <b>${mid}</b>
        </span>`;
      button.removeAttribute('title');
    });

    // Connection state belongs to the Market Watch header, not every pair row.
    const market = document.getElementById('market');
    if (market) {
      const hasLive = [...box.querySelectorAll('.quote')].some(button => {
        const mid = button.querySelector('.quote-mid b')?.textContent || '';
        return mid !== '—';
      });
      market.textContent = hasLive ? '● LIVE' : '● OFFLINE';
      market.classList.toggle('live', hasLive);
      market.classList.toggle('offline', !hasLive);
      market.style.color = hasLive ? '#00b56a' : '#ff4444';
    }

    // Remove the old per-list connection indicator below the pairs.
    const status = document.querySelector('#watch .status');
    if (status) status.remove();
  };
})();
