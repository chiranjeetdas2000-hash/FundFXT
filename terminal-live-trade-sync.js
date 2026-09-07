'use strict';
// FundFXT authoritative terminal sync. Uses the same account/trade routes as the
// dashboard and refreshes balance/equity plus Open/Pending/History independently
// of the legacy terminal trade renderer.
(function(){
  const API='https://fundfxt.onrender.com';
  const token=localStorage.getItem('fundfxt_token')||'';
  const H={Authorization:`Bearer ${token}`,Accept:'application/json'};
  let account=null,tab='OPEN',timer=null,busy=false;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]||m));
  const fmtPrice=(v,s)=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5);
  const money=v=>'$'+(Number(v||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  async function get(path){const r=await fetch(API+path,{headers:H});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d}
  async function resolveAccount(){
    const code=new URLSearchParams(location.search).get('account_code')||new URLSearchParams(location.search).get('account')||localStorage.getItem('fundfxt_selected_account')||'';
    const d=await get('/api/accounts');const list=Array.isArray(d)?d:(d.accounts||[]);const a=(code&&list.find(x=>String(x.account_code)===String(code)))||list[0];if(!a)throw Error('No trading account available');account=a;localStorage.setItem('fundfxt_selected_account',a.account_code);if($('rightAccount'))$('rightAccount').textContent=a.account_code;return a;
  }
  function updateAccount(a){if(!a)return;if($('balance'))$('balance').textContent=money(a.balance_cents);if($('equity'))$('equity').textContent=money(a.equity_cents);if($('accountStatus'))$('accountStatus').textContent=`${a.status||'ACTIVE'} · ${a.account_code||''}`}
  function pl(t){const p=Number(t.realized_profit_cents);if(t.status==='CLOSED'&&Number.isFinite(p))return p/100;const c=Number(t.current_price),e=Number(t.entry_price),v=Number(t.volume),contract=/XAU|XAG/i.test(t.symbol)?100:/BTC|ETH/i.test(t.symbol)?1:100000;if(!Number.isFinite(c)||!Number.isFinite(e)||!Number.isFinite(v))return 0;return(t.side==='BUY'?c-e:e-c)*v*contract}
  function render(trades){
    const box=$('tradeScroll');if(!box)return;const rows=trades.filter(t=>tab==='OPEN'?t.status==='OPEN':tab==='PENDING'?t.status==='PENDING':t.status==='CLOSED');
    if($('tradeCount'))$('tradeCount').textContent=trades.filter(t=>t.status==='OPEN').length;
    box.innerHTML=rows.length?rows.map(t=>{const profit=pl(t);const buttons=t.status==='OPEN'?`<button class="mini" data-live-mod="${esc(t.trade_id)}">SL/TP</button><button class="mini close" data-live-close="${esc(t.trade_id)}">Close</button>`:t.status==='PENDING'?`<button class="mini close" data-live-cancel="${esc(t.trade_id)}">Cancel</button>`:'';return `<article class="trade-card premium-trade-card" data-trade-id="${esc(t.trade_id)}"><div class="premium-trade-head"><div class="premium-pair-block"><div class="premium-pair-row"><b>${esc(t.symbol)}</b><span class="premium-direction ${t.side==='SELL'?'sell':''}">${esc(t.side)}</span><span class="premium-lot">${esc(t.volume)} LOT</span></div><small>ORDER ID · ${esc(t.trade_id)}</small></div></div><div class="premium-entry-row"><div><span>${t.status==='PENDING'?'ENTRY PRICE':'ENTRY PRICE'}</span><b>${fmtPrice(t.entry_price,t.symbol)}</b></div><div class="premium-entry-action">${t.status==='OPEN'?`<button class="mini premium-sltp" data-live-mod="${esc(t.trade_id)}">SL / TP</button>`:''}</div></div><div class="premium-live-row"><div><span>${t.status==='PENDING'?'STATUS':'CURRENT'}</span><b>${t.status==='PENDING'?'PENDING':fmtPrice(t.current_price,t.symbol)}</b></div><div class="premium-pnl ${profit<0?'negative':'positive'}"><span>${t.status==='CLOSED'?'REALIZED P/L':'P / L'}</span><b>${profit>=0?'+':''}$${profit.toFixed(2)}</b></div></div><div class="trade-buttons premium-buttons">${buttons}</div></article>`}).join(''):`<div class="empty"><strong>No ${tab.toLowerCase()} trades</strong><span>${tab==='OPEN'?'Open positions for this account will appear here.':tab==='PENDING'?'Pending orders for this account will appear here.':'Closed trades for this account will appear here.'}</span></div>`;
    box.querySelectorAll('[data-live-close]').forEach(b=>b.onclick=async()=>{try{await get('/api/trades/'+encodeURIComponent(b.dataset.liveClose)+'/close',{method:'POST'});await sync()}catch(e){window.toast?.(e.message)}});
    box.querySelectorAll('[data-live-cancel]').forEach(b=>b.onclick=async()=>{try{const r=await fetch(API+'/api/trades/'+encodeURIComponent(b.dataset.liveCancel),{method:'DELETE',headers:H});const d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'Unable to cancel pending order');await sync()}catch(e){window.toast?.(e.message)}});
    box.querySelectorAll('[data-live-mod]').forEach(b=>b.onclick=()=>window.modifyTrade?.(b.dataset.liveMod));
  }
  async function sync(){if(busy||!account)return;busy=true;try{const [summary,trades]=await Promise.all([get('/api/accounts/'+encodeURIComponent(account.id)+'/summary'),get('/api/accounts/'+encodeURIComponent(account.id)+'/trades')]);updateAccount(summary.account||summary);render(Array.isArray(trades.trades)?trades.trades:[])}catch(e){console.warn('FundFXT authoritative trade sync:',e.message)}finally{busy=false}}
  function setup(){document.querySelectorAll('.right-tab').forEach(b=>b.onclick=()=>{tab=b.dataset.tab||'OPEN';document.querySelectorAll('.right-tab').forEach(x=>x.classList.toggle('active',x===b));sync()});resolveAccount().then(()=>{sync();clearInterval(timer);timer=setInterval(sync,1000)}).catch(e=>console.warn('FundFXT account sync:',e.message))}
  document.addEventListener('DOMContentLoaded',setup);
})();
