/* ===== FUNDfxT MARKET WATCH LAYOUT FIX ===== */
(function(){
'use strict';
const fmtPrice=(v,s)=>Number.isFinite(Number(v))?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';
const num=v=>Number.isFinite(Number(v));
function renderMarketWatch(){
  const box=document.getElementById('watchlist');
  if(!box||typeof T==='undefined')return;
  let header=box.previousElementSibling;
  if(!header||!header.classList.contains('watch-header')){
    header=document.createElement('div');
    header.className='watch-header';
    header.innerHTML='<span>Pairs</span><span>Spread</span><span>Ask</span><span>Bid</span>';
    box.parentNode.insertBefore(header,box);
  }
  const q=(document.getElementById('search')?.value||'').toUpperCase().trim();
  const rows=(T.favorites||[]).filter(s=>s.includes(q));
  box.innerHTML=rows.map(s=>{
    const p=T.prices[s]||{};
    const ask=Number(p.ask),bid=Number(p.bid),spread=num(p.spread)?Number(p.spread):(ask-bid),ch=Number(p.changePercent);
    return `<button class="quote" data-symbol="${s}" type="button"><span class="quote-main"><b class="watch-symbol">${s}</b><span class="quote-change">${num(ch)?(ch>=0?'+':'')+ch.toFixed(2)+'%':'—'}</span></span><span class="quote-spread"><b>${fmtPrice(spread,s)}</b></span><span class="quote-price quote-ask"><b>${fmtPrice(ask,s)}</b></span><span class="quote-price quote-bid"><b>${fmtPrice(bid,s)}</b></span></button>`;
  }).join('')||'<div class="favorite-empty">No favorite pairs match your search.</div>';
  box.querySelectorAll('.quote').forEach(b=>b.onclick=()=>{T.selected=b.dataset.symbol;renderMarketWatch();if(typeof openPanel==='function')openPanel('center');if(typeof loadChart==='function')loadChart();const s=document.getElementById('selectedSymbol');if(s)s.textContent=T.selected;});
  const live=Object.values(T.prices||{}).some(p=>num(p.bid)&&num(p.ask));
  const m=document.getElementById('market');if(m){m.textContent=live?'● LIVE':'● OFFLINE';m.style.color=live?'var(--green)':'var(--red)'}
}
const originalRender=window.renderPairs;
window.renderPairs=renderMarketWatch;
const wait=setInterval(()=>{
  if(document.readyState!=='loading'&&typeof T!=='undefined'&&document.getElementById('watchlist')){
    clearInterval(wait);renderMarketWatch();
  }
},50);
})();