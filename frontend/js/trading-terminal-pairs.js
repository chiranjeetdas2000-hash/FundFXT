/* ===== FUNDFXT PAIRS / MARKET WATCH — CLEAN REWRITE ===== */
(function(){
  'use strict';

  const finite=v=>Number.isFinite(Number(v));
  const formatPrice=(v,s)=>finite(v)?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';
  const formatSpread=(v,s)=>finite(v)?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';

  function getQuote(symbol){
    const p=(typeof T!=='undefined'&&T.prices&&T.prices[symbol])||{};
    const bid=finite(p.bid)?Number(p.bid):NaN;
    const ask=finite(p.ask)?Number(p.ask):NaN;
    const spread=finite(p.spread)?Number(p.spread):(finite(ask)&&finite(bid)?Math.abs(ask-bid):NaN);
    const change=finite(p.changePercent)?Number(p.changePercent):NaN;
    return {bid,ask,spread,change};
  }

  window.renderPairs=function renderPairsClean(){
    if(typeof T==='undefined')return;
    const box=document.getElementById('watchlist');
    if(!box)return;
    const search=document.getElementById('search');
    const q=(search?.value||'').trim().toUpperCase();
    const symbols=(T.favorites||[]).filter(s=>String(s).toUpperCase().includes(q));

    box.innerHTML=symbols.map(symbol=>{
      const p=getQuote(symbol);
      const change=finite(p.change)?`${p.change>=0?'+':''}${p.change.toFixed(2)}%`:'—';
      return `<button class="quote ${symbol===T.selected?'selected':''}" data-symbol="${symbol}" type="button" aria-label="${symbol} market quote">
        <span class="quote-pair">${symbol}</span>
        <span class="quote-value quote-spread-value">${formatSpread(p.spread,symbol)}</span>
        <span class="quote-value quote-ask-value">${formatPrice(p.ask,symbol)}</span>
        <span class="quote-value quote-bid-value">${formatPrice(p.bid,symbol)}</span>
        <span class="quote-change">${change}</span>
      </button>`;
    }).join('')||'<div class="favorite-empty">No favorite pairs match your search.</div>';

    box.querySelectorAll('.quote').forEach(btn=>{
      btn.onclick=()=>{
        T.selected=btn.dataset.symbol;
        const selected=document.getElementById('selectedSymbol');
        if(selected)selected.textContent=T.selected;
        renderPairsClean();
        if(typeof openPanel==='function')openPanel('center');
        if(typeof loadChart==='function')loadChart();
      };
    });

    const live=Object.values(T.prices||{}).some(p=>finite(p?.bid)&&finite(p?.ask));
    const market=document.getElementById('market');
    if(market){
      market.textContent=live?'● LIVE':'● OFFLINE';
      market.style.color=live?'var(--green)':'var(--red)';
    }
  };

  window.addPair=function addPairClean(){
    if(typeof T==='undefined')return;
    const body=`
      <div class="pair-add-toolbar">
        <input id="favoritePairSearch" class="search" placeholder="Search pairs…" autocomplete="off">
      </div>
      <div id="favoritePairList" class="pair-add-list"></div>`;
    if(typeof modal!=='function')return;
    modal('Favorite Pairs',body,'');

    const list=document.getElementById('favoritePairList');
    const search=document.getElementById('favoritePairSearch');
    const draw=()=>{
      const q=(search?.value||'').trim().toUpperCase();
      const symbols=(typeof SYMBOLS!=='undefined'?SYMBOLS:[]).filter(s=>s.includes(q));
      list.innerHTML=symbols.map(s=>{
        const fav=T.favorites.includes(s);
        return `<div class="pair-add-item"><div><b>${s}</b><small>${fav?'Favorite':'Available'}</small></div><button data-fav="${s}" type="button">${fav?'Remove':'Add'}</button></div>`;
      }).join('')||'<div class="favorite-empty">No pairs found.</div>';
      list.querySelectorAll('[data-fav]').forEach(btn=>btn.onclick=()=>{
        const s=btn.dataset.fav;
        if(T.favorites.includes(s)){
          if(T.favorites.length===1){if(typeof feedback==='function')feedback('Keep at least one favorite pair.');return;}
          T.favorites=T.favorites.filter(x=>x!==s);
        }else{
          T.favorites.push(s);
        }
        localStorage.setItem('fundfxt_favorite_pairs',JSON.stringify(T.favorites));
        renderPairsClean();
        draw();
      });
    };
    draw();
    search?.addEventListener('input',draw);
  };

  function install(){
    const search=document.getElementById('search');
    if(search)search.oninput=renderPairsClean;
    const add=document.getElementById('addPairBtn');
    if(add)add.onclick=addPairClean;
    renderPairsClean();
  }

  const wait=setInterval(()=>{
    if(document.readyState!=='loading'&&typeof T!=='undefined'&&document.getElementById('watchlist')){
      clearInterval(wait);
      install();
    }
  },50);
})();
