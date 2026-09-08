/* ===== FUNDfxT TERMINAL UI FIXES ===== */
(function(){
  'use strict';
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

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
    const equity=Number(a.equity_cents||0)/100;
    const target=initial*.60;
    const profit=Math.max(0,balance-initial);
    const progress=target>0?Math.min(100,profit/target*100):0;
    const dailyLimit=initial*.30;
    const totalLimit=initial*.50;
    const drawdown=Math.max(0,initial-equity);
    const dailyUsed=dailyLimit>0?Math.min(100,drawdown/dailyLimit*100):0;
    const totalUsed=totalLimit>0?Math.min(100,drawdown/totalLimit*100):0;
    return `<div class="account-rules"><h4>Account Rules &amp; Progress</h4>
      <div class="rule"><span>Profit target</span><b>${money(target*100)}</b></div>
      <div class="rule"><span>Target progress</span><b>${progress.toFixed(1)}%</b></div>
      <div class="rule-progress"><i style="width:${progress}%"></i></div>
      <div class="rule"><span>Daily drawdown limit</span><b>${money(dailyLimit*100)}</b></div>
      <div class="rule"><span>Daily drawdown used</span><b>${dailyUsed.toFixed(1)}%</b></div>
      <div class="rule-progress rule-danger"><i style="width:${dailyUsed}%"></i></div>
      <div class="rule"><span>Total drawdown limit</span><b>${money(totalLimit*100)}</b></div>
      <div class="rule"><span>Total drawdown used</span><b>${totalUsed.toFixed(1)}%</b></div>
      <div class="rule"><span>Current balance</span><b>${money(a.balance_cents)}</b></div>
      <div class="rule"><span>Current equity</span><b>${money(a.equity_cents)}</b></div>
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