from pathlib import Path
import re

p=Path('terminal.html')
s=p.read_text(encoding='utf-8')

# Replace the complete positions loader and its first action definitions.
start=s.find('async function loadPositions()')
end=s.find('async function loadHistory()',start)
if start<0 or end<0: raise SystemExit('positions anchors missing')
replacement=r'''async function loadPositions(){
    const tbody=document.getElementById('positionsTableBody');
    const emptyState=document.getElementById('emptyState');
    if(!currentAccountCode)return;
    try{
        const r=await fetch(`https://fundfxt.onrender.com/api/trade/get?account_code=${encodeURIComponent(currentAccountCode)}`,{headers:{Authorization:`Bearer ${localStorage.getItem('fundfxt_token')}`},cache:'no-store'});
        const d=await r.json();
        if(!r.ok||!d.success)throw new Error(d.error||'Unable to load trades');
        const trades=d.trades||[];
        const open=trades.filter(t=>String(t.status||'').toUpperCase()==='OPEN');
        if(!open.length){emptyState.style.display='block';emptyState.innerText='No Open Trades';tbody.innerHTML='';return;}
        emptyState.style.display='none';
        const weekend=fundfxtIsWeekendNow();
        tbody.innerHTML=open.map(t=>{
            const pnl=Number(t.floating_profit_cents||0)/100;
            const id=t.trade_id||t.id||'';
            const side=String(t.side||'').toUpperCase();
            return `<tr><td>${id}</td><td>${t.symbol||'--'}</td><td style="color:${side==='BUY'?'var(--green)':'var(--red)'}">${side||'--'}</td><td>${t.volume??'--'}</td><td>${t.entry_price??'--'}</td><td>${weekend?'--':(t.current_price??'--')}</td><td style="color:${pnl>=0?'var(--green)':'var(--red)'}">$${pnl.toFixed(2)}</td><td><button class="btn-sm modify-btn" ${weekend?'disabled title="Weekend — position cannot be modified"':''} onclick="modifyTrade('${id}')">Modify</button><button class="btn-sm close-btn" ${weekend?'disabled title="Weekend — position remains open"':''} onclick="closeTrade('${id}')">Close</button></td></tr>`;
        }).join('');
    }catch(e){console.error('FundFXT loadPositions:',e);emptyState.style.display='block';emptyState.innerText='Unable to load open trades. Retrying…';}
}

async function modifyTrade(tradeId){
    if(fundfxtIsWeekendNow())return alert('Market is closed on Saturday/Sunday. Existing positions remain open and cannot be modified.');
    const newSL=prompt('Enter new Stop Loss (or leave blank):');
    const newTP=prompt('Enter new Take Profit (or leave blank):');
    const payload={};
    if(newSL!==null&&newSL!=='')payload.stop_loss=parseFloat(newSL);
    if(newTP!==null&&newTP!=='')payload.take_profit=parseFloat(newTP);
    if(!Object.keys(payload).length)return;
    try{const r=await fetch(`https://fundfxt.onrender.com/api/trades/${tradeId}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('fundfxt_token')}`},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'Failed to modify trade');loadPositions();}catch(e){alert(e.message||'Unable to modify trade.');}
}

async function closeTrade(tradeId){
    if(fundfxtIsWeekendNow())return alert('Market is closed on Saturday/Sunday. Existing positions remain open.');
    if(!confirm('Close this trade?'))return;
    try{const r=await fetch(`https://fundfxt.onrender.com/api/trades/${tradeId}/close`,{method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('fundfxt_token')}`}});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'Failed to close trade');loadPositions();loadHistory();fetchAccountSummary();}catch(e){alert(e.message||'Unable to close trade.');}
}

'''
s=s[:start]+replacement+s[end:]

# Replace history so only terminal history states are shown; pending remains in its own tab.
start=s.find('async function loadHistory()')
end=s.find('async function loadPendingOrders()',start)
if start<0 or end<0: raise SystemExit('history anchors missing')
history=r'''async function loadHistory(){
    const tbody=document.getElementById('positionsTableBody');
    const emptyState=document.getElementById('emptyState');
    if(!currentAccountCode)return;
    try{
        const r=await fetch(`https://fundfxt.onrender.com/api/trade/get?account_code=${encodeURIComponent(currentAccountCode)}`,{headers:{Authorization:`Bearer ${localStorage.getItem('fundfxt_token')}`},cache:'no-store'});
        const d=await r.json(); if(!r.ok||!d.success)throw new Error(d.error||'Unable to load trade history');
        const rows=(d.trades||[]).filter(t=>!['OPEN','PENDING','PLACED'].includes(String(t.status||'').toUpperCase()));
        if(!rows.length){emptyState.style.display='block';emptyState.innerText='No Trade History';tbody.innerHTML='';return;}
        emptyState.style.display='none';
        tbody.innerHTML=rows.map(t=>{const pnl=Number(t.realized_profit_cents||0)/100;return `<tr><td>${t.trade_id||t.id||'--'}</td><td>${t.symbol||'--'}</td><td style="color:${String(t.side).toUpperCase()==='BUY'?'var(--green)':'var(--red)'}">${t.side||'--'}</td><td>${t.volume??'--'}</td><td>${t.entry_price??'--'}</td><td>${t.exit_price??'--'}</td><td style="color:${pnl>=0?'var(--green)':'var(--red)'}">$${pnl.toFixed(2)}</td><td><span style="color:var(--text-muted)">${t.status||'--'}${t.close_reason?' ('+t.close_reason+')':''}</span></td></tr>`;}).join('');
    }catch(e){console.error('FundFXT loadHistory:',e);emptyState.style.display='block';emptyState.innerText='Unable to load trade history. Retrying…';}
}

'''
s=s[:start]+history+s[end:]

# Replace pending loader so it is account-scoped and does not rely on stale trade.user_id.
start=s.find('async function loadPendingOrders()')
end=s.find('// --- TRADE ACTIONS ---',start)
if start<0 or end<0: raise SystemExit('pending anchors missing')
pending=r'''async function loadPendingOrders(){
    const tbody=document.getElementById('positionsTableBody');
    const emptyState=document.getElementById('emptyState');
    if(!currentAccountCode)return;
    try{
        const r=await fetch(`https://fundfxt.onrender.com/api/trades/pending?account_code=${encodeURIComponent(currentAccountCode)}`,{headers:{Authorization:`Bearer ${localStorage.getItem('fundfxt_token')}`},cache:'no-store'});
        const d=await r.json(); if(!r.ok||!d.success)throw new Error(d.error||'Unable to load pending orders');
        const rows=d.trades||[];
        if(!rows.length){emptyState.style.display='block';emptyState.innerText='No Pending Orders';tbody.innerHTML='';return;}
        emptyState.style.display='none';
        tbody.innerHTML=rows.map(t=>`<tr><td>${t.trade_id||t.id||'--'}</td><td>${t.symbol||'--'}</td><td style="color:${String(t.side).toUpperCase()==='BUY'?'var(--green)':'var(--red)'}">${t.side||'--'} ${t.order_type||''}</td><td>${t.volume??'--'}</td><td>${t.entry_price??'--'}</td><td>--</td><td>--</td><td><button class="trade-action-btn" ${fundfxtIsWeekendNow()?'disabled':''} onclick="cancelPending('${t.trade_id||t.id}')">Cancel</button></td></tr>`).join('');
    }catch(e){console.error('FundFXT loadPendingOrders:',e);emptyState.style.display='block';emptyState.innerText='Unable to load pending orders. Retrying…';}
}

'''
s=s[:start]+pending+s[end:]

# Remove duplicate action definitions that followed the pending loader.
s=re.sub(r'// --- TRADE ACTIONS ---\s*async function closeTrade\(tradeId\).*?\n\s*async function cancelPending\(tradeId\)', 'async function cancelPending(tradeId)', s, flags=re.S)

# Weekend helpers and execution guard.
if 'function fundfxtIsWeekendNow()' not in s:
    marker='        // --- ORDER TYPE ---'
    guard='''        function fundfxtIsWeekendNow(){const d=new Date().getUTCDay();return d===0||d===6;}
        function updateWeekendTradingUI(){const closed=fundfxtIsWeekendNow();document.querySelectorAll('.btn-buy,.btn-sell,.order-type-tab,#mktLots,#mktSL,#mktTP,#limitPrice').forEach(el=>{el.disabled=closed;});}
'''
    if marker not in s: raise SystemExit('order marker missing')
    s=s.replace(marker,guard+'\n'+marker,1)
needle='        async function executeOrder(side) {\n            if (!currentAccountCode)'
if needle in s:s=s.replace(needle,"        async function executeOrder(side) {\n            if (fundfxtIsWeekendNow()) return alert('Market is closed on Saturday/Sunday. Trading changes are unavailable.');\n            if (!currentAccountCode)",1)

# Cancel is also guarded client-side; backend remains authoritative.
s=s.replace("async function cancelPending(tradeId) {\n            if (!confirm('Cancel this pending order?')) return;", "async function cancelPending(tradeId) {\n            if (fundfxtIsWeekendNow()) return alert('Market is closed on Saturday/Sunday. Existing pending orders remain unchanged.');\n            if (!confirm('Cancel this pending order?')) return;", 1)

# Add periodic read-only refresh. Monday transition immediately refreshes every view.
if 'initFundFXTTradeSync' not in s:
    pos=s.rfind('</script>')
    if pos<0: raise SystemExit('script close missing')
    hook='''        (function initFundFXTTradeSync(){let wasWeekend=fundfxtIsWeekendNow();updateWeekendTradingUI();setInterval(()=>{const nowWeekend=fundfxtIsWeekendNow();updateWeekendTradingUI();if(nowWeekend!==wasWeekend){wasWeekend=nowWeekend;loadPositions();loadHistory();loadPendingOrders();fetchAccountSummary();}else if(currentAccountCode){if(currentTab==='positions')loadPositions();else if(currentTab==='history')loadHistory();else if(currentTab==='pending')loadPendingOrders();}},5000);})();
'''
    s=s[:pos]+hook+s[pos:]

p.write_text(s,encoding='utf-8')
print('terminal patched')
