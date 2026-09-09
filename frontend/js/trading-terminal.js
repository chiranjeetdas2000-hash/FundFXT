'use strict';
/* ===== FUNDFXT TRADING TERMINAL CONTROLLER =====
   Frontend only: all account/trade values come from the live backend.
   Keep UI labels independent from the market-data provider.
*/
const FX_API='https://fundfxt.onrender.com';
const SYMBOLS=['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD','EURGBP','EURJPY','EURAUD','EURCHF','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPNZD','AUDJPY','AUDNZD','AUDCAD','AUDCHF','CADJPY','CADCHF','CHFJPY','NZDJPY','NZDCHF','NZDCAD','XAUUSD','XAGUSD'];
const T={account:null,prices:{},selected:'EURUSD',tab:'OPEN',favorites:[],trades:[]};
const $=id=>document.getElementById(id);
const token=()=>localStorage.getItem('fundfxt_token')||'';
const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=(v,s)=>Number.isFinite(Number(v))?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';
const isNum=v=>Number.isFinite(Number(v));

async function api(path,opt={}){
  const r=await fetch(FX_API+path,{...opt,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json',...(opt.headers||{})}});
  let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw Error(d.error||d.message||`Request failed (${r.status})`);
  return d;
}
function feedback(msg,ok=false){
  const x=$('tradeFeedback');if(!x)return;
  x.textContent=msg;x.className='trade-feedback show '+(ok?'ok':'error');
  clearTimeout(feedback.t);feedback.t=setTimeout(()=>x.className='trade-feedback',5000);
}

/* ===== FAVORITES ===== */
function loadFavorites(){
  try{T.favorites=JSON.parse(localStorage.getItem('fundfxt_favorite_pairs')||'[]').filter(s=>SYMBOLS.includes(s))}catch{T.favorites=[]}
  if(!T.favorites.length)T.favorites=SYMBOLS.slice(0,5);
  localStorage.setItem('fundfxt_favorite_pairs',JSON.stringify(T.favorites));
}
function saveFavorites(){localStorage.setItem('fundfxt_favorite_pairs',JSON.stringify(T.favorites))}
function toggleFavorite(symbol){
  if(T.favorites.includes(symbol)){
    if(T.favorites.length===1)return feedback('Keep at least one favorite pair.');
    T.favorites=T.favorites.filter(s=>s!==symbol);
  }else T.favorites.push(symbol);
  saveFavorites();renderPairs();
}
function renderPairs(){
  const box=$('watchlist');if(!box)return;
  const q=($('search')?.value||'').toUpperCase().trim();
  const rows=T.favorites.filter(s=>s.includes(q));
  box.innerHTML=rows.map(s=>{
    const p=T.prices[s]||{},mid=Number(p.mid),spr=isNum(p.spread)?Number(p.spread):(Number(p.ask)-Number(p.bid)),ch=Number(p.changePercent);
    return `<button class="quote ${s===T.selected?'selected':''}" data-symbol="${s}" type="button"><span class="quote-main"><b class="watch-symbol">${s}</b><span class="quote-change">Δ ${isNum(ch)?(ch>=0?'+':'')+ch.toFixed(2)+'%':'—'}</span></span><span class="quote-spread">S ${fmt(spr,s)}</span><span class="quote-mid"><small>MID</small><b>${fmt(mid,s)}</b></span></button>`;
  }).join('')||'<div class="favorite-empty">No favorite pairs match your search.</div>';
  box.querySelectorAll('.quote').forEach(b=>b.onclick=()=>{T.selected=b.dataset.symbol;renderPairs();openPanel('center');loadChart()});
  const live=Object.values(T.prices).some(p=>isNum(p.bid)&&isNum(p.ask));
  if($('market')){$('market').textContent=live?'● LIVE':'● OFFLINE';$('market').style.color=live?'var(--green)':'var(--red)'}
}

async function loadPrices(){const d=await api('/api/prices');T.prices=d.prices||{};renderPairs()}
async function loadAccount(){
  const d=await api('/api/accounts');const list=d.accounts||d;
  const params=new URLSearchParams(location.search);
  const wanted=params.get('account_code')||params.get('account')||localStorage.getItem('fundfxt_selected_account');
  T.account=list.find(a=>String(a.account_code)===String(wanted))||list[0];
  if(!T.account)throw Error('No trading account available');
  localStorage.setItem('fundfxt_selected_account',T.account.account_code);
  if($('rightAccount'))$('rightAccount').textContent=T.account.account_code;
  renderAccount();
}
function renderAccount(){if(T.account){if($('balance'))$('balance').textContent=money(T.account.balance_cents);if($('equity'))$('equity').textContent=money(T.account.equity_cents)}}

/* ===== CHART ===== */
function loadChart(){
  const host=$('tv');if(!host)return;host.innerHTML='';
  const f=document.createElement('iframe');f.title='FundFXT '+T.selected;f.allowFullscreen=true;
  f.src='https://www.tradingview.com/widgetembed/?symbol='+encodeURIComponent('OANDA:'+T.selected)+'&interval=15&theme=dark&style=1&locale=en&enable_publishing=false&hide_top_toolbar=false&hide_side_toolbar=false&save_image=false&allow_symbol_change=true&autosize=true';
  host.appendChild(f);
}
function openPanel(name){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('mobile-active'));
  $(name)?.classList.add('mobile-active');
  document.querySelectorAll('.mobile-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(name==='right')loadTrades();if(name==='center')loadChart();
}

/* ===== TRADES ===== */
function tabStatus(tab){return tab==='HISTORY'?'CLOSED':tab}
// Backend is the sole source of truth for floating P/L. Do not fabricate a local pair-by-pair fallback.
function backendFloatingPL(t){
  if(isNum(t?.floating_profit_cents))return Number(t.floating_profit_cents)/100;
  return null;
}
function renderTradeCard(t){
  if(t.status==='CLOSED'){
    const cents=Number(t.realized_profit_cents||0);
    return `<article class="trade-card history-card" data-details="${t.trade_id}">
      <div class="trade-main"><div><b class="trade-symbol">${t.symbol}</b><small class="trade-id">${t.trade_id}</small></div><b class="trade-side ${String(t.side).toLowerCase()}">${t.side}</b></div>
      <div class="trade-meta"><div><span>Entry</span><b>${fmt(Number(t.entry_price),t.symbol)}</b></div><div><span>Lot</span><b>${Number(t.volume).toFixed(2)}</b></div><div><span>Exit</span><b>${fmt(Number(t.exit_price),t.symbol)}</b></div><div><span>Profit / Loss</span><b class="pl ${cents>=0?'green':'red'}">${cents>=0?'+':''}${money(cents)}</b></div></div>
      <small class="muted">Tap for trade details</small>
    </article>`;
  }
  if(t.status!=='OPEN')return '';
  const p=T.prices[t.symbol]||{},cur=t.side==='BUY'?Number(p.bid):Number(p.ask);
  const pl=backendFloatingPL(t);
  return `<article class="trade-card"><div class="trade-main"><div><b class="trade-symbol">${t.symbol}</b><small class="trade-id">${t.trade_id}</small></div><b class="trade-side ${String(t.side).toLowerCase()}">${t.side} · ${Number(t.volume).toFixed(2)}L</b></div>
    <div class="trade-meta"><div><span>Entry</span><b>${fmt(Number(t.entry_price),t.symbol)}</b></div><div><span>Current</span><b>${fmt(cur,t.symbol)}</b></div><div><span>P/L</span><b class="pl ${pl===null?'':pl>=0?'green':'red'}">${pl===null?'—':(pl>=0?'+':'')+'$'+pl.toFixed(2)}</b></div></div>
    <div class="trade-actions"><button class="mini" data-details="${t.trade_id}" type="button">Details</button><button class="mini close" data-close="${t.trade_id}" type="button">Close</button><button class="mini" data-partial="${t.trade_id}" type="button">Partial close</button></div></article>`;
}
function renderTrades(){
  const box=$('tradeScroll');if(!box)return;
  const status=tabStatus(T.tab),rows=T.trades.filter(t=>t.status===status);
  box.innerHTML=rows.map(renderTradeCard).join('')||`<div class="empty"><strong>No ${T.tab.toLowerCase()} trades</strong><span>${T.tab==='HISTORY'?'Closed trades will appear here.':T.tab==='PENDING'?'No pending orders.':'No open positions.'}</span></div>`;
  box.querySelectorAll('[data-details]').forEach(b=>b.onclick=()=>showDetails(b.dataset.details));
  box.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closePosition(b.dataset.close));
  box.querySelectorAll('[data-partial]').forEach(b=>b.onclick=()=>partialClose(b.dataset.partial));
}
async function loadTrades(){
  if(!T.account)return;
  try{const d=await api('/api/trade/get?account_code='+encodeURIComponent(T.account.account_code));T.trades=Array.isArray(d.trades)?d.trades:[];renderTrades()}
  catch(e){feedback(e.message)}
}
function showDetails(id){
  const t=T.trades.find(x=>String(x.trade_id)===String(id));if(!t)return;
  const cents=Number(t.realized_profit_cents||0);
  const fields=[['Trade ID',t.trade_id],['Pair',t.symbol],['Direction',t.side],['Lot Size',Number(t.volume).toFixed(2)],['Open Time',t.entry_time||t.created_at||'—'],['Close Time',t.exit_time||'—'],['Entry Price',fmt(Number(t.entry_price),t.symbol)],['Exit Price',fmt(Number(t.exit_price),t.symbol)],['Take Profit',isNum(t.take_profit)?fmt(Number(t.take_profit),t.symbol):'—'],['Stop Loss',isNum(t.stop_loss)?fmt(Number(t.stop_loss),t.symbol):'—'],['Exit By',t.close_reason||'—'],['Calculated P/L',t.status==='CLOSED'?`${cents>=0?'+':''}${money(cents)}`:'Open / Floating']].map(([a,b])=>`<div class="detail"><span>${a}</span><b>${b??'—'}</b></div>`).join('');
  modal('Trade Details',fields,'');
}
function modal(title,body,actions){
  document.querySelector('.trade-modal')?.remove();
  const x=document.createElement('div');x.className='trade-modal';
  x.innerHTML=`<div class="trade-modal-backdrop"></div><div class="trade-modal-card"><div class="trade-modal-head"><h3>${title}</h3><button class="trade-modal-close" type="button">×</button></div><div class="detail-grid">${body}</div>${actions?`<div class="modal-actions">${actions}</div>`:''}</div>`;
  document.body.appendChild(x);x.querySelector('.trade-modal-close').onclick=()=>x.remove();x.querySelector('.trade-modal-backdrop').onclick=()=>x.remove();
}
function closeAmountModal(id,t){
  const max=Number(t.volume);const body=`<div class="detail"><span>Pair</span><b>${t.symbol} · ${t.side}</b></div><div class="detail"><span>Current Lot</span><b>${max.toFixed(2)}</b></div><label class="modal-input"><span>Lots to close</span><input id="modalCloseVolume" type="number" min="0.01" max="${max}" step="0.01" value="${max.toFixed(2)}" inputmode="decimal"></label>`;
  const actions='<button class="mini close" id="confirmPartial" type="button">Close selected lots</button>';
  modal('Partial Close',body,actions);
  $('confirmPartial').onclick=async()=>{const v=Number($('modalCloseVolume')?.value);if(!isNum(v)||v<=0||v>=max)return feedback('Partial close must be less than the current lot size.');document.querySelector('.trade-modal')?.remove();await submitClose(id,v,true)};
}
async function submitClose(id,volume,partial){
  try{
    const path=partial?'/api/trades/'+encodeURIComponent(id)+'/partial-close':'/api/trades/'+encodeURIComponent(id)+'/close';
    const d=await api(path,{method:'POST',body:JSON.stringify({volume})});
    feedback(partial?`Partial close successful. Remaining ${Number(d.remaining_volume??0).toFixed(2)} lot.`:'Position closed successfully.',true);
    await loadAccount();await loadTrades();
  }catch(e){feedback(e.message)}
}
function closePosition(id){const t=T.trades.find(x=>String(x.trade_id)===String(id));if(!t||t.status!=='OPEN')return;submitClose(id,Number(t.volume),false)}
function partialClose(id){const t=T.trades.find(x=>String(x.trade_id)===String(id));if(!t||t.status!=='OPEN')return;closeAmountModal(id,t)}

/* ===== EXECUTION ===== */
async function execute(side){
  const code=T.account?.account_code,volume=Number($('volume')?.value),sl=$('sl')?.value===''?null:Number($('sl')?.value),tp=$('tp')?.value===''?null:Number($('tp')?.value);
  const orderType=$('orderType')?.value||'MARKET';
  if(!code)return feedback('No trading account selected.');
  if(orderType!=='MARKET')return feedback('Pending orders are handled by the pending-order controller.');
  if(!isNum(volume)||volume<.01||volume>2)return feedback('Lot size must be 0.01 to 2.00.');
  try{
    const d=await api('/api/trade/execute',{method:'POST',body:JSON.stringify({account_code:code,symbol:T.selected,side,volume,sl,tp})});
    feedback(`${side} ${T.selected} ${volume.toFixed(2)} lot executed successfully${d.trade_id?' · '+d.trade_id:''}`,true);
    await loadAccount();await loadTrades();openPanel('right');
  }catch(e){feedback(e.message)}
}

/* ===== FAVORITE MANAGER ===== */
function addPair(){
  const body=SYMBOLS.map(s=>{const fav=T.favorites.includes(s);return `<div class="pair-add-item"><b>${s}</b><button data-fav="${s}" type="button">${fav?'Remove':'Add'}</button></div>`}).join('');
  modal('Favorite Pairs',body,'');
  document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=()=>{toggleFavorite(b.dataset.fav);document.querySelector('.trade-modal')?.remove();addPair()});
}

/* ===== ACCOUNT / LOGOUT ===== */
function logout(){
  localStorage.removeItem('fundfxt_token');localStorage.removeItem('fundfxt_selected_account');
  location.href='/dashboard.html';
}
function setup(){
  loadFavorites();
  if($('addPairBtn'))$('addPairBtn').onclick=addPair;
  if($('search'))$('search').oninput=renderPairs;
  if($('buy'))$('buy').onclick=()=>execute('BUY');
  if($('sell'))$('sell').onclick=()=>execute('SELL');
  if($('orderType'))$('orderType').onchange=()=>$('pendingFields')?.classList.toggle('hidden',$('orderType').value==='MARKET');
  if($('refresh'))$('refresh').onclick=async()=>{try{await loadPrices();await loadAccount();await loadTrades()}catch(e){feedback(e.message)}};
  document.querySelectorAll('.mobile-nav button').forEach(b=>b.onclick=()=>openPanel(b.dataset.view));
  document.querySelectorAll('.right-tab').forEach(b=>b.onclick=()=>{T.tab=b.dataset.tab;renderTrades()});
  if($('chartMaxBtn'))$('chartMaxBtn').onclick=()=>{const c=$('center'),m=c.classList.toggle('chart-maximized');document.body.classList.toggle('chart-fullscreen',m);$('chartMaxBtn').textContent=m?'↙':'⛶'};
  if($('chartBack'))$('chartBack').onclick=()=>openPanel('watch');
  if($('tradesBack'))$('tradesBack').onclick=()=>openPanel('center');
  if($('accountMenuBtn'))$('accountMenuBtn').onclick=()=>{modal('Account',`<div class="detail"><span>Account</span><b>${T.account?.account_code||'—'}</b></div><div class="detail"><span>Balance</span><b>${money(T.account?.balance_cents)}</b></div><div class="detail"><span>Equity</span><b>${money(T.account?.equity_cents)}</b></div>`,'<button class="danger" id="terminalLogout" type="button">Logout</button>')};
  document.addEventListener('click',e=>{if(e.target.id==='terminalLogout')logout()});
  setInterval(()=>{loadPrices().catch(()=>{});if(T.account)loadTrades().catch(()=>{})},1000);
  loadAccount().then(loadPrices).then(()=>{renderPairs();loadChart();loadTrades()}).catch(e=>feedback(e.message));
  if(window.lucide?.createIcons)window.lucide.createIcons();
}
document.addEventListener('DOMContentLoaded',setup);
