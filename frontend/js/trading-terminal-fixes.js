/* ===== FUNDfxT TERMINAL UI FIXES ===== */
(function(){
  'use strict';
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pct=v=>v==null?'—':Number(v).toFixed(1)+'%';

  function setActiveTradeTab(tab){
    document.querySelectorAll('.right-tab').forEach(btn=>{
      const active=btn.dataset.tab===tab;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-selected',active?'true':'false');
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

  function ruleBar(value, danger){
    if(value==null)return '<div class="rule-progress"><i style="width:0%"></i></div>';
    const w=Math.max(0,Math.min(100,Number(value)||0));
    return '<div class="rule-progress'+(danger?' rule-danger':'')+'"><i style="width:'+w+'%"></i></div>';
  }

  function accountRules(a){
    const p=a.account_profile||{};
    const r=p.rules||{};
    const balance=Number(a.balance_cents||0)/100;
    const equity=Number(a.equity_cents||0)/100;
    const initial=Number(p.initialBalance||a.initial_balance_cents||a.balance_cents||0)/100;
    const target=r.profitTargetCents==null?null:Number(r.profitTargetCents)/100;
    const targetProgress=r.targetProgressPercent;
    const dailyLimit=r.dailyDrawdownCents==null?null:Number(r.dailyDrawdownCents)/100;
    const dailyUsed=r.dailyDrawdownUsedCents==null?null:Number(r.dailyDrawdownUsedCents)/100;
    const dailyUsedPct=r.dailyDrawdownPercent==null||dailyLimit==null||dailyLimit<=0?null:Number(r.dailyDrawdownUsedCents||0)/Number(r.dailyDrawdownCents)*100;
    const maxLimit=r.maxDrawdownCents==null?null:Number(r.maxDrawdownCents)/100;
    const maxUsed=r.maxDrawdownUsedCents==null?null:Number(r.maxDrawdownUsedCents)/100;
    const maxUsedPct=maxLimit==null||maxLimit<=0?null:Number(r.maxDrawdownUsedCents||0)/Number(r.maxDrawdownCents)*100;
    const consistencyLimit=r.consistencyLimitPercent;
    const consistencyAchieved=r.consistencyAchievedPercent;
    const consistencyUsed=consistencyLimit==null||consistencyLimit<=0?null:Number(consistencyAchieved||0)/Number(consistencyLimit)*100;
    const isWarrior=!!p.isWarrior;
    const targetText=target==null?'Not configured':money(target*100);
    return `<div class="account-rules"><h4>Account Rules &amp; Progress</h4>
      <div class="rule"><span>Account type</span><b>${esc(p.accountType||'Challenge Account')}</b></div>
      <div class="rule"><span>Funding model</span><b>${esc(p.fundingModel||'—')}</b></div>
      <div class="rule"><span>Phase</span><b>${esc(p.phase||'—')}</b></div>
      <div class="rule"><span>Initial balance</span><b>${money(initial*100)}</b></div>
      <div class="rule"><span>Current balance</span><b>${money(a.balance_cents)}</b></div>
      <div class="rule"><span>Current equity</span><b>${money(a.equity_cents)}</b></div>

      <div class="rule-section-title">Profit target</div>
      <div class="rule"><span>Target</span><b>${targetText}</b></div>
      <div class="rule"><span>Progress achieved</span><b>${pct(targetProgress)}</b></div>
      ${ruleBar(targetProgress,false)}

      <div class="rule-section-title">Risk limits</div>
      <div class="rule"><span>Daily drawdown</span><b>${dailyLimit==null?'Not configured':money(dailyLimit*100)}</b></div>
      <div class="rule"><span>Daily drawdown used</span><b>${dailyUsed==null?'—':money(dailyUsed*100)+' ('+pct(dailyUsedPct)+')'}</b></div>
      ${ruleBar(dailyUsedPct,true)}
      <div class="rule"><span>Maximum drawdown</span><b>${maxLimit==null?'Not configured':money(maxLimit*100)}</b></div>
      <div class="rule"><span>Maximum drawdown used</span><b>${maxUsed==null?'—':money(maxUsed*100)+' ('+pct(maxUsedPct)+')'}</b></div>
      ${ruleBar(maxUsedPct,true)}

      <div class="rule-section-title">Trading rules</div>
      ${isWarrior?`<div class="rule"><span>Trades per day</span><b>${r.tradesToday??0} / ${r.maxTradesPerDay??3}</b></div>`:''}
      ${r.minLot!=null?`<div class="rule"><span>Minimum lot</span><b>${esc(r.minLot)}</b></div>`:''}
      ${r.maxLot!=null?`<div class="rule"><span>Maximum lot</span><b>${esc(r.maxLot)}</b></div>`:''}
      ${r.payoutPeriodDays!=null?`<div class="rule"><span>Payout period</span><b>${esc(r.payoutPeriodDays)} days</b></div>`:''}

      ${consistencyLimit!=null?`<div class="rule-section-title">Consistency</div>
      <div class="rule"><span>Consistency limit</span><b>${pct(consistencyLimit)}</b></div>
      <div class="rule"><span>Consistency achieved</span><b>${pct(consistencyAchieved)}</b></div>
      ${ruleBar(consistencyUsed,false)}
      <div class="rule"><span>Status</span><b>${r.consistencyMet===false?'Limit exceeded':'Within limit'}</b></div>`:''}
    </div>`;
  }

  async function renderAccountPopover(){
    document.querySelector('.account-popover')?.remove();
    const a=await getAccount();
    localStorage.setItem('fundfxt_selected_account',a.account_code);
    const el=document.createElement('div');el.className='account-popover';
    el.innerHTML=`<div class="account-popover-head"><h3>Account Overview</h3><div class="account-id">${esc(a.account_code||'—')}</div></div>
      <div class="account-values"><div class="account-value"><span>Balance</span><b id="accountPopupBalance">${money(a.balance_cents)}</b></div><div class="account-value"><span>Equity</span><b id="accountPopupEquity">${money(a.equity_cents)}</b></div></div>
      ${accountRules(a)}<div class="modal-actions"><button class="danger" id="terminalLogout" type="button">Logout</button></div>`;
    document.body.appendChild(el);
    el.querySelector('#terminalLogout').onclick=()=>{localStorage.removeItem('fundfxt_token');localStorage.removeItem('fundfxt_selected_account');location.href='/dashboard.html'};
  }

  function install(){
    const accountBtn=document.getElementById('accountMenuBtn');
    if(accountBtn)accountBtn.onclick=async ev=>{ev.stopPropagation();if(document.querySelector('.account-popover')){document.querySelector('.account-popover').remove();return}try{await renderAccountPopover()}catch(e){if(typeof feedback==='function')feedback(e.message)}};
    document.querySelectorAll('.right-tab').forEach(btn=>btn.addEventListener('click',()=>setActiveTradeTab(btn.dataset.tab),true));
    setActiveTradeTab('OPEN');
    document.addEventListener('click',e=>{const p=document.querySelector('.account-popover');if(p&&!p.contains(e.target)&&e.target!==accountBtn)p.remove()});
    setInterval(async()=>{const p=document.querySelector('.account-popover');if(!p)return;try{const a=await getAccount();p.querySelector('#accountPopupBalance').textContent=money(a.balance_cents);p.querySelector('#accountPopupEquity').textContent=money(a.equity_cents)}catch{}},1000);
  }
  const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('accountMenuBtn')){clearInterval(wait);install()}},50);
})();