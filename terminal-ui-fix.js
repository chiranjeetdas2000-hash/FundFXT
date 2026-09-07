'use strict';

// FundFXT terminal UI fixes: compact market-watch quotes and order-ticket quote layout.
(function () {
  const $ = id => document.getElementById(id);
  const getPrice = (v, s) => {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return Number(v).toFixed(/JPY$/i.test(s) ? 3 : /XAU|XAG|BTC|ETH/i.test(s) ? 2 : 5);
  };

  window.renderQuotes = function () {
    const box = $('watchlist');
    if (!box) return;

    const term = ($('search')?.value || '').trim().toLowerCase();
    const symbols = (window.S?.symbols || []).filter(s => String(s).toLowerCase().includes(term));
    const prices = window.S?.prices || {};
    const selected = window.S?.selected;

    box.innerHTML = symbols.map(s => {
      const p = prices[s] || {};
      const bid = Number(p.bid);
      const ask = Number(p.ask);
      const live = Number.isFinite(bid) && Number.isFinite(ask);
      const spread = live ? Math.abs(ask - bid) : NaN;
      const change = Number(p.changePercent);
      const state = String(p.marketState || 'open').toLowerCase();
      const stale = Boolean(p.stale);
      const isLive = live && !stale && state !== 'closed';
      const changeText = Number.isFinite(change)
        ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
        : '—';

      return `<button class="quote ${s === selected ? 'selected' : ''}" data-symbol="${s}">
        <span class="quote-main">
          <b>${s}</b>
          <small>${isLive ? '● LIVE' : '○ MARKET CLOSED'}</small>
        </span>
        <span class="quote-side">
          <span class="quote-price quote-bid"><small>BID</small><b>${getPrice(bid, s)}</b></span>
          <span class="quote-price quote-ask"><small>ASK</small><b>${getPrice(ask, s)}</b></span>
          <span class="quote-stats"><small>Δ ${changeText}</small><small>S ${getPrice(spread, s)}</small></span>
        </span>
      </button>`;
    }).join('') || '<div class="empty"><strong>No symbols found</strong><span>Try another pair name.</span></div>';

    box.querySelectorAll('.quote').forEach(button => {
      button.onclick = () => {
        window.S.selected = button.dataset.symbol;
        renderQuotes();
        window.renderSelectedPrice?.();
        window.renderButtons?.();
        window.showPanel?.('center');
      };
    });
  };

  window.renderButtons = function () {
    const s = window.S?.selected || 'EURUSD';
    const p = window.S?.prices?.[s] || {};
    const bid = Number(p.bid);
    const ask = Number(p.ask);
    const spread = Number.isFinite(ask) && Number.isFinite(bid) ? Math.abs(ask - bid) : NaN;

    $('buy').textContent = `BUY  ${getPrice(ask, s)}`;
    $('sell').textContent = `SELL  ${getPrice(bid, s)}`;
    $('buy').disabled = !Number.isFinite(ask);
    $('sell').disabled = !Number.isFinite(bid);

    $('quoteBox').innerHTML = `
      <span class="quote-order-bid"><small>BID</small><b>${getPrice(bid, s)}</b></span>
      <span class="quote-order-ask"><small>ASK</small><b>${getPrice(ask, s)}</b></span>
      <span class="quote-order-spread"><small>S</small><b>${getPrice(spread, s)}</b></span>
      <span class="quote-order-mid"><small>MID</small><b>${getPrice((bid + ask) / 2, s)}</b></span>`;
  };
})();
