'use strict';
// FundFXT terminal action/UI cleanup and execution safety layer.
(function(){
  const API='https://fundfxt.onrender.com';
  const $=id=>document.getElementById(id);
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const accountCode=()=>localStorage.getItem('fundfxt_selected_account')||$('rightAccount')?.textContent?.trim()||'';
  const selected=()=>($('selectedSymbol')?.textContent||'EURUSD').trim().toUpperCase();
  const toast=m=>{const x=$('toast');if(x){x.textContent=m;x.classList.remove('hidden');setTimeout(()=>x.classList.add('hidden'),3000)}};
  async function execute(side){
    const code=accountCode();
    const volume=Number($('volume')?.value||0);
    if(!code)return toast('Select a trading account first');
    if(!Number.isFinite(volume)||volume<0.01||volume>2)return toast('Volume must be between 0.01 and 2.00');
    const type=$('orderType')?.value||'MARKET';
    const sl=$('sl')?.value===''?null:Number($('sl')?.value);
    const tp=$('tp')?.value===''?null:Number($('tp')?.value);
    const body=type==='MARKET'
      ?{account_code:code,symbol:selected(),side,volume,sl,tp}
      :{account_code:code,symbol:selected(),side,volume,order_type:type,limit_price:Number($('entry')?.value),sl,tp};
    const btn=$(side==='BUY'?'buy':'sell');
    if(btn)btn.disabled=true;
    try{
      const path=type==='MARKET'?'/api/trade/execute':'/api/trades/pending';
      const r=await fetch(API+path,{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||d.success===false)throw Error(d.error||'Trade execution failed');
      toast(side+' order executed');
      document.querySelector('[data-view="right"]')?.click();
      window.dispatchEvent(new CustomEvent('fundfxt-trade-executed'));
    }catch(e){toast(e.message)}finally{if(btn)btn.disabled=false}
  }
  function cleanup(){
    // Remove non-essential chart controls requested by the user.
    document.querySelector('.timebar')?.remove();
    $('selectedPrice')?.remove();
    $('quoteBox')?.remove();
    $('chartSource')?.remove();
    // Restore a visible chart maximize/minimize control.
    const head=document.querySelector('.chart-head');
    if(head&&!$('chartMaxBtn')){
      const b=document.createElement('button');b.id='chartMaxBtn';b.type='button';b.className='chart-max-btn';b.title='Maximize chart';b.setAttribute('aria-label','Maximize chart');b.textContent='⛶';
      head.appendChild(b);
      b.onclick=()=>{
        const center=$('center');
        const max=center?.classList.toggle('chart-maximized');
        b.textContent=max?'↙':'⛶';b.title=max?'Minimize chart':'Maximize chart';
        document.body.classList.toggle('chart-fullscreen',!!max);
        window.dispatchEvent(new Event('resize'));
      };
    }
  }
  document.addEventListener('DOMContentLoaded',()=>{
    cleanup();
    $('buy')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();execute('BUY')},true);
    $('sell')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();execute('SELL')},true);
    new MutationObserver(cleanup).observe(document.body,{childList:true,subtree:true});
  });
})();
