const API='https://fundfxt.onrender.com';
const token=localStorage.getItem('fundfxt_token');
const qs=new URLSearchParams(location.search);
const requested=qs.get('account_code');
const S={account:null,prices:{},symbols:[],selected:'EURUSD',tab:'OPEN',timer:null,trades:[]};
const $=id=>document.getElementById(id);
const money=v=>'$'+(Number(v||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const price=(v,s)=>{if(v==null||!Number.isFinite(Number(v)))return'—';return Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5)};
const headers=()=>({Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
async function api(path,opt={}){const r=await fetch(API+path,{...opt,headers:{...headers(),...(opt.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d}
function toast(m){const x=$('toast');if(!x)return;x.textContent=m;x.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.add('hidden'),3000)}
function setGate(title,msg){const t=$('gateTitle'),m=$('gateText');if(t)t.textContent=title;if(m)m.textContent=msg}
function showPanel(name){document.querySelectorAll('.panel').forEach(x=>x.classList.remove('mobile-active'));const p=$(name);if(p)p.classList.add('mobile-active');document.querySelectorAll('.mobile-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));if(name==='right')loadTrades();if(name==='center')loadTV()}
async function boot(){
  if(!token){location.href='/login.html';return}
  try{
    const d=await api('/api/accounts');
    const list=Array.isArray(d)?d:(d.accounts||[]);
    const a=list.find(x=>x.account_code===requested)||list[0];
    if(!a)throw Error('No trading account available');
    S.account=a;
    $('accountCode').textContent=a.account_code;$('rightAccount').textContent=a.account_code;$('accountName').textContent=a.account_code;
    setGate('Loading terminal','Syncing account, live quotes and TradingView…');
    await loadPrices();
    await loadTrades();
    await refreshAccount();
    renderQuotes();renderSelectedPrice();renderButtons();renderAccount();
    $('gate')?.classList.add('hidden');
    showPanel('watch');
    loadTV();
    startLoop();
  }catch(e){setGate('Terminal unavailable',e.message);toast(e.message);renderQuotes()}
}
async function loadPrices(){
  const d=await api('/api/prices');
  S.prices=d.prices&&typeof d.prices==='object'?d.prices:{};
  S.symbols=Array.isArray(d.symbols)&&d.symbols.length?d.symbols:Object.keys(S.prices);
  if(!S.symbols.length)S.symbols=['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCHF','USDCAD','NZDUSD','XAUUSD','XAGUSD'];
  if(!S.symbols.includes(S.selected))S.selected=S.symbols[0];
  renderQuotes();renderSelectedPrice();renderButtons();
}
function renderQuotes(){
  const box=$('watchlist');if(!box)return;
  const term=($('search')?.value||'').trim().toLowerCase();
  const q=S.symbols.filter(s=>String(s).toLowerCase().includes(term));
  box.innerHTML=q.map(s=>{
    const p=S.prices[s]||{};const live=Number.isFinite(Number(p.bid))&&Number.isFinite(Number(p.ask));
    return `<button class="quote ${s===S.selected?'selected':''}" data-symbol="${s}"><span class="quote-main"><b>${s}</b><small>${live?'LIVE':'MARKET CLOSED'}</small></span><span class="quote-prices"><b class="bid">${price(p.bid,s)}</b><b class="ask">${price(p.ask,s)}</b><small>${live?(Number(p.changePercent||0)>=0?'+':'')+Number(p.changePercent||0).toFixed(2)+'%':'—'}</small></span></button>`
  }).join('')||'<div class="empty"><strong>No symbols found</strong><span>Try another pair name.</span></div>';
  box.querySelectorAll('.quote').forEach(x=>x.onclick=()=>{S.selected=x.dataset.symbol;renderQuotes();renderSelectedPrice();renderButtons();showPanel('center');loadTV()});
}
function renderSelectedPrice(){const p=S.prices[S.selected]||{};$('selectedSymbol').textContent=S.selected;$('selectedPrice').textContent=`Bid ${price(p.bid,S.selected)}  •  Ask ${price(p.ask,S.selected)}`;$('chartSource').textContent=Number.isFinite(Number(p.bid))?'LIVE FCS PRICE FEED':'TRADINGVIEW MARKET DATA';}
function renderButtons(){const p=S.prices[S.selected]||{};$('buy').textContent=`BUY  ${price(p.ask,S.selected)}`;$('sell').textContent=`SELL  ${price(p.bid,S.selected)}`;$('buy').disabled=!p.ask;$('sell').disabled=!p.bid;$('quoteBox').innerHTML=`<span>BID <b>${price(p.bid,S.selected)}</b></span><span>ASK <b>${price(p.ask,S.selected)}</b></span>`}
function tvSymbol(s){const aliases={XAUUSD:'OANDA:XAUUSD',XAGUSD:'OANDA:XAGUSD'};return aliases[s]||`FX:${s}`}
function loadTV(){const host=$('tv');if(!host)return;const interval=document.querySelector('.tf.active')?.dataset.interval||'15';host.innerHTML='';const iframe=document.createElement('iframe');iframe.title=`TradingView ${S.selected}`;iframe.allow='fullscreen';iframe.loading='eager';iframe.src=`https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol(S.selected))}&interval=${interval}&theme=dark&style=1&locale=en&toolbar_bg=%230b0f14&enable_publishing=false&hide_top_toolbar=false&hide_side_toolbar=false&save_image=false&hide_legend=false&withdateranges=true&details=true&hotlist=true&calendar=false`;host.appendChild(iframe);$('chartFallback')?.classList.add('hidden')}
async function loadTrades(){if(!S.account)return;try{const d=await api('/api/trade/get?account_code='+encodeURIComponent(S.account.account_code));S.trades=d.trades||[];renderTrades()}catch(e){S.trades=[];$('tradeScroll').innerHTML=`<div class="empty"><strong>Trades unavailable</strong><span>${e.message}</span></div>`}}
function visibleTrades(){return S.trades.filter(t=>S.tab==='OPEN'?t.status==='OPEN':S.tab==='PENDING'?t.status==='PENDING':t.status==='CLOSED')}
function renderTrades(){const box=$('tradeScroll');if(!box)return;const rows=visibleTrades();$('tradeCount').textContent=S.trades.filter(t=>t.status==='OPEN').length;box.innerHTML=rows.map(t=>{const p=S.prices[t.symbol]||{};const cur=t.status==='OPEN'?(t.side==='BUY'?p.bid:p.ask):t.current_price;const pl=t.status==='OPEN'?calcPL(t,cur):Number(t.realized_profit_cents||0)/100;return `<article class="trade-card"><div class="trade-top"><div><b>${t.symbol}</b><small>${t.trade_id||''}</small></div><span class="side ${t.side==='SELL'?'sell':''}">${t.side} · ${t.volume}</span></div><div class="trade-meta"><div><span>Entry</span><b>${price(t.entry_price,t.symbol)}</b></div><div><span>Current</span><b>${price(cur,t.symbol)}</b></div><div><span>P/L</span><b class="pl ${pl>=0?'green':'red'}">${pl>=0?'+':''}$${pl.toFixed(2)}</b></div></div><div class="trade-buttons">${t.status==='OPEN'?`<button class="mini" data-mod="${t.trade_id}">SL/TP</button><button class="mini close" data-close="${t.trade_id}">Close</button>`:''}${t.status==='PENDING'?`<button class="mini close" data-cancel="${t.trade_id}">Cancel</button>`:''}</div></article>`}).join('')||`<div class="empty"><strong>No ${S.tab.toLowerCase()} trades</strong><span>Your ${S.tab.toLowerCase()} positions for ${S.account?.account_code||'this account'} will appear here.</span></div>`;box.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeTrade(b.dataset.close));box.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>cancelPending(b.dataset.cancel));box.querySelectorAll('[data-mod]').forEach(b=>b.onclick=()=>modifyTrade(b.dataset.mod))}
function calcPL(t,current){const e=Number(t.entry_price),v=Number(t.volume),c=Number(current);if(!Number.isFinite(c))return 0;const points=t.side==='BUY'?c-e:e-c;const contract=/XAU|GOLD/i.test(t.symbol)?100:100000;return points*v*contract}
async function closeTrade(id){try{await api('/api/trades/'+encodeURIComponent(id)+'/close',{method:'POST',body:'{}'});toast('Trade closed');await loadTrades();await refreshAccount()}catch(e){toast(e.message)}}
async function cancelPending(id){try{await api('/api/trades/'+encodeURIComponent(id),{method:'DELETE'});toast('Pending order cancelled');await loadTrades()}catch(e){toast(e.message)}}
async function modifyTrade(id){const t=S.trades.find(x=>x.trade_id===id);if(!t)return;const sl=prompt('Stop Loss',t.stop_loss??'');if(sl===null)return;const tp=prompt('Take Profit',t.take_profit??'');if(tp===null)return;try{await api('/api/trades/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({stop_loss:sl,take_profit:tp})});toast('Stops updated');await loadTrades()}catch(e){toast(e.message)}}
async function place(side){if(!S.account)return;const type=$('orderType').value;const volume=Number($('volume').value||0);const sl=$('sl').value===''?null:Number($('sl').value);const tp=$('tp').value===''?null:Number($('tp').value);try{if(type==='MARKET'){await api('/api/trade/execute',{method:'POST',body:JSON.stringify({account_code:S.account.account_code,symbol:S.selected,side,volume,sl,tp})})}else{const entry=Number($('entry').value);await api('/api/trades/pending',{method:'POST',body:JSON.stringify({account_code:S.account.account_code,symbol:S.selected,side,volume,order_type:type,limit_price:entry,sl,tp})})}toast(`${side} ${type} order submitted`);await loadTrades();await refreshAccount()}catch(e){toast(e.message)}}
async function refreshAccount(){try{const d=await api('/api/accounts/'+S.account.id+'/summary');S.account={...S.account,...(d.account||d)};renderAccount()}catch(e){}}
function renderAccount(){const a=S.account||{};$('balance').textContent=money(a.balance_cents);$('equity').textContent=money(a.equity_cents);$('accountStatus').textContent=`${a.status||'ACTIVE'} · ${a.account_code||''}`;$('accountStatusMobile').textContent=`${a.status||'ACTIVE'} · ${a.account_code||''}`;if($('daily'))$('daily').textContent=money(a.daily_loss_cents||0);if($('dd'))$('dd').textContent=money(a.max_drawdown_cents||0)}
function setTab(tab){S.tab=tab;document.querySelectorAll('.right-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));renderTrades()}
function startLoop(){clearInterval(S.timer);S.timer=setInterval(async()=>{try{await loadPrices();await loadTrades();await refreshAccount()}catch(e){}},1000)}
document.addEventListener('DOMContentLoaded',()=>{document.querySelectorAll('.mobile-nav button').forEach(b=>b.onclick=()=>showPanel(b.dataset.view));document.querySelectorAll('.right-tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));$('search')?.addEventListener('input',renderQuotes);document.querySelectorAll('.tf').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tf').forEach(x=>x.classList.remove('active'));b.classList.add('active');loadTV()});$('buy').onclick=()=>place('BUY');$('sell').onclick=()=>place('SELL');$('orderType').onchange=()=>{$('pendingFields').classList.toggle('hidden',$('orderType').value==='MARKET')};$('refresh').onclick=async()=>{await loadPrices();await loadTrades();await refreshAccount()};$('logoutBtn').onclick=()=>{localStorage.removeItem('fundfxt_token');location.href='index.html'};boot()});