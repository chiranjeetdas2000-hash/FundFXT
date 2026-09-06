/* FundFXT terminal trade-sync patch
 * Account-scoped trade sync for the terminal. This file is intentionally standalone
 * and safe to load before or after terminal.html's own functions are initialized.
 * It does not execute, close, modify, cancel, or synthesize any trade prices.
 */
(function(){
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token');
  const isWeekend=()=>{const d=new Date().getUTCDay();return d===0||d===6;};
  const headers=()=>({Authorization:`Bearer ${token()}`});

  async function getAccount(){
    if(!window.currentAccountCode) return null;
    const r=await fetch(`${API}/api/accounts`,{headers:headers()});
    if(!r.ok) throw new Error(`Account lookup failed (${r.status})`);
    const d=await r.json();
    return (d.accounts||[]).find(a=>String(a.account_code)===String(window.currentAccountCode))||null;
  }

  async function loadAllTrades(){
    const account=await getAccount();
    if(!account?.id) return [];
    const r=await fetch(`${API}/api/accounts/${account.id}/trades`,{headers:headers()});
    if(!r.ok) throw new Error(`Trade history request failed (${r.status})`);
    const d=await r.json();
    return d.success===false ? [] : (d.trades||[]);
  }

  async function sync(){
    try{
      const trades=await loadAllTrades();
      window.fundfxtTrades=trades;
      window.fundfxtOpenTrades=trades.filter(t=>String(t.status).toUpperCase()==='OPEN');
      window.fundfxtPendingTrades=trades.filter(t=>['PENDING','PLACED'].includes(String(t.status).toUpperCase()));
      window.fundfxtHistoryTrades=trades.filter(t=>!['OPEN','PENDING','PLACED'].includes(String(t.status).toUpperCase()));
      window.dispatchEvent(new CustomEvent('fundfxt:trades-sync',{detail:{trades,isWeekend:isWeekend()}}));
      return trades;
    }catch(err){
      console.error('[FundFXT] terminal trade sync:',err);
      return [];
    }
  }

  window.fundfxtLoadAllTrades=loadAllTrades;
  window.fundfxtSyncTrades=sync;
  window.fundfxtWeekend=isWeekend;

  // Refresh account-scoped trade state periodically. Weekend refresh is read-only;
  // it never creates synthetic quotes or mutates positions.
  const start=()=>{
    sync();
    if(window.__fundfxtTradeSyncTimer) clearInterval(window.__fundfxtTradeSyncTimer);
    window.__fundfxtTradeSyncTimer=setInterval(sync,5000);
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
