'use strict';

// FundFXT account menu: compact account icon, rules/compliance, profile, settings and logout.
(function(){
  const API='https://fundfxt.onrender.com';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const requested=()=>new URLSearchParams(location.search).get('account')||localStorage.getItem('fundfxt_selected_account')||'';
  const accountCode=()=>requested()||$('accountCode')?.textContent?.trim()||'';

  function inject(){
    const right=document.querySelector('.top-right');
    if(!right||$('fxAccountBtn'))return;
    const b=document.createElement('button');
    b.id='fxAccountBtn';b.className='icon-btn fx-account-btn';b.type='button';b.title='Account';b.setAttribute('aria-label','Account');
    b.innerHTML='<i data-lucide="user-round"></i>';
    right.appendChild(b);
    const menu=document.createElement('div');menu.id='fxAccountMenu';menu.className='fx-account-menu';menu.hidden=true;
    menu.innerHTML=`
      <div class="fx-menu-head"><div><strong>Trading Account</strong><small id="fxMenuStatus">Loading…</small></div><button type="button" class="fx-menu-close" id="fxMenuClose">×</button></div>
      <div class="fx-menu-section"><span>Account ID</span><b id="fxMenuAccount">—</b></div>
      <div class="fx-menu-section"><strong>Account Rules &amp; Compliance</strong>
        <div class="fx-rule"><span>Daily Drawdown</span><b id="fxDailyDD">—</b></div>
        <div class="fx-rule"><span>Max Drawdown</span><b id="fxMaxDD">—</b></div>
        <div class="fx-rule"><span>Max Trades</span><b id="fxMaxTrades">3</b></div>
        <div class="fx-rule"><span>Consistency</span><b id="fxConsistency">—</b></div>
      </div>
      <div class="fx-menu-section"><strong>Profile</strong>
        <div class="fx-profile"><span>Account</span><b id="fxProfileAccount">—</b></div>
        <div class="fx-profile"><span>Status</span><b id="fxProfileStatus">—</b></div>
        <div class="fx-profile"><span>Balance</span><b id="fxProfileBalance">—</b></div>
        <div class="fx-profile"><span>Equity</span><b id="fxProfileEquity">—</b></div>
      </div>
      <button type="button" class="fx-menu-action" id="fxSettings"><i data-lucide="settings"></i> Settings</button>
      <button type="button" class="fx-menu-action danger" id="fxLogout"><i data-lucide="log-out"></i> Logout</button>`;
    document.body.appendChild(menu);
    b.onclick=()=>{menu.hidden=!menu.hidden; if(!menu.hidden)render()};
    $('fxMenuClose').onclick=()=>menu.hidden=true;
    $('fxLogout').onclick=()=>{localStorage.removeItem('fundfxt_token');localStorage.removeItem('fundfxt_selected_account');location.href='/login.html'};
    $('fxSettings').onclick=()=>window.toast?window.toast('Settings panel will be connected next.'):alert('Settings panel will be connected next.');
    document.addEventListener('click',e=>{if(!menu.contains(e.target)&&e.target!==b&&!b.contains(e.target))menu.hidden=true});
    if(window.lucide?.createIcons)window.lucide.createIcons();
  }

  async function getJSON(url){
    const r=await fetch(url,{headers:{Authorization:'Bearer '+token()}});if(!r.ok)throw Error('HTTP '+r.status);return r.json();
  }
  function pct(v){return Number.isFinite(Number(v))?Number(v).toFixed(2)+'%':'—'}
  function money(v){return Number.isFinite(Number(v))?'$'+(Number(v)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}

  async function render(){
    const code=accountCode(); if(!code)return;
    try{
      const [ad,td]=await Promise.all([getJSON(API+'/api/accounts'),getJSON(API+'/api/trade/get?account_code='+encodeURIComponent(code))]);
      const list=Array.isArray(ad)?ad:(ad.accounts||[]);const a=list.find(x=>x.account_code===code)||list[0]||{};
      const trades=Array.isArray(td?.trades)?td.trades:[];
      const profitable=trades.filter(t=>String(t.status||'').toUpperCase()!=='OPEN'&&Number(t.profit_cents??t.realized_profit_cents??t.pnl_cents)>0);
      const total=profitable.reduce((s,t)=>s+Number(t.profit_cents??t.realized_profit_cents??t.pnl_cents),0);
      const largest=profitable.reduce((m,t)=>Math.max(m,Number(t.profit_cents??t.realized_profit_cents??t.pnl_cents)),0);
      const consistency=total>0?largest/total*100:NaN;
      const status=String(a.status||'ACTIVE').toUpperCase();
      $('fxMenuAccount').textContent=a.account_code||code;$('fxMenuStatus').textContent=status+' · Selected account';
      $('fxProfileAccount').textContent=a.account_code||code;$('fxProfileStatus').textContent=status;$('fxProfileBalance').textContent=money(a.balance_cents);$('fxProfileEquity').textContent=money(a.equity_cents);
      $('fxDailyDD').textContent=a.daily_drawdown_percent!=null?pct(a.daily_drawdown_percent):a.daily_drawdown!=null?pct(a.daily_drawdown):'—';
      $('fxMaxDD').textContent=a.max_drawdown_percent!=null?pct(a.max_drawdown_percent):a.max_drawdown!=null?pct(a.max_drawdown):'—';
      $('fxMaxTrades').textContent=a.max_trades!=null?String(a.max_trades):'3';
      $('fxConsistency').textContent=Number.isFinite(consistency)?pct(consistency)+' / 35% limit':'— / 35% limit';
    }catch(e){$('fxMenuStatus').textContent='Account data unavailable';console.warn('FundFXT account menu sync failed',e)}
  }

  function hideLegacy(){document.querySelectorAll('.account-panel').forEach(el=>el.remove());document.querySelectorAll('[data-mobile-account],#mobileAccount,.mobile-account').forEach(el=>el.remove())}

  // Prevent optional UI cleanup from breaking the terminal's live refresh loop.
  function harden(){
    ['renderAccount','renderSelectedPrice','renderButtons','renderTrades','renderQuotes'].forEach(name=>{
      const fn=window[name];if(typeof fn!=='function'||fn.__fxSafe)return;
      const safe=function(){try{return fn.apply(this,arguments)}catch(e){console.warn('FundFXT '+name+' skipped:',e);return null}};safe.__fxSafe=true;window[name]=safe;
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{harden();hideLegacy();inject();render();setInterval(render,5000)});
  window.addEventListener('error',e=>console.warn('FundFXT UI error',e.error||e.message));
})();
