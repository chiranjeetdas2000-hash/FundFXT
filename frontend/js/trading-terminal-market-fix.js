/* ===== FUNDfxT MARKET WATCH FINAL FIX =====
   Pair rows intentionally show only Pair + BID + daily change.
   Spread, Ask and Mid labels/columns are removed.
   LIVE status accepts bid, ask or mid because some CFD/FX feeds expose mid first.
*/
(function(){
  'use strict';
  const num=v=>Number.isFinite(Number(v));
  const price=(v,s)=>num(v)?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';

  function patchRows(){
    if(typeof T==='undefined')return;
    const box=document.getElementById('watchlist');
    if(!box)return;

    // Do not rebuild the list here; the original terminal controller owns favorites/search/clicks.
    // Only replace the rendered quote columns so every refresh remains compatible with it.
    box.querySelectorAll('.quote').forEach(row=>{
      const symbol=row.dataset.symbol||row.querySelector('.watch-symbol')?.textContent?.trim()||'';
      const p=T.prices?.[symbol]||{};
      const bid=num(p.bid)?Number(p.bid):Number(p.mid);
      const change=Number(p.changePercent);
      const main=row.querySelector('.quote-main');
      if(main){
        let ch=main.querySelector('.quote-change');
        if(!ch){ch=document.createElement('span');ch.className='quote-change';main.appendChild(ch)}
        ch.textContent='Δ '+(num(change)?(change>=0?'+':'')+change.toFixed(2)+'%':'—');
      }
      row.querySelector('.quote-spread')?.remove();
      row.querySelector('.quote-mid')?.remove();
      let bidEl=row.querySelector('.quote-bid');
      if(!bidEl){bidEl=document.createElement('span');bidEl.className='quote-bid';row.appendChild(bidEl)}
      bidEl.innerHTML='<small>BID</small><b>'+price(bid,symbol)+'</b>';
    });

    const live=Object.values(T.prices||{}).some(p=>num(p?.bid)||num(p?.ask)||num(p?.mid));
    const market=document.getElementById('market');
    if(market){
      market.textContent=live?'● LIVE':'● OFFLINE';
      market.style.color=live?'var(--green)':'var(--red)';
    }
  }

  function install(){
    const box=document.getElementById('watchlist');
    if(!box)return;
    const observer=new MutationObserver(()=>{
      if(observer.busy)return;
      observer.busy=true;
      requestAnimationFrame(()=>{patchRows();observer.busy=false;});
    });
    observer.observe(box,{childList:true,subtree:true});
    patchRows();
    const search=document.getElementById('search');
    if(search)search.addEventListener('input',()=>setTimeout(patchRows,0));
    setInterval(patchRows,500);
  }

  const wait=setInterval(()=>{
    if(document.readyState!=='loading'&&document.getElementById('watchlist')&&typeof T!=='undefined'){
      clearInterval(wait);
      install();
    }
  },50);
})();