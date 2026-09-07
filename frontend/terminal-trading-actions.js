'use strict';
// FundFXT terminal execution + chart UI layer.
(function(){
  const API='https://fundfxt.onrender.com';
  const $=id=>document.getElementById(id);
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const accountCode=()=>{
    const q=new URLSearchParams(location.search);
    return q.get('account_code')||q.get('account')||localStorage.getItem('fundfxt_selected_account')||$('rightAccount')?.textContent?.trim()||'';
  };
  const selected=()=>($('selectedSymbol')?.textContent||'EURUSD').trim().toUpperCase();

  function feedback(message,ok=false){
    let x=$('tradeFeedback');
    if(!x){
      x=document.createElement('div');
      x.id='tradeFeedback';
      x.setAttribute('role','status');
      document.body.appendChild(x);
    }
    x.textContent=message;
    x.dataset.ok=ok?'1':'0';
    x.classList.add('show');
    clearTimeout(x._timer);
    x._timer=setTimeout(()=>x.classList.remove('show'),5000);
  }

  async function execute(side){
    const code=accountCode();
    const volume=Number($('volume')?.value||0);
    const type=$('orderType')?.value||'MARKET';
    const slValue=$('sl')?.value?.trim()||'';
    const tpValue=$('tp')?.value?.trim()||'';
    const sl=slValue===''?null:Number(slValue);
    const tp=tpValue===''?null:Number(tpValue);

    if(!token()) return feedback('Please log in again before placing a trade.');
    if(!code) return feedback('No trading account is selected.');
    if(!Number.isFinite(volume)||volume<0.01||volume>2) return feedback('Lot size must be between 0.01 and 2.00.');
    if(slValue!==''&&!Number.isFinite(sl)) return feedback('Stop Loss is not a valid price.');
    if(tpValue!==''&&!Number.isFinite(tp)) return feedback('Take Profit is not a valid price.');

    const body=type==='MARKET'
      ?{account_code:code,symbol:selected(),side,volume,sl,tp}
      :{account_code:code,symbol:selected(),side,volume,order_type:type,limit_price:Number($('entry')?.value),sl,tp};
    const btn=$(side==='BUY'?'buy':'sell');
    const other=$(side==='BUY'?'sell':'buy');
    if(btn)btn.disabled=true;
    if(other)other.disabled=true;
    feedback('Placing '+side+' order…');

    try{
      const path=type==='MARKET'?'/api/trade/execute':'/api/trades/pending';
      const r=await fetch(API+path,{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      const raw=await r.text();
      let d={};
      try{d=raw?JSON.parse(raw):{}}catch{}
      if(!r.ok||d.success===false) throw new Error(d.error||d.message||('Trade request failed ('+r.status+')'));
      const id=d.trade_id?(' · '+d.trade_id):'';
      const entry=d.entry_price!=null?(' @ '+Number(d.entry_price).toFixed(/JPY$/i.test(selected())?3:5):'');
      feedback(side+' '+selected()+' '+volume.toFixed(2)+' lot executed successfully'+entry+id,true);
      document.querySelector('[data-view="right"]')?.click();
      window.dispatchEvent(new CustomEvent('fundfxt-trade-executed',{detail:d}));
      setTimeout(()=>window.location.reload(),900);
    }catch(e){
      feedback(e?.message||'Trade execution failed.');
    }finally{
      if(btn)btn.disabled=false;
      if(other)other.disabled=false;
    }
  }

  function cleanup(){
    document.querySelector('.timebar')?.remove();
    $('selectedPrice')?.remove();
    $('quoteBox')?.remove();
    $('chartSource')?.remove();
    document.querySelectorAll('.status').forEach(x=>{
      if(/BiQuote|price feed|market data|trade data|fetch|server|source|sync/i.test(x.textContent||'')) x.remove();
    });
    document.querySelectorAll('.panel-title .muted').forEach(x=>{
      if(/BiQuote|price feed|fetch|server|source/i.test(x.textContent||'')) x.remove();
    });
    const head=document.querySelector('.chart-head');
    if(head&&!$('chartMaxBtn')){
      const b=document.createElement('button');
      b.id='chartMaxBtn';b.type='button';b.className='chart-max-btn';b.title='Maximize chart';b.setAttribute('aria-label','Maximize chart');b.textContent='⛶';
      head.appendChild(b);
      b.onclick=()=>{
        const center=$('center');
        const max=center?.classList.toggle('chart-maximized');
        b.textContent=max?'↙':'⛶';
        b.title=max?'Minimize chart':'Maximize chart';
        document.body.classList.toggle('chart-fullscreen',!!max);
        window.dispatchEvent(new Event('resize'));
      };
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    cleanup();
    const bind=(id,side)=>{
      const b=$(id);if(!b)return;
      b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();execute(side);},true);
    };
    bind('buy','BUY');
    bind('sell','SELL');
    new MutationObserver(cleanup).observe(document.body,{childList:true,subtree:true});
  });
})();
