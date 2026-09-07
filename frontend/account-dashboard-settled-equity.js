'use strict';
// When an account has no open positions, its equity is settled to balance.
(function(){
  function sync(){
    const open=document.getElementById('openTrades');
    const balance=document.getElementById('balance');
    const equity=document.getElementById('equity');
    if(!open||!balance||!equity)return;
    if(Number(open.textContent.trim())===0 && balance.textContent.trim() && balance.textContent.trim()!=='$0.00'){
      equity.textContent=balance.textContent;
      const initialText=window.__fundfxtInitialBalance;
      if(initialText){
        const b=Number(balance.textContent.replace(/[$,]/g,''));
        const i=Number(initialText.replace(/[$,]/g,''));
        const pnl=document.getElementById('pnl');
        if(pnl && Number.isFinite(b)&&Number.isFinite(i)){
          const v=b-i;pnl.textContent=(v<0?'-':'')+'$'+Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
          pnl.className='value '+(v>=0?'green':'red');
        }
      }
    }
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const content=document.getElementById('content');
    const obs=new MutationObserver(sync);
    if(content)obs.observe(content,{childList:true,subtree:true,characterData:true});
    sync();
  });
})();
