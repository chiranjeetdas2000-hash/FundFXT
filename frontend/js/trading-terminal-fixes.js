/* ===== FUNDFXT TERMINAL DATA/UI FIXES ===== */
(function(){
'use strict';
const API='https://fundfxt.onrender.com';
const token=()=>localStorage.getItem('fundfxt_token')||'';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const money=c=>'$'+(n(c)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=v=>v==null?'—':n(v).toFixed(1)+'%';
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function setActiveTradeTab(tab){document.querySelectorAll('.right-tab').forEach(btn=>{const on=btn.dataset.tab===tab;btn.classList.toggle('active',on);btn.setAttribute('aria-selected',on?'true':'false')})}
async function api(path){const r=await fetch(API+path,{headers:{Authorization:'Bearer '+token()}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Unable to load account');return d}
async function getAccount(){const d=await api('/api/accounts');const list=d.accounts||d;if(!Array.isArray(list)||!list.length)throw Error('No trading account available');const q=new URLSearchParams(location.search),wanted=q.get('account_code')||q.get('account')||localStorage.getItem('fundfxt_selected_account');return list.find(a=>String(a.account_code)===String(wanted))||list[0]}
async function getTrades(a){try{const d=await api('/api/trade/get?account_code='+encodeURIComponent(a.account_code));return Array.isArray(d.trades)?d.trades:[]}catch{return[]}}
function accountRules(a){
  const p=a.account_profile||{},r=p.rules||{};
  const initial=n(a.initial_balance_cents||a.balance_cents),balance=n(a.balance_cents),equity=n(a.equity_cents||a.balance_cents);
  const isWarrior=!!p.isWarrior;
  const target=r.profitTargetCents;
  const targetProgress=r.targetProgressPercent;
  const consistencyLimit=isWarrior?30:r.consistencyLimitPercent;
  const consistencyAchieved=r.consistencyAchievedPercent;
  const maxTrades=r.maxTradesPerDay;
  const tradesToday=r.tradesToday;
  const dailyPct=r.dailyDrawdownPercent;
  const dailyLimit=r.dailyDrawdownCents;
  const dailyUsed=r.dailyDrawdownUsedCents;
  const maxPct=r.dailyDrawdownPercent==null? (r.maxDrawdownPercent??r.maximumDrawdownPercent) : (r.maxDrawdownPercent??r.maximumDrawdownPercent);
  const maxLimit=r.maxDrawdownCents;
  const maxUsed=r.maxDrawdownUsedCents;
  const type=p.accountType||'Trading Account';
  const funding=p.fundingModel||'—';
  const phase=p.phase==null?'—':String(p.phase).toLowerCase().includes('phase')?p.phase:'Phase '+p.phase;
  const consistencyOk=consistencyLimit==null||consistencyAchieved==null||consistencyAchieved<=consistencyLimit;
  return `<div class="account-rules account-rules-detailed"><h4>Account Details &amp; Rules</h4>
    <div class="account-rule-model"><b>${esc(type)}</b><span>${esc(funding)}</span></div>
    <div class="rule-grid">
      <div class="rule"><span>Account type</span><b>${esc(type)}</b></div>
      <div class="rule"><span>Funding model</span><b>${esc(funding)}</b></div>
      <div class="rule"><span>Phase</span><b>${esc(phase)}</b></div>
      <div class="rule"><span>Challenge model</span><b>${esc(p.model||a.challenge_model||'—')}</b></div>
      <div class="rule"><span>Direct funded</span><b>${p.isDirectFunded?'Yes':'No'}</b></div>
      ${target!=null?`<div class="rule"><span>Profit target</span><b>${money(target)}</b></div>`:`<div class="rule"><span>Profit target</span><b>Not configured</b></div>`}
      <div class="rule"><span>Profit achieved</span><b>${money(Math.max(0,n(r.profitAchievedCents)))}</b></div>
    </div>
    ${target!=null?`<div class="rule-label"><span>Profit target progress</span><b>${pct(targetProgress)}</b></div><div class="rule-progress"><i style="width:${Math.max(0,Math.min(100,n(targetProgress)))}%"></i></div>`:`<div class="rule-note">No profit target is configured for this account model. Nothing is estimated or invented.</div>`}
    ${dailyPct!=null?`<div class="rule-label"><span>Daily drawdown limit</span><b>${dailyPct}% · ${money(dailyLimit)}</b></div><div class="rule-label"><span>Daily drawdown used</span><b>${money(dailyUsed)} (${pct(dailyLimit?Math.min(100,dailyUsed/dailyLimit*100):0)})</b></div><div class="rule-progress rule-danger"><i style="width:${dailyLimit?Math.min(100,dailyUsed/dailyLimit*100):0}%"></i></div>`:''}
    ${maxPct!=null?`<div class="rule-label"><span>Maximum drawdown</span><b>${maxPct}% · ${money(maxLimit)}</b></div><div class="rule-label"><span>Maximum drawdown used</span><b>${money(maxUsed)} (${pct(maxLimit?Math.min(100,maxUsed/maxLimit*100):0)})</b></div><div class="rule-progress rule-danger"><i style="width:${maxLimit?Math.min(100,maxUsed/maxLimit*100):0}%"></i></div>`:''}
    ${maxTrades!=null?`<div class="rule-label"><span>Trades today</span><b>${tradesToday}/${maxTrades}</b></div><div class="rule-progress"><i style="width:${maxTrades?Math.min(100,tradesToday/maxTrades*100):0}%"></i></div>`:''}
    ${consistencyLimit!=null?`<div class="rule-label"><span>Consistency rule</span><b>≤ ${pct(consistencyLimit)}</b></div><div class="rule"><span>Consistency achieved</span><b>${pct(consistencyAchieved)}${consistencyOk?' ✓':' ⚠'}</b></div>`:''}
    ${isWarrior?'<div class="rule-note">Warrior rules: maximum 3 trades per day and 30% consistency limit.</div>':''}
    <div class="rule-grid"><div class="rule"><span>Current balance</span><b>${money(balance)}</b></div><div class="rule"><span>Current equity</span><b>${money(equity)}</b></div><div class="rule"><span>Initial balance</span><b>${money(initial)}</b></div></div>
    <div class="rule-note">Account classification and limits come from the backend account/challenge data. The terminal no longer hard-codes a $3,000 profit target.</div>
  </div>`;
}
async function renderAccountPopover(){
  document.querySelector('.account-popover')?.remove();
  const a=await getAccount(),trades=await getTrades(a);
  localStorage.setItem('fundfxt_selected_account',a.account_code);
  const el=document.createElement('div');el.className='account-popover';
  el.innerHTML=`<div class="account-popover-head"><div><h3>Account Overview</h3><div class="account-id">${esc(a.account_code||'—')}</div></div><button class="account-popover-close" id="closeAccountPopoverTop" type="button" aria-label="Close">×</button></div><div class="account-values"><div class="account-value"><span>Balance</span><b id="accountPopupBalance">${money(a.balance_cents)}</b></div><div class="account-value"><span>Equity</span><b id="accountPopupEquity">${money(a.equity_cents)}</b></div></div><div id="accountRulesMount">${accountRules(a,trades)}</div><div class="modal-actions"><button class="danger" id="terminalLogout" type="button">Logout</button></div>`;
  document.body.appendChild(el);
  el.querySelector('#closeAccountPopoverTop').onclick=()=>el.remove();
  el.querySelector('#terminalLogout').onclick=()=>{localStorage.removeItem('fundfxt_token');localStorage.removeItem('fundfxt_selected_account');location.href='/dashboard.html'};
}
async function syncFavorites(){try{const a=await getAccount();const fav=window.T&&Array.isArray(window.T.favorites)?window.T.favorites:JSON.parse(localStorage.getItem('fundfxt_favorite_pairs')||'[]');await fetch(API+'/api/favorite-pairs',{method:'PUT',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({account_code:a.account_code,favorites:fav})})}catch{}}
async function restoreFavorites(){try{const a=await getAccount(),d=await api('/api/favorite-pairs?account_code='+encodeURIComponent(a.account_code));if(Array.isArray(d.favorites)&&d.favorites.length){localStorage.setItem('fundfxt_favorite_pairs',JSON.stringify(d.favorites));if(window.T){window.T.favorites=d.favorites;if(typeof window.renderPairs==='function')window.renderPairs()}}}catch{}}
function syncTop(a){const b=document.getElementById('balance'),e=document.getElementById('equity');if(b)b.textContent=money(a.balance_cents);if(e)e.textContent=money(a.equity_cents)}
function install(){
  const accountBtn=document.getElementById('accountMenuBtn');
  if(accountBtn)accountBtn.onclick=async ev=>{ev.stopPropagation();if(document.querySelector('.account-popover'))document.querySelector('.account-popover').remove();else try{await renderAccountPopover()}catch(e){if(typeof feedback==='function')feedback(e.message)}};
  document.querySelectorAll('.right-tab').forEach(btn=>btn.addEventListener('click',()=>setActiveTradeTab(btn.dataset.tab),true));
  setActiveTradeTab('OPEN');
  document.addEventListener('click',e=>{const p=document.querySelector('.account-popover');if(p&&!p.contains(e.target)&&e.target!==accountBtn)p.remove()});
  document.addEventListener('click',e=>{if(e.target.closest('[data-fav]'))setTimeout(syncFavorites,200)},true);
  restoreFavorites();
  setInterval(async()=>{try{const a=await getAccount();syncTop(a);const p=document.querySelector('.account-popover');if(!p)return;const b=p.querySelector('#accountPopupBalance'),e=p.querySelector('#accountPopupEquity');if(b)b.textContent=money(a.balance_cents);if(e)e.textContent=money(a.equity_cents);p.querySelector('#accountRulesMount').innerHTML=accountRules(a,await getTrades(a))}catch{}},1000);
}
const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('accountMenuBtn')&&typeof T!=='undefined'){clearInterval(wait);install()}},50);
})();