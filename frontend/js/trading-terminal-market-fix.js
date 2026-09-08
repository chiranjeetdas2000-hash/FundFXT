/* ===== FUNDfxT MARKET WATCH FINAL FIX =====
   - Treat MID-only quotes as live so the terminal does not falsely show OFFLINE.
   - Desktop/mobile both show Pair + BID + daily change.
   - Spread/Ask/MID labels are intentionally removed from the pair rows.
*/
(function(){
  'use strict';

  function num(v){return Number.isFinite(Number(v));}
  function price(v,s){
    if(!num(v)) return '—';
    return Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5);
  }

  function renderMarketRows(){
    if(typeof T==='undefined') return;
    const box=document.getElementById('watchlist');
    if(!box) return;
    const q=(document.getElementById('search')?.value||'').toUpperCase().trim();
    const rows=(T.favorites||[]).filter(s=>s.includes(q));

    box.innerHTML=rows.map(s=>{
      const p=T.prices?.[s]||{};
      const bid=Number(p.bid);
      const mid=Number(p.mid);
      const ch=Number(p.changePercent);
      const shownBid=num(bid)?bid:mid;
      return `<button class="quote ${s===T.selected?'selected':''}" data-symbol="${s}" type="button">
        <span class="quote-main">
          <b class="watch-symbol">${s}</b>
          <span class="quote-change">Δ ${num(ch)?(ch>=0?'+':'')+ch.toFixed(2)+'%':'—'}</span>
        </span>
        <span class="quote-bid"><small>BID</small><b>${price(shownBid,s)}</b></span>
      </button>`;
    }).join('')||'<div class="favorite-empty">No favorite pairs match your search.</div>';

    box.querySelectorAll('.quote').forEach(b=>b.onclick=()=>{
      T.selected=b.dataset.symbol;
      renderMarketRows();
      if(typeof openPanel==='function') openPanel('center');
      if(typeof loadChart==='function') loadChart();
    });

    // A valid MID quote is still live market data; do not require both bid+ask.
    const live=Object.values(T.prices||{}).some(p=>num(p?.bid)||num(p?.mid)||num(p?.ask));
    const market=document.getElementById('market');
    if(market){
      market.textContent=live?'● LIVE':'● OFFLINE';
      market.style.color=live?'var(--green)':'var(--red)';
    }
  }

  function install(){
    if(typeof window.renderPairs!=='undefined') window.renderPairs=renderMarketRows;
    renderMarketRows();
    const search=document.getElementById('search');
    if(search){search.removeEventListener('input',renderMarketRows);search.addEventListener('input',renderMarketRows);}
    // Existing controller calls renderPairs after every price refresh. Keep our renderer authoritative.
    const originalRender=window.renderPairs;
    if(originalRender && originalRender!==renderMarketRows){
      window.renderPairs=renderMarketRows;
    }
  }

  const wait=setInterval(()=>{
    if(document.readyState!=='loading' && typeof T!=='undefined' && document.getElementById('watchlist')){
      clearInterval(wait);
      install();
    }
  },50);
})();