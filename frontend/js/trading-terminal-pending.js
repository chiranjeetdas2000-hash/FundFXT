/* ===== FUNDFXT PENDING ORDER UI / EXECUTION ===== */
(function(){
  'use strict';
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=(v,s)=>Number.isFinite(Number(v))?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';
  async function api(path,opt={}){
    const r=await fetch(API+path,{...opt,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json',...(opt.headers||{})}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(d.error||d.message||`Request failed (${r.status})`);
    return d;
  }
  const feedback=(msg,ok=false)=>{if(typeof window.feedback==='function')window.feedback(msg,ok);else{const x=document.getElementById('tradeFeedback');if(x){x.textContent=msg;x.className='trade-feedback show '+(ok?'ok':'error');}}};
  function accountCode(){return window.T?.account?.account_code||localStorage.getItem('fundfxt_selected_account')||'';}
  function selectedQuote(){return window.T?.prices?.[window.T.selected]||{};}
  async function placePending(side){
    const type=String(document.getElementById('orderType')?.value||'MARKET').toUpperCase();
    if(type==='MARKET')return false;
    const symbol=window.T?.selected,volume=n(document.getElementById('volume')?.value),entry=n(document.getElementById('entry')?.value);
    const sl=document.getElementById('sl')?.value.trim()===''?null:n(document.getElementById('sl')?.value);
    const tp=document.getElementById('tp')?.value.trim()===''?null:n(document.getElementById('tp')?.value);
    if(!accountCode())return feedback('No trading account selected.'),true;
    if(!symbol)return feedback('No symbol selected.'),true;
    if(volume<0.01||volume>2||Math.round(volume*100)!==volume*100)return feedback('Lot size must be 0.01 to 2.00.'),true;
    if(entry<=0)return feedback('Enter a valid pending order entry price.'),true;
    const q=selectedQuote(),bid=n(q.bid),ask=n(q.ask);
    if(type==='LIMIT'&&side==='BUY'&&entry>=ask)return feedback('BUY LIMIT entry must be below current ask.'),true;
    if(type==='LIMIT'&&side==='SELL'&&entry<=bid)return feedback('SELL LIMIT entry must be above current bid.'),true;
    if(type==='STOP'&&side==='BUY'&&entry<=ask)return feedback('BUY STOP entry must be above current ask.'),true;
    if(type==='STOP'&&side==='SELL'&&entry>=bid)return feedback('SELL STOP entry must be below current bid.'),true;
    try{
      const d=await api('/api/pending-orders',{method:'POST',body:JSON.stringify({account_code:accountCode(),symbol,side,order_type:type,volume,entry_price:entry,sl,tp})});
      feedback(`${side} ${type} order placed · ${symbol} · ${volume.toFixed(2)} lot${d.order_id?' · '+d.order_id:''}`,true);
      if(typeof window.loadTrades==='function')window.loadTrades();
      setTimeout(()=>showPending(),150);
    }catch(e){feedback(e.message)}
    return true;
  }
  function pendingCard(o){
    return `<article class="trade-card pending-card"><div class="trade-main"><div><b class="trade-symbol">${esc(o.symbol)}</b><small class="trade-id">${esc(o.order_id)}</small></div><b class="trade-side ${String(o.side).toLowerCase()}">${esc(o.side)} · ${esc(o.order_type)}</b></div><div class="trade-meta"><div><span>Entry</span><b>${fmt(o.entry_price,o.symbol)}</b></div><div><span>Lot</span><b>${n(o.volume).toFixed(2)}</b></div><div><span>SL</span><b>${o.stop_loss==null?'—':fmt(o.stop_loss,o.symbol)}</b></div><div><span>TP</span><b>${o.take_profit==null?'—':fmt(o.take_profit,o.symbol)}</b></div></div><div class="trade-actions"><button class="mini close" data-pcancel="${esc(o.order_id)}" type="button">Cancel</button><button class="mini" data-pmodify="${esc(o.order_id)}" type="button">Modify</button></div></article>`;
  }
  async function showPending(){
    const box=document.getElementById('tradeScroll');if(!box)return;
    try{
      const d=await api('/api/pending-orders');
      const rows=Array.isArray(d.orders)?d.orders:[];
      box.innerHTML=rows.map(pendingCard).join('')||'<div class="empty"><strong>No pending trades</strong><span>Your Limit and Stop orders will appear here.</span></div>';
      box.querySelectorAll('[data-pcancel]').forEach(b=>b.onclick=async()=>{try{await api('/api/pending-orders/'+encodeURIComponent(b.dataset.pcancel)+'/cancel',{method:'POST'});feedback('Pending order cancelled.',true);showPending()}catch(e){feedback(e.message)}});
      box.querySelectorAll('[data-pmodify]').forEach(b=>b.onclick=()=>modifyPending(b.dataset.pmodify,rows.find(x=>String(x.order_id)===String(b.dataset.pmodify))));
    }catch(e){box.innerHTML='<div class="empty"><strong>Pending orders unavailable</strong><span>'+esc(e.message)+'</span></div>';}
  }
  function modifyPending(id,o){
    if(!o)return;
    const body=`<div class="modify-grid"><label class="modify-field"><span>Entry Price</span><input id="pendingEntry" type="number" step="any" value="${o.entry_price??''}"></label><label class="modify-field"><span>Take Profit</span><input id="pendingTP" type="number" step="any" value="${o.take_profit??''}"></label><label class="modify-field"><span>Stop Loss</span><input id="pendingSL" type="number" step="any" value="${o.stop_loss??''}"></label></div>`;
    if(typeof window.modal!=='function')return;
    window.modal('Modify Pending Order',body,'<button class="modify-save" id="savePending" type="button">Save Changes</button>');
    document.getElementById('savePending').onclick=async()=>{
      const entry=n(document.getElementById('pendingEntry')?.value),tp=document.getElementById('pendingTP')?.value.trim()===''?null:n(document.getElementById('pendingTP')?.value),sl=document.getElementById('pendingSL')?.value.trim()===''?null:n(document.getElementById('pendingSL')?.value);
      if(entry<=0)return feedback('Invalid entry price.');
      try{await api('/api/pending-orders/'+encodeURIComponent(id)+'/modify',{method:'POST',body:JSON.stringify({entry_price:entry,tp,sl})});document.querySelector('.trade-modal')?.remove();feedback('Pending order modified successfully.',true);showPending()}catch(e){feedback(e.message)}
    };
  }
  function install(){
    const buy=document.getElementById('buy'),sell=document.getElementById('sell');
    [buy,sell].forEach((btn,idx)=>btn&&btn.addEventListener('click',async e=>{if(String(document.getElementById('orderType')?.value||'MARKET').toUpperCase()==='MARKET')return;e.preventDefault();e.stopImmediatePropagation();await placePending(idx===0?'BUY':'SELL')},true));
    document.querySelectorAll('.right-tab').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.tab==='PENDING')setTimeout(showPending,0)},true));
    if(window.T?.tab==='PENDING')showPending();
  }
  const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('buy')&&document.getElementById('tradeScroll')){clearInterval(wait);install()}},50);
})();
