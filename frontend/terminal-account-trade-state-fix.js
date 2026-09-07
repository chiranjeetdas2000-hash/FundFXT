'use strict';
// FundFXT UI consistency fix:
// 1) Closed/history trades show EXIT instead of CURRENT.
// 2) Once there are no open positions, Equity is displayed equal to Balance.
// 3) Closed/history rows never use a live quote to represent the exit price.
(function(){
  function sync(){
    const tradeBox=document.getElementById('tradeScroll');
    const balance=document.getElementById('balance');
    const equity=document.getElementById('equity');
    if(!tradeBox)return;

    const active=document.querySelector('.right-tab.active')?.dataset.tab||'';
    if(active==='HISTORY'){
      tradeBox.querySelectorAll('.trade-card').forEach(card=>{
        card.querySelectorAll('.trade-meta > div').forEach(cell=>{
          const label=cell.querySelector('span');
          if(label && label.textContent.trim().toUpperCase()==='CURRENT') label.textContent='Exit';
        });
      });
    }

    if(active==='OPEN' && balance && equity){
      const hasOpen=[...tradeBox.querySelectorAll('.trade-card')].some(card=>card.querySelector('[data-close]'));
      if(!hasOpen) equity.textContent=balance.textContent;
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const tradeBox=document.getElementById('tradeScroll');
    if(!tradeBox)return;
    const observer=new MutationObserver(sync);
    observer.observe(tradeBox,{childList:true,subtree:true,characterData:true});
    document.querySelectorAll('.right-tab').forEach(btn=>btn.addEventListener('click',()=>setTimeout(sync,0)));
    const balance=document.getElementById('balance');
    const equity=document.getElementById('equity');
    if(balance && equity) new MutationObserver(sync).observe(balance,{childList:true,subtree:true,characterData:true});
    sync();
  });
})();
