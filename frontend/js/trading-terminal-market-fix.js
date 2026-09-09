/* ===== FUNDfxT MARKET WATCH — LIVE BID / ASK / SPREAD ===== */
(function(){
  'use strict';
  const finite=v=>Number.isFinite(Number(v));
  const fmt=(v,s)=>finite(v)?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';
  // Show the actual spread value received from the market feed, using the same
  // instrument precision as bid/ask. Never truncate it to arbitrary digits.
  const spreadFmt=(v,s)=>fmt(v,s);
  function patchSelected(){
    if(typeof T==='undefined')return;
    const symbol=document.getElementById('selectedSymbol');if(!symbol)return;
    const p=T.prices?.[T.selected]||{};
    const spread=finite(p.spread)?Number(p.spread):(finite(p.ask)&&finite(p.bid)?Math.abs(Number(p.ask)-Number(p.bid)):NaN);
    let badge=document.getElementById('selectedSpread');
    if(!badge){badge=document.createElement('span');badge.id='selectedSpread';badge.className='selected-spread';symbol.insertAdjacentElement('afterend',badge)}
    badge.innerHTML='<span>SPREAD</span><b>'+spreadFmt(spread,T.selected)+'</b>';
  }
  function patchRows(){
    if(typeof T==='undefined')return;
    const box=document.getElementById('watchlist');if(!box)return;
    box.querySelectorAll('.market-quote-header').forEach(h=>h.remove());
    box.querySelectorAll('.quote').forEach(row=>{
      const symbol=row.dataset.symbol||row.querySelector('.watch-symbol')?.textContent?.trim()||'';
      const p=T.prices?.[symbol]||{};
      const bid=finite(p.bid)?Number(p.bid):Number(p.mid);
      const ask=finite(p.ask)?Number(p.ask):Number(p.mid);
      const rawSpread=finite(p.spread)?Number(p.spread):(finite(bid)&&finite(ask)?Math.abs(ask-bid):NaN);
      const change=Number(p.changePercent);
      const main=row.querySelector('.quote-main');
      if(main){
        main.style.setProperty('grid-column','1');
        let ch=main.querySelector('.quote-change');
        if(!ch){ch=document.createElement('span');ch.className='quote-change';main.appendChild(ch)}
        ch.classList.toggle('positive',change>=0&&finite(change));ch.classList.toggle('negative',change<0&&finite(change));
        ch.textContent=finite(change)?((change>=0?'+':'')+change.toFixed(2)+'%'):'—';
      }
      row.querySelector('.quote-mid')?.remove();
      let spreadEl=row.querySelector('.quote-spread');
      if(!spreadEl){spreadEl=document.createElement('span');spreadEl.className='quote-cell quote-spread';row.appendChild(spreadEl)}
      spreadEl.className='quote-cell spread quote-spread';spreadEl.style.setProperty('grid-column','2');spreadEl.innerHTML='<b>'+spreadFmt(rawSpread,symbol)+'</b>';
      let askEl=row.querySelector('.quote-ask');
      if(!askEl){askEl=document.createElement('span');askEl.className='quote-cell quote-ask';row.appendChild(askEl)}
      askEl.className='quote-cell quote-ask';askEl.style.setProperty('grid-column','3');askEl.innerHTML='<b>'+fmt(ask,symbol)+'</b>';
      let bidEl=row.querySelector('.quote-bid');
      if(!bidEl){bidEl=document.createElement('span');bidEl.className='quote-cell quote-bid';row.appendChild(bidEl)}
      bidEl.className='quote-cell quote-bid';bidEl.style.setProperty('grid-column','4');bidEl.innerHTML='<b>'+fmt(bid,symbol)+'</b>';
    });
    patchSelected();
    const live=Object.values(T.prices||{}).some(p=>finite(p?.bid)||finite(p?.ask)||finite(p?.mid));
    const market=document.getElementById('market');if(market){market.textContent=live?'● LIVE':'● OFFLINE';market.style.color=live?'var(--green)':'var(--red)'}
  }
  function install(){
    const box=document.getElementById('watchlist');if(!box)return;
    const observer=new MutationObserver(()=>{if(observer.busy)return;observer.busy=true;requestAnimationFrame(()=>{patchRows();observer.busy=false})});
    observer.observe(box,{childList:true,subtree:true});patchRows();
    const search=document.getElementById('search');if(search)search.addEventListener('input',()=>setTimeout(patchRows,0));
    setInterval(patchRows,500);
  }
  const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('watchlist')&&typeof T!=='undefined'){clearInterval(wait);install()}},50);
})();
