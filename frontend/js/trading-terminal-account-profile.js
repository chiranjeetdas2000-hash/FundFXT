/* ===== FUNDFXT ACCOUNT OVERVIEW — BACKEND DATA ONLY ===== */
(function(){
'use strict';
const API='https://fundfxt.onrender.com';
const token=()=>localStorage.getItem('fundfxt_token')||'';
const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=v=>v==null?'—':Number(v).toFixed(1)+'%';
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function getAccount(){
  const r=await fetch(API+'/api/accounts',{headers:{Authorization:'Bearer '+token()}});
  const d=await r.json();
  if(!r.ok)throw Error(d.error||'Unable to load account');
  const list=d.accounts||[];
  const q=new URLSearchParams(location.search);
  const wanted=q.get('account_code')||q.get('account')||localStorage.getItem('fundfxt_selected_account');
  return list.find(a=>String(a.account_code)===String(wanted))||list[0]||null;
}
function bar(label,value,danger=false){
  const v=Math.max(0,Math.min(100,Number(value)||0));
  return `<div class="rule-label"><span>${label}</span><b>${pct(value)}</b></div><div class="rule-progress${danger?' rule-danger':''}"><i style="width:${v}%"></i></div>`;
}
function renderRules(a){
  const p=a.account_profile||{},r=p.rules||{};
  const target=r.profitTargetCents;
  const achieved=Number(r.profitAchievedCents||0);
  const targetProgress=r.targetProgressPercent;
  const dailyLimit=r.dailyDrawdownCents;
  const dailyUsed=Number(r.dailyDrawdownUsedCents||0);
  const maxLimit=r.maxDrawdownCents;
  const maxUsed=Number(r.maxDrawdownUsedCents||0);
  const dailyUsedPct=dailyLimit>0?Math.min(100,dailyUsed/dailyLimit*100):null;
  const maxUsedPct=maxLimit>0?Math.min(100,maxUsed/maxLimit*100):null;
  const consistencyLimit=r.consistencyLimitPercent;
  const consistencyAchieved=r.consistencyAchievedPercent;
  const trades=r.tradesToday;
  const maxTrades=r.maxTradesPerDay;
  return `<div class="account-rules account-rules-detailed">
    <div class="account-rule-model"><b>${esc(p.accountType||'Trading Account')}</b><span>${esc(p.fundingModel||'Challenge')} · ${esc(p.phase||'—')}</span></div>
    <div class="rule-grid">
      <div class="rule"><span>Account</span><b>${esc(p.accountType||'—')}</b></div>
      <div class="rule"><span>Phase</span><b>${esc(p.phase||'—')}</b></div>
      <div class="rule"><span>Profit target</span><b>${target==null?'Not configured':money(target)}</b></div>
      <div class="rule"><span>Profit achieved</span><b>${money(achieved)}</b></div>
      <div class="rule"><span>Daily drawdown limit</span><b>${dailyLimit==null?'Not configured':money(dailyLimit)}</b></div>
      <div class="rule"><span>Daily drawdown used</span><b>${dailyLimit==null?'—':money(dailyUsed)}</b></div>
      <div class="rule"><span>Maximum drawdown limit</span><b>${maxLimit==null?'Not configured':money(maxLimit)}</b></div>
      <div class="rule"><span>Maximum drawdown used</span><b>${maxLimit==null?'—':money(maxUsed)}</b></div>
      ${maxTrades!=null?`<div class="rule"><span>Trades today</span><b>${trades??'—'} / ${maxTrades}</b></div>`:''}
      ${consistencyLimit!=null?`<div class="rule"><span>Consistency limit</span><b>≤ ${pct(consistencyLimit)}</b></div><div class="rule"><span>Consistency achieved</span><b>${pct(consistencyAchieved)}</b></div>`:''}
    </div>
    ${target!=null?bar('Profit target progress',targetProgress):''}
    ${dailyLimit!=null?bar('Daily drawdown used',dailyUsedPct,true):''}
    ${maxLimit!=null?bar('Maximum drawdown used',maxUsedPct,true):''}
    ${consistencyLimit!=null?bar('Consistency usage',consistencyLimit>0?Math.min(100,(Number(consistencyAchieved)||0)/consistencyLimit*100):0,true):''}
    ${maxTrades!=null?bar('Daily trades used',maxTrades>0?Number(trades||0)/maxTrades*100:0,true):''}
  </div>`;
}
function build(a){
  const p=a.account_profile||{};
  const el=document.createElement('div');
  el.className='account-popover';
  el.innerHTML=`<div class="account-popover-head"><div><h3>Account Overview</h3><div class="account-id">${esc(a.account_code)}</div></div><button class="account-popover-close" type="button" aria-label="Close">×</button></div>${renderRules(a)}`;
  document.body.appendChild(el);
  el.querySelector('.account-popover-close').onclick=()=>el.remove();
  return el;
}
async function show(){
  document.querySelector('.account-popover')?.remove();
  const a=await getAccount();
  if(!a)return;
  localStorage.setItem('fundfxt_selected_account',a.account_code);
  build(a);
}
function install(){
  const btn=document.getElementById('accountMenuBtn');
  if(!btn)return;
  btn.onclick=async e=>{
    e.stopPropagation();
    if(document.querySelector('.account-popover')){document.querySelector('.account-popover').remove();return;}
    try{await show();}catch(err){if(typeof feedback==='function')feedback(err.message);}
  };
  document.addEventListener('click',e=>{const p=document.querySelector('.account-popover');if(p&&!p.contains(e.target)&&e.target!==btn)p.remove();});
}
const wait=setInterval(()=>{if(document.readyState!=='loading'&&document.getElementById('accountMenuBtn')){clearInterval(wait);install();}},50);
})();
