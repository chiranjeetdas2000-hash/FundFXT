/* ===== FUNDfxT TERMINAL UI FIXES ===== */
(function(){
  'use strict';
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pct=v=>v==null?'—':Number(v).toFixed(1)+'%';

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
    const initial=Number(a.initial_balance_cents||a.balance_cents||0)/100;
    const balance=Number(a.balance_cents||0)/100;
    const equity=Number(a.equity_cents||balance*100)/100;
    const p=a.account_profile||{};
    const r=p.rules||{};
    const dailyLimit=r.dailyDrawdownCents!=null?money(r.dailyDrawdownCents):'—';
    const maxLimit=r.maxDrawdownCents!=null?money(r.maxDrawdownCents):'—';
    const target=r.profitTargetCents!=null?money(r.profitTargetCents):'Not set';
    const targetProgress=r.targetProgressPercent;
    const consistencyLimit=r.consistencyLimitPercent;
    const consistencyAchieved=r.consistencyAchievedPercent;
    const consistencyProgress=consistencyLimit!=null&&consistencyLimit>0&&consistencyAchieved!=null?Math.min(100,(consistencyAchieved/consistencyLimit)*100):0;
    const dailyUsed=r.dailyDrawdownCents>0?Math.min(100,Math.max(0,(initial*100-equity*100)/r.dailyDrawdownCents*100)):0;
    const type=p.accountType||'—';
    const phase=p.phase||'—';
    const model=p.model||a.challenge_model||'—';
    return `<div class="account-rules"><h4>Account Details &amp; Rules</h4>
      <div class="rule"><span>Account type</span><b>${type}</b></div>
      <div class="rule"><span>Phase</span><b>${phase}</b></div>
      <div class="rule"><span>Model</span><b>${model}</b></div>
      <div class="rule"><span>Initial balance</span><b>${money(a.initial_balance_cents||a.balance_cents)}</b></div>
      <div class="rule"><span>Daily drawdown</span><b>${dailyLimit}${r.dailyDrawdownPercent!=null?' ('+Number(r.dailyDrawdownPercent).toFixed(1)+'%)':''}</b></div>
      <div class="rule"><span>Max drawdown</span><b>${maxLimit}${r.maxDrawdownPercent!=null?' ('+Number(r.maxDrawdownPercent).toFixed(1)+'%)':''}</b></div>
      <div class="rule"><span>Max trades / day</span><b>${r.maxTradesPerDay==null?'—':r.maxTradesPerDay}</b></div>
      <div class="rule"><span>Consistency limit</span><b>${pct(consistencyLimit)}</b></div>
      <div class="rule"><span>Consistency achieved</span><b>${pct(consistencyAchieved)}</b></div>
      <div class="rule-progress"><i style="width:${consistencyProgress}%"></i></div>
      <div class="rule"><span>Profit target</span><b>${target}</b></div>
      ${targetProgress==null?'':`<div class="rule"><span>Target progress</span><b>${pct(targetProgress)}</b></div><div class="rule-progress"><i style="width:${Math.min(100,Math.max(0,targetProgress))}%"></i></div>`}
      <div class="rule"><span>Current balance</span><b>${money(a.balance_cents)}</b></div>
      <div class="rule"><span>Current equity</span><b>${money(a.equity_cents)}</b></div>
      <div class="rule"><span>Drawdown used</span><b>${pct(dailyUsed)}</b></div>
      <div class="rule-progress rule-danger"><i style="width:${dailyUsed}%"></i></div>
    </div>`;
  }

  async function renderAccountPopover(){
    document.querySelector('.account-popover')?.remove();
    const a=await getAccount();
    localStorage.setItem('fundfxt_selected_account',a.account_code);
    const el=document.createElement('div');el.className='account-popover';
    el.innerHTML=`<div class="account-popover-head"><h3>Account Overview</h3><div class="account-id">${a.account_code||'—'}</div></div>
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