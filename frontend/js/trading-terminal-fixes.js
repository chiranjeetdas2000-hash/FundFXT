/* ===== FUNDFXT TERMINAL FIXES — SINGLE ACCOUNT LEDGER ===== */
(function(){
  'use strict';
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const money=c=>'$'+(num(c)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pct=v=>v==null||!Number.isFinite(Number(v))?'—':num(v).toFixed(1)+'%';
  const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  async function rawJson(path,opt={}){
    const r=await fetch(API+path,{...opt,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json',...(opt.headers||{})}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(d.error||'Request failed');
    return d;
  }

  function selectedAccount(list){
    const q=new URLSearchParams(location.search);
    const wanted=q.get('account_code')||q.get('account')||localStorage.getItem('fundfxt_selected_account');
    return list.find(a=>String(a.account_code)===String(wanted))||list[0]||null;
  }

  async function tradesFor(account){
    if(!account)return [];
    try{const d=await rawJson('/api/trade/get?account_code='+encodeURIComponent(account.account_code));return Array.isArray(d.trades)?d.trades:[]}catch{return []}
  }

  function ledger(account,trades){
    const initial=Math.round(num(account.initial_balance_cents||account.balance_cents));
    const closed=trades.filter(t=>String(t.status).toUpperCase()==='CLOSED');
    const open=trades.filter(t=>String(t.status).toUpperCase()==='OPEN');
    const realized=Math.round(closed.reduce((s,t)=>s+num(t.realized_profit_cents),0));
    const floating=Math.round(open.reduce((s,t)=>s+num(t.floating_profit_cents),0));
    return {initial,balance:initial+realized,equity:initial+realized+floating,realized,floating,openCount:open.length};
  }

  const originalFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const response=await originalFetch(input,init);
    if(!url.includes('/api/accounts'))return response;
    try{
      const payload=await response.clone().json();
      const list=Array.isArray(payload.accounts)?payload.accounts:[];
      const account=selectedAccount(list);
      if(!account)return response;
      const trades=await tradesFor(account);
      const x=ledger(account,trades);
      const normalized=list.map(a=>String(a.account_code)===String(account.account_code)?{...a,balance_cents:x.balance,equity_cents:x.equity}:a);
      return new Response(JSON.stringify({...payload,accounts:normalized}),{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch{return response}
  };

  function accountRules(a,trades){
    const p=a.account_profile||{},r=p.rules||{},x=ledger(a,trades);
    const warrior=!!p.isWarrior;
    const type=p.accountType||'Trading Account';
    const funding=p.fundingModel||'—';
    const phase=p.phase||'—';
    const model=p.model||a.challenge_model||'—';
    const dailyLimit=r.dailyDrawdownCents!=null?num(r.dailyDrawdownCents):null;
    const dailyUsed=Math.max(0,Math.round(num(a.day_start_balance_cents||x.initial)-x.balance));
    const maxLimit=r.maxDrawdownCents!=null?num(r.maxDrawdownCents):null;
    const maxUsed=Math.max(0,x.initial-x.equity);
    const dailyUsedPct=dailyLimit>0?Math.min(100,dailyUsed/dailyLimit*100):0;
    const maxUsedPct=maxLimit>0?Math.min(100,maxUsed/maxLimit*100):0;
    const maxTrades=warrior?3:(r.maxTradesPerDay!=null?num(r.maxTradesPerDay):null);
    const tradesToday=r.tradesToday!=null?num(r.tradesToday):trades.filter(t=>String(t.entry_time||t.exit_time||t.created_at||'').slice(0,10)===new Date().toISOString().slice(0,10)).length;
    const consistencyLimit=r.consistencyLimitPercent!=null?num(r.consistencyLimitPercent):null;
    const consistency=r.consistencyAchievedPercent!=null?num(r.consistencyAchievedPercent):0;
    // Only trust a profit target when the backend explicitly marks it as configured data.
    const verifiedTarget=r.profitTargetSource==='challenge_config'&&r.profitTargetCents!=null?num(r.profitTargetCents):null;
    const targetProgress=verifiedTarget&&verifiedTarget>0?Math.max(0,Math.min(100,(x.balance-x.initial)/verifiedTarget*100)):null;
    const rule=(label,value)=>`<div class="rule"><span>${label}</span><b>${value}</b></div>`;
    const bar=(label,value,danger=false)=>{const v=Math.max(0,Math.min(100,num(value)));return `<div class="rule-label"><span>${label}</span><b>${pct(value)}</b></div><div class="rule-progress${danger?' rule-danger':''}"><i style="width:${v}%"></i></div>`};
    return `<div class="account-rules account-rules-detailed">
      <div class="account-rule-model"><b>${esc(type)}</b><span>${esc(funding)} · ${esc(phase)}</span></div>
      <div class="rule-grid">
        ${rule('Account type',esc(type))}${rule('Funding model',esc(funding))}${rule('Phase / stage',esc(phase))}${rule('Challenge model',esc(model))}${rule('Direct funded',p.isDirectFunded?'Yes':'No')}
        ${rule('Account size',money(x.initial))}${rule('Initial balance',money(x.initial))}${rule('Current balance',`<span id="accountRuleBalance">${money(x.balance)}</span>`)}${rule('Current equity',`<span id="accountRuleEquity">${money(x.equity)}</span>`)}
        ${rule('Realized P/L',`${x.realized>=0?'+':''}${money(x.realized)}`)}${rule('Floating P/L',`${x.floating>=0?'+':''}${money(x.floating)}`)}
        ${rule('Profit target',verifiedTarget==null?'Not configured':money(verifiedTarget))}
        ${dailyLimit!=null?rule('Daily drawdown limit',`${r.dailyDrawdownPercent!=null?num(r.dailyDrawdownPercent)+'% · ':''}${money(dailyLimit)}`):''}
        ${maxLimit!=null?rule('Maximum drawdown limit',`${r.maximumDrawdownPercent!=null?num(r.maximumDrawdownPercent)+'% · ':''}${money(maxLimit)}`):''}
        ${maxTrades!=null?rule('Trades today',`${tradesToday} / ${maxTrades}`):''}
        ${rule('Open positions',`${x.openCount} / ${r.maxOpenPositions!=null?num(r.maxOpenPositions):1}`)}
        ${consistencyLimit!=null?rule('Consistency limit',`≤ ${pct(consistencyLimit)}`)+rule('Consistency achieved',pct(consistency)):''}
      </div>
      ${verifiedTarget!=null?bar('Profit target progress',targetProgress):'<div class="rule-note"><b>Profit target:</b> Not displayed because the backend has not supplied a verified target for this account. No target is estimated.</div>'}
      ${dailyLimit!=null?bar('Daily drawdown used',dailyUsedPct,true):''}
      ${maxLimit!=null?bar('Maximum drawdown used',maxUsedPct,true):''}
      ${maxTrades!=null?bar('Daily trades used',maxTrades?tradesToday/maxTrades*100:0,true):''}
      ${consistencyLimit!=null?bar('Consistency usage',consistencyLimit?consistency/consistencyLimit*100:0,true):''}
      ${warrior?'<div class="rule-note"><b>Warrior rules:</b> maximum 3 trades per day · consistency limit is shown from backend configuration · maximum open positions is shown above.</div>':''}
    </div>`;
  }

  async function getAccount(){
    const d=await rawJson('/api/accounts');
    const list=d.accounts||[];const a=selectedAccount(list);
    if(!a)throw Error('No trading account available');
    const t=await tradesFor(a);const x=ledger(a,t);
    return {...a,balance_cents:x.balance,equity_cents:x.equity,__trades:t};
  }

  async function renderAccountPopover(){
    document.querySelector('.account-popover')?.remove();
    const a=await getAccount(),trades=a.__trades||[];
    localStorage.setItem('fundfxt_selected_account',a.account_code);
    const el=document.createElement('div');el.className='account-popover';
    el.innerHTML=`<div class="account-popover-head"><div><h3>Account Overview</h3><div class="account-id">${esc(a.account_code)}</div></div><button class="account-popover-close" type="button" aria-label="Close">×</button></div><div class="account-values"><div class="account-value"><span>Balance</span><b id="accountPopupBalance">${money(a.balance_cents)}</b></div><div class="account-value"><span>Equity</span><b id="accountPopupEquity">${money(a.equity_cents)}</b></div></div>${accountRules(a,trades)}`;
    document.body.appendChild(el);
    el.querySelector('.account-popover-close').onclick=()=>el.remove();
  }

  async function refreshAccountPopover(){const p=document.querySelector('.account-popover');if(!p)return;try{const a=await getAccount(),trades=a.__trades||[];const b=p.querySelector('#accountPopupBalance'),e=p.querySelector('#accountPopupEquity');if(b)b.textContent=money(a.balance_cents);if(e)e.textContent=money(a.equity_cents);const mount=p.querySelector('.account-rules');if(mount)mount.outerHTML=accountRules(a,trades);}catch{}}

  function setActiveTradeTab(tab){document.querySelectorAll('.right-tab').forEach(btn=>{const on=btn.dataset.tab===tab;btn.classList.toggle('active',on);btn.setAttribute('aria-selected',on?'true':'false')});}

  function install(){
    const btn=document.getElementById('accountMenuBtn');
    if(btn)btn.onclick=async e=>{e.stopPropagation();if(document.querySelector('.account-popover'))document.querySelector('.account-popover').remove();else try{await renderAccountPopover()}catch(err){if(typeof feedback==='function')feedback(err.message)}};
    document.querySelectorAll('.right-tab').forEach(btn=>btn.addEventListener('click',()=>setActiveTradeTab(btn.dataset.tab),true));
    setActiveTradeTab('OPEN');
    document.addEventListener('click',e=>{const p=document.querySelector('.account-popover');if(p&&!p.contains(e.target)&&e.target!==btn)p.remove()});
    setInterval(refreshAccountPopover,1500);
  }
  const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('accountMenuBtn')){clearInterval(wait);install()}},50);
})();