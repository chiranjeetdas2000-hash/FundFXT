'use strict';
(function(){
  let observer,busy=false;
  function normalize(){
    const box=document.getElementById('watchlist');
    if(!box||busy)return;
    busy=true;observer?.disconnect();
    try{
      box.querySelectorAll('.quote').forEach(button=>{
        const symbol=button.dataset.symbol||button.querySelector('.quote-main b')?.textContent?.trim()||'';
        const priceBox=button.querySelector('.quote-prices');
        if(!symbol||!priceBox)return;
        const mid=priceBox.querySelector('.last')?.textContent||'—';
        const raw=priceBox.querySelector('small')?.textContent||'';
        const changeMatch=raw.match(/Δ\s*([+-]?\d+(?:\.\d+)?%)/i);
        const spreadMatch=raw.match(/(?:SPR|S)\s*([0-9.]+)/i);
        const change=changeMatch?changeMatch[1]:'—';
        const spread=spreadMatch?spreadMatch[1]:'—';
        button.innerHTML=`<span class="quote-main"><b class="watch-symbol">${symbol}</b><span class="quote-detail quote-change">Δ ${change}</span></span><span class="quote-spread">— ${spread} —</span><span class="quote-mid"><small>MID</small><b>${mid}</b></span>`;
      });
      const market=document.getElementById('market');
      if(market){
        const live=[...box.querySelectorAll('.quote-mid b')].some(x=>x.textContent.trim()!=='—');
        market.textContent=live?'● LIVE':'● OFFLINE';market.style.color=live?'#00b56a':'#ff4444';
      }
    }finally{busy=false;observer?.observe(box,{childList:true,subtree:true})}
  }
  document.addEventListener('DOMContentLoaded',()=>{const box=document.getElementById('watchlist');if(!box)return;observer=new MutationObserver(normalize);observer.observe(box,{childList:true,subtree:true});normalize()});
})();
