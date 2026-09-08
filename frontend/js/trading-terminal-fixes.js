/* ===== FUNDfxT TERMINAL UI FIXES ===== */
(function(){
  'use strict';
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pct=v=>v==null?'—':Number(v).toFixed(1)+'%';
  const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function setActiveTradeTab(tab){
    document.querySelectorAll('.right-tab').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.tab===tab);
      btn.setAttribute('aria-selected',btn.dataset.tab===tab?'true':'false');
    });
  }

  async function getAccount(){
    const r=await fetch(API+'/api/accounts',{headers:{Authorization:'Bearer '+token()}});
    const d=await r.json();
    if(!r.ok)throw Error(d.error||'Unable to load account');
    const list=d.accounts||d;
    if(!Array.isArray(list)||!list.length)throw Error('No trading account available');
    const wanted=new URLSearchParams(location.search).get('account_code')||new URLSearchParams(location.search).get('account')||localStorage.getItem('fundfxt_selected_account');
    return list.find(a=>String(a.account_code)===String(wanted))||list[0];
  }

  function accountRules(a){
    const p=a.account_profile||{};
    const r=p.rules||{};
    const target=r.profitTargetCents!=null?money(r.profitTargetCents):'$400.00';
    const targetProgress=r.targetProgressPercent==null?0:Number(r.targetProgressPercent);
    const consistencyLimit=r.consistencyLimitPercent;
    const consistencyAchieved=r.consistencyAchievedPercent;
    const consistencyProgress=consistencyLimit!=null&&consistencyLimit>0&&consistencyAchieved!=null?Math.min(100,(consistencyAchieved/consistencyLimit)*100):0;
    const tradesToday=Number(r.tradesToday||0);
    const maxTrades=Number(r.maxTradesPerDay||3);
    const tradeProgress=Math.min(100,(tradesToday/Math.max(1,maxTrades))*100);
    const openPositions=Number(r.openPositions||0);
    const maxOpen=Number(r.maxOpenPositions||1);
    const type=p.accountType||(p.isWarrior?'Warrior':p.isDirectFunded?'Direct Funded':'Challenge');
    const phase=p.phase||'—';
    const model=p.model||a.challenge_model||'—';
    const direct=p.isDirectFunded?'Yes':'No';
    return `<div class="account-rules"><div class="rules-title-row"><h4>Account Details &amp; Rules</h4><button class="account-popover-close" id="closeAccountPopover" type="button" aria-label="Close account overview">×</button></div>
      <div class="rule"><span>Account type</span><b>${esc(type)}</b></div>
      <div class="rule"><span>Phase</span><b>${esc(phase)}</b></div>
      <div class="rule"><span>Model</span><b>${esc(model)}</b></div>
      <div class="rule"><span>Direct funded</span><b>${direct}</b></div>
      <div class="rule"><span>Initial balance</span><b>${money(a.initial_balance_cents||a.balance_cents)}</b></div>
      <div class="rule"><span>Positions allowed at once</span><b>${maxOpen}</b></div>
      <div class="rule"><span>Positions open now</span><b>${openPositions} / ${maxOpen}</b></div>
      <div class="rule"><span>Trades today</span><b>${tradesToday} / ${maxTrades}</b></div>
      <div class="rule-progress"><i id="tradeDayProgress" style="width:${tradeProgress}%"></i></div>
      <div class="rule"><span>Consistency limit</span><b>${pct(consistencyLimit)}</b></div>
      <div class="rule"><span>Consistency achieved</span><b>${pct(consistencyAchieved)}</b></div>
      <div class="rule-progress"><i id="consistencyProgress" style="width:${consistencyProgress}%"></i></div>
      <div class="rule"><span>Daily drawdown</span><b>${r.dailyDrawdownCents!=null?money(r.dailyDrawdownCents):'—'}${r.dailyDrawdownPercent!=null?' ('+Number(r.dailyDrawdownPercent).toFixed(1)+'%)':''}</b></div>
      <div class="rule"><span>Max drawdown</span><b>${r.maxDrawdownCents!=null?money(r.maxDrawdownCents):'—'}${r.maxDrawdownPercent!=null?' ('+Number(r.maxDrawdownPercent).toFixed(1)+'%)':''}</b></div>
      <div class="rule"><span>Profit target</span><b>${target}</b></div>
      <div class="rule"><span>Profit achieved</span><b id="accountPopupProfitAchieved">${r.profitAchievedCents!=null?money(r.profitAchievedCents):money(Math.max(0,Number(a.balance_cents||0)-Number(a.initial_balance_cents||a.balance_cents||0)))}</b></div>
      <div class="rule"><span>Target progress</span><b id="accountPopupTargetProgress">${pct(targetProgress)}</b></div>
      <div class="rule-progress"><i id="targetProgressBar" style="width:${targetProgress}%"></i></div>
      <div class="rule"><span>Current balance</span><b id="accountPopupRuleBalance">${money(a.balance_cents)}</b></div>
      <div class="rule"><span>Current equity</span><b id="accountPopupRuleEquity">${money(a.equity_cents)}</b></div>
    </div>`;
  }

  async function renderAccountPopover(){
    document.querySelector('.account-popover')?.remove();
    const a=await getAccount();
    localStorage.setItem('fundfxt_selected_account',a.account_code);
    const el=document.createElement('div');el.className='account-popover';
    el.innerHTML=`<div class="account-popover-head"><div><h3>Account Overview</h3><div class="account-id">${esc(a.account_code||'—')}</div></div><button class="account-popover-close" id="closeAccountPopoverTop" type="button" aria-label="Close account overview">×</button></div>
      <div class="account-values"><div class="account-value"><span>Balance</span><b id="accountPopupBalance">${money(a.balance_cents)}</b></div><div class="account-value"><span>Equity</span><b id="accountPopupEquity">${money(a.equity_cents)}</b></div></div>
      ${accountRules(a)}<div class="modal-actions"><button class="danger" id="terminalLogout" type="button">Logout</button></div>`;
    document.body.appendChild(el);
    const close=()=>el.remove();
    el.querySelector('#closeAccountPopoverTop').onclick=close;
    el.querySelector('#closeAccountPopover').onclick=close;
    el.querySelector('#terminalLogout').onclick=()=>{localStorage.removeItem('fundfxt_token');localStorage.removeItem('fundfxt_selected_account');location.href='/dashboard.html'};
  }

  function refreshAccountPopover(a){
    const r=(a.account_profile&&a.account_profile.rules)||{};
    const set=(id,v)=>{const x=document.getElementById(id);if(x)x.textContent=v};
    set('accountPopupBalance',money(a.balance_cents));
    set('accountPopupEquity',money(a.equity_cents));
    set('accountPopupRuleBalance',money(a.balance_cents));
    set('accountPopupRuleEquity',money(a.equity_cents));
    set('accountPopupProfitAchieved',r.profitAchievedCents!=null?money(r.profitAchievedCents):money(Math.max(0,Number(a.balance_cents||0)-Number(a.initial_balance_cents||a.balance_cents||0))));
    set('accountPopupTargetProgress',pct(r.targetProgressPercent||0));
    const tb=document.getElementById('targetProgressBar');if(tb)tb.style.width=Math.min(100,Math.max(0,Number(r.targetProgressPercent||0)))+'%';
    const td=document.getElementById('tradeDayProgress');if(td)td.style.width=Math.min(100,(Number(r.tradesToday||0)/Math.max(1,Number(r.maxTradesPerDay||3)))*100)+'%';
    const cp=document.getElementById('consistencyProgress');if(cp)cp.style.width=(r.consistencyLimitPercent>0?Math.min(100,(Number(r.consistencyAchievedPercent||0)/Number(r.consistencyLimitPercent))*100):0)+'%';
  }

  function install(){
    const accountBtn=document.getElementById('accountMenuBtn');
    if(accountBtn)accountBtn.onclick=async ev=>{ev.stopPropagation();if(document.querySelector('.account-popover')){document.querySelector('.account-popover').remove();return}try{await renderAccountPopover()}catch(e){if(typeof feedback==='function')feedback(e.message)}};
    document.querySelectorAll('.right-tab').forEach(btn=>btn.addEventListener('click',()=>setActiveTradeTab(btn.dataset.tab),true));
    setActiveTradeTab('OPEN');
    document.addEventListener('click',e=>{const p=document.querySelector('.account-popover');if(p&&!p.contains(e.target)&&e.target!==accountBtn)p.remove()});
    setInterval(async()=>{const p=document.querySelector('.account-popover');if(!p)return;try{const a=await getAccount();refreshAccountPopover(a)}catch{}},1000);
  }
  const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('accountMenuBtn')){clearInterval(wait);install()}},50);
})();