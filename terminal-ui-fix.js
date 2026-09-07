'use strict';

// FundFXT terminal UI fixes: market-watch quotes and order-ticket quote layout.
(function () {
  const originalRenderQuotes = window.renderQuotes;
  const originalRenderButtons = window.renderButtons;

  if (typeof originalRenderQuotes === 'function') {
    window.renderQuotes = function () {
      originalRenderQuotes();
      const box = document.getElementById('watchlist');
      if (!box) return;

      box.querySelectorAll('.quote').forEach(button => {
        const symbol = button.dataset.symbol || '';
        const bid = button.querySelector('.bid')?.textContent || '—';
        const ask = button.querySelector('.ask')?.textContent || '—';
        const status = button.querySelector('.quote-main small, .qsub')?.textContent || '○ MARKET CLOSED';
        const stats = button.querySelector('.quote-prices small, .qchange')?.textContent || '';
        const changeMatch = stats.match(/Δ\s*([+-]?\d+(?:\.\d+)?%)/i);
        const spreadMatch = stats.match(/(?:SPR|S)\s*([0-9.]+)/i);

        button.innerHTML = `
          <span class="quote-main">
            <b>${symbol}</b>
            <small>${status}</small>
          </span>
          <span class="quote-side">
            <span class="quote-price quote-bid"><small>BID</small><b>${bid}</b></span>
            <span class="quote-price quote-ask"><small>ASK</small><b>${ask}</b></span>
            <span class="quote-stats">
              <small>Δ ${changeMatch ? changeMatch[1] : '—'}</small>
              <small>S ${spreadMatch ? spreadMatch[1] : '—'}</small>
            </span>
          </span>`;
      });
    };
  }

  if (typeof originalRenderButtons === 'function') {
    window.renderButtons = function () {
      originalRenderButtons();
      const box = document.getElementById('quoteBox');
      if (!box) return;
      const spans = [...box.querySelectorAll('span')];
      const bid = spans.find(x => /\bBID\b/i.test(x.textContent))?.querySelector('b')?.textContent || '—';
      const ask = spans.find(x => /\bASK\b/i.test(x.textContent))?.querySelector('b')?.textContent || '—';
      const spread = spans.find(x => /\bSPR\b|\bS\b/i.test(x.textContent))?.querySelector('b')?.textContent || '—';
      const mid = (Number(bid) + Number(ask)) / 2;
      const midText = Number.isFinite(mid) ? mid.toFixed(/JPY$/i.test(document.getElementById('selectedSymbol')?.textContent || '') ? 3 : 5) : '—';

      box.innerHTML = `
        <span class="quote-order-bid"><small>BID</small><b>${bid}</b></span>
        <span class="quote-order-ask"><small>ASK</small><b>${ask}</b></span>
        <span class="quote-order-spread"><small>S</small><b>${spread}</b></span>
        <span class="quote-order-mid"><small>MID</small><b>${midText}</b></span>`;
    };
  }
})();
