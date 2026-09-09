/* FundFXT terminal account/rules hardening. Database-first; never fabricate challenge targets. */
(function(){'use strict';
const API='https://fundfxt.onrender.com';
const token=()=>localStorage.getItem('fundfxt_token')||'';
const n=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const money=c=>c==null?'—':'$'+(Number(c)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=v=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(1)+'%';
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function getAccount(){const r=await fetch(API+'/api/accounts',{headers:{Authorization:'Bearer '+token()}}),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Unable to load account');const list=Array.isArray(d.accounts)?d.accounts:[],q=new URLSearchParams(location.search),wanted=q.get('account_code')||q.get('account')||localStorage.getItem('fundfxt_selected_account'),a=list.find(x=>String(x.account_code)===String(wanted))||list[0];if(!a)throw Error('No trading account available');return a}
function rule(l,v){return `<div class="rule"><span>${l}</span><b>${v}</b></div>`}
function bar(l,v,d=false){if(v==null)return '';const x=Math.max(0,Math.min(100,Number(v)));return `<div class="rule-label"><span>${l}</span><b>${pct(v)}</b></div><div class="rule-progress${d?' rule-danger':''}"><i style="width:${x}%"></i></div>`}
function rules(a){
  const p=a.account_profile||{},r=p.rules||{};
  const initial=n(a.initial_balance_cents),balance=n(a.balance_cents),equity=n(a.equity_cents),size=n(a.account_size_cents||r.accountSizeCents),phase=p.phase??a.phase??a.account_phase;
  const open=n(r.openPositions),target=n(r.profitTargetCents),targetPct=n(r.profitTargetPercent),achieved=n(r.profitAchievedCents),remaining=target===null||achieved===null?null:Math.max(0,target-achieved),progress=n(r.targetProgressPercent);
  const daily=n(r.dailyDrawdownCents),dailyUsedC=n(r.dailyDrawdownUsedCents),dailyRemainingC=n(r.dailyDrawdownRemainingCents),dailyUsed=daily&&dailyUsedC!==null?dailyUsedC/daily*100:null;
  const max=n(r.maxDrawdownCents),maxUsedC=n(r.maxDrawdownUsedCents),maxRemainingC=n(r.maxDrawdownRemainingCents),maxUsed=max&&maxUsedC!==null?maxUsedC/max*100:null;
  const maxTrades=n(r.maxTradesPerDay),today=n(r.tradesToday),maxOpen=n(r.maxOpenPositions),consLimit=n(r.consistencyLimitPercent),cons=n(r.consistencyAchievedPercent),consUsage=consLimit!==null&&cons!==null?cons/consLimit*100:null;
  const netProfit=balance!==null&&initial!==null?balance-initial:null;
  const targetText=target===null?'Not configured in database':`${targetPct!==null?pct(targetPct)+' · ':''}${money(target)}`;
  const targetRemaining=remaining===null?'—':money(remaining);
  const dailyRemaining= dailyRemainingC===null?'—':money(dailyRemainingC);
  const maxRemaining=maxRemainingC===null?'—':money(maxRemainingC);
  const tradesUsed=maxTrades!==null&&today!==null?Math.max(0,Math.min(100,today/maxTrades*100)):null;
  return `<div class="account-rules account-rules-detailed" id="accountRulesBody">
    <div class="account-rule-model"><b>${esc(p.accountType||'Trading Account')}</b><span>${esc(p.fundingModel||'—')}${phase==null?'':' · '+esc(phase)}</span></div>
    <div class="rule-grid">
      ${rule('Account type',esc(p.accountType))}${rule('Funding model',esc(p.fundingModel))}${rule('Phase / stage',esc(phase))}${rule('Challenge model',esc(p.model||a.challenge_model))}
      ${rule('Direct funded',p.isDirectFunded==null?'—':(p.isDirectFunded?'Yes':'No'))}${rule('Warrior account',p.isWarrior==null?'—':(p.isWarrior?'Yes':'No'))}
      ${rule('Account size',money(size))}${rule('Initial balance',money(initial))}${rule('Current balance',money(balance))}${rule('Current equity',money(equity))}
      ${rule('Net P/L',netProfit===null?'—':`${netProfit>=0?'+':''}${money(netProfit)}`)}${rule('Current phase target',targetText)}${rule('Profit achieved',achieved===null?'—':money(achieved))}${rule('Profit remaining',targetRemaining)}
      ${rule('Daily drawdown limit',daily===null?'—':money(daily))}${rule('Daily drawdown remaining',dailyRemaining)}${rule('Maximum drawdown limit',max===null?'—':money(max))}${rule('Maximum drawdown remaining',maxRemaining)}
      ${rule('Trades today',maxTrades===null||today===null?'—':`${today} / ${maxTrades}`)}${rule('Open positions',maxOpen===null||open===null?'—':`${open} / ${maxOpen}`)}
      ${rule('Consistency limit',consLimit===null?'—':'≤ '+pct(consLimit))}${rule('Consistency achieved',cons===null?'—':pct(cons))}${rule('Consistency status',cons===null||consLimit===null?'—':(cons<=consLimit?'Within limit':'Above limit'))}
    </div>
    ${bar('Current phase profit target progress',progress)}${bar('Daily drawdown used',dailyUsed,true)}${bar('Maximum drawdown used',maxUsed,true)}${bar('Daily trades used',tradesUsed,true)}${bar('Consistency usage',consUsage,true)}
  </div>`;
}
async function render(){
  document.querySelector('.account-popover')?.remove();
  const shell=document.createElement('div');shell.className='account-popover account-loading';shell.innerHTML='<div class="account-loading-text">Loading account overview…</div>';document.body.appendChild(shell);
  try{
    const a=await getAccount();
    localStorage.setItem('fundfxt_selected_account',a.account_code);
    shell.classList.remove('account-loading');
    shell.innerHTML=`<div class="account-popover-head"><div><h3>Account Overview</h3><div class="account-id">${esc(a.account_code)}</div></div><button class="account-popover-close" type="button" aria-label="Close account overview">×</button></div><div class="account-values"><div class="account-value"><span>Balance</span><b id="accountPopupBalance">${money(a.balance_cents)}</b></div><div class="account-value"><span>Equity</span><b id="accountPopupEquity">${money(a.equity_cents)}</b></div></div>${rules(a)}<div class="rule-note"><b>Live rule data:</b> values above are refreshed from the FundFXT account data endpoint. Missing database fields stay unconfigured instead of showing invented targets.</div>`;
    shell.querySelector('.account-popover-close').onclick=()=>shell.remove();
  shell.querySelector('#terminalAccountDashboard')?.remove();
  const view=document.createElement('button');view.className='account-dashboard-btn';view.id='terminalAccountDashboard';view.type='button';view.textContent='View Full Account Dashboard ↗';shell.appendChild(view);view.onclick=()=>location.href='/account-dashboard.html?account_code='+encodeURIComponent(a.account_code);
  }catch(e){shell.classList.remove('account-loading');shell.innerHTML='<div class="account-error">'+esc(e.message)+'</div>'}
}
async function refresh(){const p=document.querySelector('.account-popover');if(!p||p.classList.contains('account-loading'))return;try{const a=await getAccount(),b=p.querySelector('#accountPopupBalance'),e=p.querySelector('#accountPopupEquity');if(b)b.textContent=money(a.balance_cents);if(e)e.textContent=money(a.equity_cents);const m=p.querySelector('#accountRulesBody');if(m){const html=rules(a),tmp=document.createElement('div');tmp.innerHTML=html;m.replaceWith(tmp.firstElementChild);}}catch{}}
function tabs(t){document.querySelectorAll('.right-tab').forEach(b=>{const on=b.dataset.tab===t;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')})}
function install(){
  const old=document.getElementById('terminalFastFixStyle');if(old)old.remove();
  const s=document.createElement('style');s.id='terminalFastFixStyle';s.textContent='.account-loading{display:flex;align-items:center;justify-content:center;min-height:120px;color:#a8b0bc}.account-loading-text{font-size:10px}.account-error{padding:18px;color:#ff7b86}.account-dashboard-btn{width:100%;margin-top:13px;border:1px solid #00b56a;background:#00b56a12;color:#00d084;border-radius:9px;padding:11px;font-weight:700;cursor:pointer}';document.head.appendChild(s);
  const btn=document.getElementById('accountMenuBtn');if(btn)btn.onclick=async e=>{e.stopPropagation();const p=document.querySelector('.account-popover');if(p)p.remove();else await render()};
  document.querySelectorAll('.right-tab').forEach(b=>b.addEventListener('click',()=>tabs(b.dataset.tab),true));tabs('OPEN');
  document.addEventListener('click',e=>{const p=document.querySelector('.account-popover');if(p&&!p.contains(e.target)&&e.target!==btn)p.remove()});
}
const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('accountMenuBtn')){clearInterval(wait);install()}},50);
})();
