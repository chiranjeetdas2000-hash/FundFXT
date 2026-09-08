/* ===== FUNDfxT TERMINAL UI FIXES ===== */
(function(){
  'use strict';

  function money(c){
    return '$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function setActiveTradeTab(tab){
    document.querySelectorAll('.right-tab').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.tab===tab);
      btn.setAttribute('aria-selected', btn.dataset.tab===tab ? 'true' : 'false');
    });
  }

  function accountRules(account){
    const initial=Number(account?.initial_balance_cents||account?.balance_cents||0)/100;
    const balance=Number(account?.balance_cents||0)/100;
    const equity=Number(account?.equity_cents||0)/100;
    const targetPct=60;
    const target=initial*(targetPct/100);
    const profit=Math.max(0,balance-initial);
    const profitProgress=target>0?Math.min(100,(profit/target)*100):0;
    const dailyLimit=initial*0.30;
    const totalLimit=initial*0.50;
    const drawdown=Math.max(0,initial-equity);
    const dailyUsed=dailyLimit>0?Math.min(100,(drawdown/dailyLimit)*100):0;
    const totalUsed=totalLimit>0?Math.min(100,(drawdown/totalLimit)*100):0;
    return `
      <div class="account-rules">
        <h4>Account Rules &amp; Progress</h4>
        <div class="rule"><span>Profit target</span><b>$${target.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} · ${targetPct}%</b></div>
        <div class="rule"><span>Progress</span><b>${profitProgress.toFixed(1)}%</b></div>
        <div class="rule-progress"><i style="width:${profitProgress}%"></i></div>
        <div class="rule"><span>Daily drawdown limit</span><b>$${dailyLimit.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div>
        <div class="rule"><span>Drawdown used</span><b>${dailyUsed.toFixed(1)}%</b></div>
        <div class="rule-progress rule-danger"><i style="width:${dailyUsed}%"></i></div>
        <div class="rule"><span>Total drawdown limit</span><b>$${totalLimit.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div>
        <div class="rule"><span>Equity</span><b>${money(account?.equity_cents)}</b></div>
        <div class="rule"><span>Balance</span><b>${money(account?.balance_cents)}</b></div>
      </div>`;
  }

  function renderAccountPopover(){
    document.querySelector('.account-popover')?.remove();
    const account=window.__fundfxtTerminalAccount;
    if(!account)return;
    const el=document.createElement('div');
    el.className='account-popover';
    el.innerHTML=`
      <div class="account-popover-head"><h3>Account Overview</h3><div class="account-id">${account.account_code||'—'}</div></div>
      <div class="account-values">
        <div class="account-value"><span>Balance</span><b id="accountPopupBalance">${money(account.balance_cents)}</b></div>
        <div class="account-value"><span>Equity</span><b id="accountPopupEquity">${money(account.equity_cents)}</b></div>
      </div>
      ${accountRules(account)}
      <div class="modal-actions"><button class="danger" id="terminalLogout" type="button">Logout</button></div>`;
    document.body.appendChild(el);
    el.querySelector('#terminalLogout').onclick=function(){
      localStorage.removeItem('fundfxt_token');
      localStorage.removeItem('fundfxt_selected_account');
      location.href='/dashboard.html';
    };
  }

  function patchAccountState(){
    if(window.T?.account)window.__fundfxtTerminalAccount=window.T.account;
    const a=window.__fundfxtTerminalAccount;
    if(!a)return;
    const pop=document.querySelector('.account-popover');
    if(pop){
      const b=pop.querySelector('#accountPopupBalance'),e=pop.querySelector('#accountPopupEquity');
      if(b)b.textContent=money(a.balance_cents);
      if(e)e.textContent=money(a.equity_cents);
    }
  }

  function install(){
    const accountBtn=document.getElementById('accountMenuBtn');
    if(accountBtn){
      accountBtn.onclick=function(ev){
        ev.stopPropagation();
        patchAccountState();
        if(document.querySelector('.account-popover')) document.querySelector('.account-popover').remove();
        else renderAccountPopover();
      };
    }

    document.querySelectorAll('.right-tab').forEach(btn=>{
      btn.addEventListener('click',function(){setActiveTradeTab(this.dataset.tab);},true);
    });
    setActiveTradeTab(window.T?.tab||'OPEN');

    document.addEventListener('click',function(e){
      const pop=document.querySelector('.account-popover');
      if(pop && !pop.contains(e.target) && e.target!==accountBtn)pop.remove();
    });

    setInterval(patchAccountState,1000);
  }

  const wait=setInterval(function(){
    if(document.readyState==='loading')return;
    if(document.getElementById('accountMenuBtn')){clearInterval(wait);install();}
  },50);
})();