/* FundFXT Dashboard recovery layer — keeps the dashboard usable even when optional UI data is unavailable. */
(function(){
  'use strict';
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token')||'';
  const $=id=>document.getElementById(id);
  const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  async function api(path){
    const r=await fetch(API+path,{headers:{Authorization:'Bearer '+token()}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||('Request failed ('+r.status+')'));
    return d;
  }

  function installStyle(){
    if(document.getElementById('fundfxt-dashboard-recovery-style')) return;
    const s=document.createElement('style');s.id='fundfxt-dashboard-recovery-style';
    s.textContent=`
      .dashboard-recovery-actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 28px}
      .dashboard-recovery-actions a{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:9px;text-decoration:none;font-weight:700;font-size:13px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);transition:background .2s ease,border-color .2s ease,transform .2s ease}
      .dashboard-recovery-actions a.primary{background:var(--green);border-color:var(--green);color:#fff}
      .dashboard-recovery-actions a:hover{transform:translateY(-2px);border-color:var(--green)}
      .dashboard-recovery-error{padding:18px;border:1px solid rgba(255,68,68,.3);background:rgba(255,68,68,.06);border-radius:12px;color:#ff9a9a;grid-column:1/-1}
      .account-card .view-btn{transition:background .2s ease,transform .2s ease}
      .account-card .view-btn:hover{transform:translateY(-1px)}
      @media(prefers-reduced-motion:reduce){.dashboard-recovery-actions a,.account-card .view-btn{transition:none!important}.dashboard-recovery-actions a:hover,.account-card .view-btn:hover{transform:none!important}}
    `;document.head.appendChild(s);
  }

  function removeDuplicateNotification(){
    const header=document.querySelector('.header-right');
    const bells=[...document.querySelectorAll('.bell-icon')];
    if(bells.length>1){
      bells.slice(1).forEach(b=>b.closest('.notification-container')?.remove()||b.remove());
    }
  }

  function addQuickActions(){
    const home=$('view-home');
    if(!home||home.querySelector('.dashboard-recovery-actions')) return;
    const profile=home.querySelector('.profile-card');
    const actions=document.createElement('div');actions.className='dashboard-recovery-actions';
    actions.innerHTML='<a class="primary" href="/trading-terminal.html"><i class="fa-solid fa-chart-line"></i> Open Trading Terminal</a><a href="/account-dashboard.html"><i class="fa-solid fa-gauge-high"></i> Account Dashboard</a>';
    (profile||home.firstElementChild)?.insertAdjacentElement('afterend',actions);
  }

  function renderProfile(d){
    const name=d?.legal_name||'Trader';
    $('header-user-name')?.replaceChildren(document.createTextNode(name));
    $('profile-name')?.replaceChildren(document.createTextNode(name));
    if($('profile-email')) $('profile-email').textContent=d?.email||'—';
    if($('profile-phone')) $('profile-phone').textContent=d?.phone||'—';
    if($('profile-date')) $('profile-date').textContent=d?.member_since?new Date(d.member_since).toLocaleDateString():'—';
    if($('aff-code')) $('aff-code').textContent=d?.affiliate_code||'AFF-PENDING';
  }

  function accountCard(a){
    const p=a.account_profile||{};
    const r=p.rules||{};
    const initial=Number(a.initial_balance_cents||0);
    const balance=Number(a.balance_cents||0);
    const equity=Number(a.equity_cents??balance);
    const profit=balance-initial;
    const target=Number(r.profitTargetCents||0);
    const progress=target>0?Math.max(0,Math.min(100,profit/target*100)):0;
    const daily=Number(r.dailyDrawdownCents||0);
    const dailyUsed=Math.max(0,Number(a.day_start_balance_cents||initial)-balance);
    const max=Number(r.maxDrawdownCents||0);
    const maxUsed=Math.max(0,initial-equity);
    const status=String(a.status||'ACTIVE').toUpperCase();
    const code=a.account_code||'N/A';
    const model=p.displayName||p.model||a.challenge_model||'Trading Account';
    return `<div class="account-card" data-account-code="${esc(code)}">
      <span class="acc-status ${esc(status)}">${esc(status)}</span>
      <h2>${esc(code)}</h2>
      <div class="sub">${esc(model).replace(/_/g,' ')}</div>
      <div class="account-info-grid">
        <p>Balance<strong>${money(balance)}</strong></p>
        <p>Equity<strong>${money(equity)}</strong></p>
        <p>Type<strong>${esc(p.accountType||'Trading Account')}</strong></p>
        <p>Phase<strong>${esc(p.phase||'—')}</strong></p>
        <p>Funding<strong>${esc(p.fundingModel||'—')}</strong></p>
        <p>Profit<strong style="color:${profit>=0?'var(--green)':'var(--red)'}">${profit>=0?'+':''}${money(profit)}</strong></p>
      </div>
      <div style="margin:12px 0;font-size:11px;color:var(--text-muted)">
        <div style="display:flex;justify-content:space-between"><span>Profit target progress</span><b>${target?progress.toFixed(1)+'%':'Not configured'}</b></div>
        <div style="height:7px;background:#2a2a2a;border-radius:10px;overflow:hidden;margin-top:6px"><i style="display:block;width:${progress}%;height:100%;background:var(--green);border-radius:10px"></i></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;font-size:10px;color:var(--text-muted);margin-bottom:12px">
        <span>Daily DD left: <b>${daily?money(Math.max(0,daily-dailyUsed)):'—'}</b></span>
        <span>Max DD left: <b>${max?money(Math.max(0,max-maxUsed)):'—'}</b></span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="view-btn account-dashboard-link" data-account="${esc(code)}" type="button">Open Dashboard</button>
        <button class="view-btn terminal-link" data-account="${esc(code)}" type="button">Open Terminal</button>
      </div>
    </div>`;
  }

  async function loadProfile(){
    try{renderProfile(await api('/api/user/profile'));}
    catch(e){console.error('FundFXT profile:',e);}
  }

  async function loadAccounts(){
    const c=$('accounts-container');
    if(!c)return;
    c.innerHTML='<div class="account-loading-card"><div class="dash-spinner"></div>Loading your trading accounts…</div>';
    try{
      const d=await api('/api/accounts');
      const accounts=Array.isArray(d.accounts)?d.accounts:[];
      const active=accounts.filter(a=>String(a.status).toUpperCase()==='ACTIVE').length;
      const passed=accounts.filter(a=>String(a.status).toUpperCase()==='PASSED').length;
      const failed=accounts.filter(a=>['BREACHED','EXPIRED','CLOSED','FAILED'].includes(String(a.status).toUpperCase())).length;
      const profit=accounts.reduce((s,a)=>s+Number(a.balance_cents||0)-Number(a.initial_balance_cents||0),0);
      if($('total-accounts'))$('total-accounts').textContent=accounts.length;
      if($('active-accounts'))$('active-accounts').textContent=active;
      if($('passed-accounts'))$('passed-accounts').textContent=passed;
      if($('failed-accounts'))$('failed-accounts').textContent=failed;
      if($('total-profit'))$('total-profit').textContent=(profit>=0?'+':'-')+money(Math.abs(profit));
      const empty=$('empty-state');
      if(!accounts.length){c.innerHTML='';if(empty)empty.style.display='block';return;}
      if(empty)empty.style.display='none';
      c.innerHTML=accounts.map(accountCard).join('');
      c.querySelectorAll('.account-dashboard-link').forEach(b=>b.onclick=()=>location.href='/account-dashboard.html?account_code='+encodeURIComponent(b.dataset.account));
      c.querySelectorAll('.terminal-link').forEach(b=>b.onclick=()=>location.href='/trading-terminal.html?account_code='+encodeURIComponent(b.dataset.account));
    }catch(e){
      console.error('FundFXT accounts:',e);
      c.innerHTML='<div class="dashboard-recovery-error"><b>Trading accounts could not be loaded.</b><br>'+esc(e.message)+'<br><small>Please refresh once. Your account data is still stored on the backend.</small></div>';
    }
  }

  async function recoverHome(){
    installStyle();
    removeDuplicateNotification();
    addQuickActions();
    await Promise.allSettled([loadProfile(),loadAccounts()]);
  }

  const boot=setInterval(()=>{
    if(document.readyState!=='loading'&&document.getElementById('view-home')){
      clearInterval(boot);recoverHome();
    }
  },50);
})();
