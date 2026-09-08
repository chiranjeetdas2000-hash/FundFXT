/* ===== FUNDFXT ACCOUNT OVERVIEW — SINGLE BACKEND SOURCE ===== */
(function(){
'use strict';
const API='https://fundfxt.onrender.com';
const token=()=>localStorage.getItem('fundfxt_token')||'';
const num=v=>v===null||v===undefined||v===''?null:Number(v);
const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=v=>v==null?'—':Number(v).toFixed(1)+'%';
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function getAccount(){
  const r=await fetch(API+'/api/accounts',{headers:{Authorization:'Bearer '+token()}});const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||'Unable to load account');
  const list=Array.isArray(d.accounts)?d.accounts:[];if(!list.length)throw Error('No trading account available');
  const q=new URLSearchParams(location.search),wanted=q.get('account_code')||q.get('account')||localStorage.getItem('fundfxt_selected_account');
  return list.find(a=>String(a.account_code)===String(wanted))||list[0];
}
function renderRules(a){
  const p=a.account_profile||{},r=p.rules||{},initial=num(a.initial_balance_cents)??num(a.balance_cents)??0,balance=num(a.balance_cents)??0,equity=num(a.equity_cents)??balance;
  /* Profit target is shown only when the backend explicitly supplies a verified target source. */
  const target=p.profitTargetSource?r.profitTargetCents:null,targetProgress=target==null?null:r.targetProgressPercent;
  const dailyLimit=r.dailyDrawdownCents,dailyUsed=Number(r.dailyDrawdownUsedCents||0),maxLimit=r.maxDrawdownCents,maxUsed=Number(r.maxDrawdownUsedCents||0),dailyPct=r.dailyDrawdownPercent,maxPct=r.maxDrawdownPercent??r.maximumDrawdownPercent;
  const dailyUsedPct=dailyLimit>0?Math.min(100,dailyUsed/dailyLimit*100):0,maxUsedPct=maxLimit>0?Math.min(100,maxUsed/maxLimit*100):0;
  const consistencyLimit=p.isWarrior?30:r.consistencyLimitPercent,consistencyAchieved=r.consistencyAchievedPercent,tradesToday=r.tradesToday,maxTrades=p.isWarrior?3:r.maxTradesPerDay;
  const type=p.accountType||'Trading Account',funding=p.fundingModel||'—',phase=p.phase||'—',model=p.model||a.challenge_model||'—';
  return `<div class="account-rules account-rules-detailed">
    <div class="account-rule-model"><b>${esc(type)}</b><span>${esc(funding)} · ${esc(phase)}</span></div>
    <div class="rule-grid"><div class="rule"><span>Account type</span><b>${esc(type)}</b></div><div class="rule"><span>Funding model</span><b>${esc(funding)}</b></div><div class="rule"><span>Phase</span><b>${esc(phase)}</b></div><div class="rule"><span>Challenge model</span><b>${esc(model)}</b></div><div class="rule"><span>Direct funded</span><b>${p.isDirectFunded?'Yes':'No'}</b></div><div class="rule"><span>Initial balance</span><b>${money(initial)}</b></div><div class="rule"><span>Current balance</span><b id="accountRuleBalance">${money(balance)}</b></div><div class="rule"><span>Current equity</span><b id="accountRuleEquity">${money(equity)}</b></div><div class="rule"><span>Profit target</span><b>${target==null?'Not configured':money(target)}</b></div><div class="rule"><span>Profit achieved</span><b>${money(r.profitAchievedCents)}</b></div></div>
    ${target!=null?`<div class="rule-label"><span>Profit target progress</span><b>${pct(targetProgress)}</b></div><div class="rule-progress"><i style="width:${Math.max(0,Math.min(100,Number(targetProgress)||0))}%"></i></div>`:`<div class="rule-note">No verified profit target is supplied by the backend for this account. No target is estimated or invented.</div>`}
    ${dailyLimit!=null?`<div class="rule-label"><span>Daily drawdown limit</span><b>${dailyPct==null?'—':dailyPct+'%'} · ${money(dailyLimit)}</b></div><div class="rule-label"><span>Daily drawdown used</span><b>${money(dailyUsed)} (${pct(dailyUsedPct)})</b></div><div class="rule-progress rule-danger"><i style="width:${dailyUsedPct}%"></i></div>`:''}
    ${maxLimit!=null?`<div class="rule-label"><span>Maximum drawdown</span><b>${maxPct==null?'—':maxPct+'%'} · ${money(maxLimit)}</b></div><div class="rule-label"><span>Maximum drawdown used</span><b>${money(maxUsed)} (${pct(maxUsedPct)})</b></div><div class="rule-progress rule-danger"><i style="width:${maxUsedPct}%"></i></div>`:''}
    ${maxTrades!=null?`<div class="rule-label"><span>Trades today</span><b>${tradesToday??0} / ${maxTrades}</b></div><div class="rule-progress"><i style="width:${Math.min(100,(Number(tradesToday)||0)/Number(maxTrades)*100)}%"></i></div>`:''}
    ${consistencyLimit!=null?`<div class="rule-label"><span>Consistency limit</span><b>≤ ${pct(consistencyLimit)}</b></div><div class="rule-label"><span>Consistency achieved</span><b>${pct(consistencyAchieved)}</b></div><div class="rule-progress"><i style="width:${Math.min(100,((Number(consistencyAchieved)||0)/Number(consistencyLimit))*100)}%"></i></div>`:''}
    ${p.isWarrior?'<div class="rule-note"><b>Warrior rules:</b> maximum 3 trades per day · 30% consistency limit.</div>':''}
  </div>`;
}
function build(a){const el=document.createElement('div');el.className='account-popover';el.innerHTML=`<div class="account-popover-head"><div><h3>Account Overview</h3><div class="account-id">${esc(a.account_code)}</div></div><button class="account-popover-close" type="button" aria-label="Close">×</button></div><div class="account-values"><div class="account-value"><span>Balance</span><b id="accountPopupBalance">${money(a.balance_cents)}</b></div><div class="account-value"><span>Equity</span><b id="accountPopupEquity">${money(a.equity_cents)}</b></div></div><div id="accountRulesMount">${renderRules(a)}</div>`;document.body.appendChild(el);el.querySelector('.account-popover-close').onclick=()=>el.remove();return el;}
async function refresh(el){try{const a=await getAccount();const b=el.querySelector('#accountPopupBalance'),e=el.querySelector('#accountPopupEquity');if(b)b.textContent=money(a.balance_cents);if(e)e.textContent=money(a.equity_cents);el.querySelector('#accountRulesMount').innerHTML=renderRules(a);}catch{}}
async function show(){document.querySelector('.account-popover')?.remove();const a=await getAccount();localStorage.setItem('fundfxt_selected_account',a.account_code);return build(a);}
function install(){const btn=document.getElementById('accountMenuBtn');if(!btn)return;btn.onclick=async e=>{e.stopPropagation();const old=document.querySelector('.account-popover');if(old){old.remove();return;}try{await show();}catch(err){if(typeof feedback==='function')feedback(err.message);}};document.addEventListener('click',e=>{const p=document.querySelector('.account-popover');if(p&&!p.contains(e.target)&&e.target!==btn)p.remove();});setInterval(async()=>{const p=document.querySelector('.account-popover');if(p)await refresh(p);},1000);}
const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('accountMenuBtn')){clearInterval(wait);install();}},50);
})();
