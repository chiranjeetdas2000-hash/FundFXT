'use strict';
// FundFXT: history cards must show the persisted exit price and realized P/L.
(function(){
  function sync(){
    const box=document.getElementById('tradeScroll');
    const active=document.querySelector('.right-tab.active')?.dataset.tab||'';
    if(!box||active!=='HISTORY')return;
    const cards=box.querySelectorAll('.trade-card');
    cards.forEach(card=>{
      const id=card.querySelector('.trade-top small')?.textContent?.trim();
      if(!id)return;
      // terminal.js does not retain the trade object on the card, so use the
      // latest S.trades record to source the authoritative persisted values.
      const state=window.S;
      const trade=state?.trades?.find(t=>String(t.trade_id)===String(id));
      if(!trade)return;
      const cells=card.querySelectorAll('.trade-meta > div');
      if(cells[1]){
        const label=cells[1].querySelector('span');
        const value=cells[1].querySelector('b');
        if(label)label.textContent='Exit';
        if(value&&trade.exit_price!=null&&window.price){
          value.textContent=window.price(trade.exit_price,trade.symbol);
        }else if(value&&trade.exit_price!=null){
          value.textContent=String(trade.exit_price);
        }
      }
      if(cells[2]){
        const value=cells[2].querySelector('b');
        const cents=Number(trade.realized_profit_cents||0);
        if(value&&Number.isFinite(cents)){
          const pl=cents/100;
          value.textContent=(pl>=0?'+':'')+'$'+pl.toFixed(2);
          value.className='pl '+(pl>=0?'green':'red');
        }
      }
    });
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const box=document.getElementById('tradeScroll');
    if(!box)return;
    new MutationObserver(()=>setTimeout(sync,0)).observe(box,{childList:true,subtree:true,characterData:true});
    document.querySelectorAll('.right-tab').forEach(b=>b.addEventListener('click',()=>setTimeout(sync,0)));
    setInterval(sync,1000);
  });
})();
