/* FundFXT terminal trade-sync patch
 * Uses the authenticated account-id trade endpoint so legacy OPEN trades are visible even
 * when an older trade row has a missing/mismatched user_id. Also refreshes all three views.
 * Weekend: existing positions remain visible; no close/modify actions are sent by this patch.
 */
(function(){
  const API='https://fundfxt.onrender.com';
  const token=()=>localStorage.getItem('fundfxt_token');
  const weekend=()=>{const d=new Date().getUTCDay();return d===0||d===6;};
  async function accountId(){
    const r=await fetch(API+'/api/accounts',{headers:{Authorization:`Bearer ${token()}`}});
    const d=await r.json();
    const a=(d.accounts||[]).find(x=>x.account_code===currentAccountCode);
    return a?.id||null;
  }
  async function allTrades(){
    const id=await accountId();
    if(!id) return [];
    const r=await fetch(`${API}/api/accounts/${id}/trades`,{headers:{Authorization:`Bearer ${token()}`}});
    const d=await r.json();
    return d.success ? (d.trades||[]) : [];
  }
  window.fundfxtLoadAllTrades=allTrades;
  window.fundfxtWeekend=weekend;
})();
