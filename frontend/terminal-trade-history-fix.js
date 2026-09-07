'use strict';
(function(){
  let timer=0;
  function price(v,s){if(v==null||!Number.isFinite(Number(v)))return '—';return Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5)}
  function sync(){
    const box=document.getElementById('tradeScroll');
    const active=document.querySelector('.right-tab.active')?.dataset.tab||'';
    const code=document.getElementById('rightAccount')?.textContent?.trim()||localStorage.getItem('fundfxt_selected_account')||'';
    const token=localStorage.getItem('fundfxt_token');
    if(!box||active!=='HISTORY'||!code||!token)return;
    fetch('https://fundfxt.onrender.com/api/trade/get?account_code='+encodeURIComponent(code),{headers:{Authorization:'Bearer '+token}})
      .then(r=>r.ok?r.json():null).then(d=>{
        if(!d)return;
        const trades=Array.isArray(d.trades)?d.trades:[];
        box.querySelectorAll('.trade-card').forEach(card=>{
          const id=card.querySelector('.trade-top small')?.textContent?.trim();
          const t=trades.find(x=>String(x.trade_id)===String(id));
          if(!t)return;
          const cells=card.querySelectorAll('.trade-meta > div');
          if(cells[1]){cells[1].querySelector('span')&&(cells[1].querySelector('span').textContent='Exit');cells[1].querySelector('b')&&(cells[1].querySelector('b').textContent=price(t.exit_price,t.symbol))}
          if(cells[2]){const pl=Number(t.realized_profit_cents||0)/100;const b=cells[2].querySelector('b');if(b){b.textContent=(pl>=0?'+':'')+'$'+pl.toFixed(2);b.className='pl '+(pl>=0?'green':'red')}}
        });
      }).catch(()=>{});
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const box=document.getElementById('tradeScroll');if(!box)return;
    new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(sync,100)}).observe(box,{childList:true,subtree:true,characterData:true});
    document.querySelectorAll('.right-tab').forEach(b=>b.addEventListener('click',()=>setTimeout(sync,120)));
    setInterval(sync,1500);
  });
})();
