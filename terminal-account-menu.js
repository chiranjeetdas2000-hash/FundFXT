'use strict';
// FundFXT premium account menu: compact header + account/rules/profile/settings/logout drawer.
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'—').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]||m));
  const num=(...v)=>{for(const x of v){const n=Number(x);if(Number.isFinite(n))return n}return null};
  function inject(){
    if(document.getElementById('fxAccountMenu'))return;
    const style=document.createElement('style');
    style.textContent=`
      .fx-account-trigger{width:38px;height:38px;border:1px solid #263746;border-radius:10px;background:#0b1117;color:#fff;display:grid;place-items:center;cursor:pointer;transition:.2s}.fx-account-trigger:hover,.fx-account-trigger.active{border-color:#00d084;background:#10231d;color:#00d084;box-shadow:0 0 0 3px #00d08412}.fx-account-trigger svg{width:19px;height:19px}
      .fx-account-menu{position:fixed;z-index:120;top:67px;right:16px;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 82px);overflow:auto;background:#0d1319;border:1px solid #263746;border-radius:15px;box-shadow:0 24px 70px #000b;padding:10px;opacity:0;transform:translateY(-8px) scale(.98);pointer-events:none;transition:.18s ease}.fx-account-menu.open{opacity:1;transform:none;pointer-events:auto}.fx-menu-section{border:1px solid #1b2a35;background:#0b1117;border-radius:11px;padding:11px;margin:6px 0}.fx-menu-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.fx-menu-label{font-size:8px;color:#7f8d9a;letter-spacing:.08em;font-weight:700}.fx-menu-value{font-size:12px;color:#fff;font-weight:800}.fx-menu-sub{font-size:8px;color:#7f8d9a;margin-top:4px}.fx-rule{display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 0;border-top:1px solid #1b2a35}.fx-rule:first-of-type{border-top:0}.fx-rule b{font-size:9px}.fx-rule span{font-size:8px;color:#aeb9c3;text-align:right}.fx-rule.ok span{color:#00d084}.fx-rule.warn span{color:#f5b942}.fx-menu-title{font-size:10px;font-weight:800;margin-bottom:7px}.fx-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.fx-profile-cell{padding:8px;border:1px solid #1b2a35;border-radius:8px;background:#101820}.fx-profile-cell small{display:block;color:#7f8d9a;font-size:7px}.fx-profile-cell b{display:block;margin-top:3px;font-size:9px;overflow:hidden;text-overflow:ellipsis}.fx-menu-action{width:100%;height:34px;border:1px solid #263746;background:#121a22;color:#fff;border-radius:8px;font-size:8px;font-weight:800;cursor:pointer;margin-top:6px}.fx-menu-action:hover{border-color:#3a5266}.fx-menu-action.logout{color:#ff4d5a}.fx-consistency{display:flex;align-items:center;justify-content:space-between;padding:8px 9px;border:1px solid #263746;background:#101820;border-radius:8px;margin-top:7px}.fx-consistency b{font-size:10px}.fx-consistency span{font-size:8px;color:#00d084}.fx-rules-note{font-size:7px;color:#687784;margin-top:7px;line-height:1.4}.fx-menu-backdrop{position:fixed;inset:0;z-index:110;background:transparent;display:none}.fx-menu-backdrop.open{display:block}
      .topbar .acct{display:none!important}.top-right{display:flex!important;align-items:center;gap:8px}.top-center span:nth-child(3){display:none!important}.top-center{gap:26px!important}.top-center span{font-size:9px}.top-center span:first-child b,.top-center span:nth-child(2) b{font-size:11px;color:#fff}.top-center #market{font-weight:800;color:#00d084}.fx-account-mobile-hide{display:none!important}
      @media(max-width:820px){.topbar{padding:0 9px!important}.brand{font-size:18px!important}.top-center{gap:8px!important;margin-left:auto;margin-right:8px}.top-center span{font-size:7px!important}.top-center span:first-child,.top-center span:nth-child(2){display:flex!important;flex-direction:column}.top-center span:first-child b,.top-center span:nth-child(2) b{font-size:8px!important}.fx-account-trigger{width:35px;height:35px}.fx-account-menu{top:61px;right:9px;width:calc(100vw - 18px)}}
    `;
    document.head.appendChild(style);
    const backdrop=document.createElement('div');backdrop.id='fxAccountBackdrop';backdrop.className='fx-menu-backdrop';document.body.appendChild(backdrop);
    const trigger=document.createElement('button');trigger.id='fxAccountTrigger';trigger.className='fx-account-trigger';trigger.setAttribute('aria-label','Account menu');trigger.title='Account';trigger.innerHTML='<i data-lucide="user-round"></i>';
    const topRight=document.querySelector('.top-right');
    if(topRight)topRight.prepend(trigger);
    const menu=document.createElement('div');menu.id='fxAccountMenu';menu.className='fx-account-menu';menu.innerHTML=`
      <section class="fx-menu-section"><div class="fx-menu-head"><div><div class="fx-menu-label">TRADING ACCOUNT</div><div id="fxMenuAccount" class="fx-menu-value">—</div><div id="fxMenuStatus" class="fx-menu-sub">Loading account status…</div></div><i data-lucide="shield-check"></i></div></section>
      <section class="fx-menu-section"><div class="fx-menu-title">Account Rules &amp; Compliance</div><div id="fxRules"></div><div id="fxConsistency" class="fx-consistency"><b>Consistency</b><span>Calculating…</span></div><div class="fx-rules-note">Rules shown here are calculated from the selected account and its recorded trades.</div></section>
      <section class="fx-menu-section"><div class="fx-menu-title">Profile</div><div class="fx-profile-grid"><div class="fx-profile-cell"><small>ACCOUNT</small><b id="fxProfileAccount">—</b></div><div class="fx-profile-cell"><small>STATUS</small><b id="fxProfileStatus">—</b></div><div class="fx-profile-cell"><small>BALANCE</small><b id="fxProfileBalance">—</b></div><div class="fx-profile-cell"><small>EQUITY</small><b id="fxProfileEquity">—</b></div></div></section>
      <section class="fx-menu-section"><div class="fx-menu-title">Settings</div><button id="fxSettingsBtn" class="fx-menu-action">TRADING TERMINAL SETTINGS</button></section>
      <button id="fxLogoutBtn" class="fx-menu-action logout">LOGOUT</button>`;
    document.body.appendChild(menu);
    function close(){menu.classList.remove('open');backdrop.classList.remove('open');trigger.classList.remove('active')}
    function open(){render();menu.classList.add('open');backdrop.classList.add('open');trigger.classList.add('active');if(window.lucide?.createIcons)window.lucide.createIcons({attrs:{'stroke-width':2}})}
    function render(){
      const a=window.__fundfxtAccount||null, trades=Array.isArray(window.__fundfxtTrades)?window.__fundfxtTrades:[];
      const code=a?.account_code||$('accountCode')?.textContent||'—', status=a?.status||'ACTIVE';
      $('fxMenuAccount').textContent=code;$('fxMenuStatus').textContent=`${status} · Selected account`;$('fxProfileAccount').textContent=code;$('fxProfileStatus').textContent=status;$('fxProfileBalance').textContent=$('balance')?.textContent||'—';$('fxProfileEquity').textContent=$('equity')?.textContent||'—';
      const daily=num(a?.daily_drawdown_percent,a?.daily_drawdown,a?.daily_loss_limit_percent); const maxdd=num(a?.max_drawdown_percent,a?.max_drawdown,a?.total_drawdown_percent); const maxTrades=num(a?.max_trades,a?.trade_limit,a?.max_open_trades)??3; const consistencyLimit=num(a?.consistency_percent,a?.consistency_rule,a?.max_consistency_percent)??35;
      const open=trades.filter(t=>String(t.status).toUpperCase()==='OPEN').length;
      const profitTrades=trades.filter(t=>Number(t.realized_profit_cents)>0).map(t=>Number(t.realized_profit_cents)/100); const totalProfit=profitTrades.reduce((x,y)=>x+y,0); const largest=profitTrades.length?Math.max(...profitTrades):0; const consistency=totalProfit>0?largest/totalProfit*100:0;
      const rows=[['Daily Drawdown',daily!=null?`${daily}%`:'Configured',daily!=null?`${daily}% limit`:'Account rule'],['Max Drawdown',maxdd!=null?`${maxdd}%`:'Configured',maxdd!=null?`${maxdd}% limit`:'Account rule'],['Max Trades',String(maxTrades),`${open}/${maxTrades} open`]];
      $('fxRules').innerHTML=rows.map(r=>`<div class="fx-rule"><b>${esc(r[0])}</b><span>${esc(r[1])} · ${esc(r[2])}</span></div>`).join('');
      const c=$('fxConsistency');c.querySelector('span').textContent=totalProfit>0?`${consistency.toFixed(1)}% / ${consistencyLimit}%`:'0.0% / '+consistencyLimit+'%';c.classList.toggle('ok',consistency<=consistencyLimit);c.classList.toggle('warn',consistency>consistencyLimit);
    }
    trigger.onclick=()=>menu.classList.contains('open')?close():open();backdrop.onclick=close;document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
    $('fxLogoutBtn').onclick=()=>{localStorage.removeItem('fundfxt_token');location.href='/login.html'};
    $('fxSettingsBtn').onclick=()=>{close();if(window.toast)window.toast('Settings panel will be connected next.')};
    window.refreshFundFXTAccountMenu=render;
    if(window.lucide?.createIcons)window.lucide.createIcons({attrs:{'stroke-width':2}});
    document.querySelector('.account-panel')?.remove();document.querySelector('.mobile-nav button[data-view="account"]')?.remove();
  }
  document.addEventListener('DOMContentLoaded',()=>{inject();setTimeout(render,300)});
  const oldRenderAccount=window.renderAccount;
  if(typeof oldRenderAccount==='function')window.renderAccount=function(){oldRenderAccount();window.__fundfxtAccount=window.S?.account||window.__fundfxtAccount;window.refreshFundFXTAccountMenu?.()};
  const oldRenderTrades=window.renderTrades;
  if(typeof oldRenderTrades==='function')window.renderTrades=function(){oldRenderTrades();window.__fundfxtTrades=window.S?.trades||[];window.refreshFundFXTAccountMenu?.()};
})();
