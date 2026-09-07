'use strict';

// FundFXT premium open-position cards + combined SL/TP editor.
// This layer enhances the existing trade renderer without changing execution APIs.
(function(){
  const originalRenderTrades=window.renderTrades;
  if(typeof originalRenderTrades!=='function')return;

  function esc(v){return String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

  function readCard(card){
    const top=card.querySelector('.trade-top');
    const meta=[...card.querySelectorAll('.trade-meta>div')];
    const symbol=top?.querySelector('b')?.textContent?.trim()||'—';
    const tradeId=top?.querySelector('small')?.textContent?.trim()||'Position';
    const sideText=top?.querySelector('.side')?.textContent?.trim()||'';
    const parts=sideText.split('·').map(x=>x.trim());
    const side=parts[0]||'BUY';
    const volume=parts[1]||'—';
    const entry=meta[0]?.querySelector('b')?.textContent?.trim()||'—';
    const current=meta[1]?.querySelector('b')?.textContent?.trim()||'—';
    const pl=meta[2]?.querySelector('b')?.textContent?.trim()||'—';
    return {symbol,tradeId,side,volume,entry,current,pl};
  }

  function ensureModal(){
    if(document.getElementById('slTpModal'))return;
    const modal=document.createElement('div');
    modal.id='slTpModal';
    modal.className='trade-modal hidden';
    modal.innerHTML=`
      <div class="trade-modal-backdrop" data-modal-close></div>
      <div class="trade-modal-card" role="dialog" aria-modal="true" aria-labelledby="slTpTitle">
        <div class="trade-modal-head">
          <div><span class="trade-modal-kicker">MODIFY POSITION</span><h3 id="slTpTitle">SL / TP</h3></div>
          <button type="button" class="trade-modal-x" data-modal-close aria-label="Close">×</button>
        </div>
        <div class="trade-modal-summary">
          <div><span>PAIR</span><b id="modSymbol">—</b></div>
          <div><span>ORDER ID</span><b id="modTradeId">—</b></div>
          <div><span>DIRECTION</span><b id="modSide">—</b></div>
          <div><span>LOT SIZE</span><b id="modVolume">—</b></div>
          <div><span>ENTRY PRICE</span><b id="modEntry">—</b></div>
        </div>
        <div class="trade-modal-fields">
          <label class="mod-field sl-field"><span>STOP LOSS</span><input id="modSL" type="number" step="any" placeholder="Enter SL"></label>
          <label class="mod-field tp-field"><span>TAKE PROFIT</span><input id="modTP" type="number" step="any" placeholder="Enter TP"></label>
        </div>
        <div id="modError" class="trade-modal-error hidden"></div>
        <button id="modSave" type="button" class="modify-primary">MODIFY POSITION</button>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-modal-close]').forEach(x=>x.addEventListener('click',closeModal));
    document.getElementById('modSave').addEventListener('click',saveModify);
  }

  let activeId='';
  function closeModal(){
    const modal=document.getElementById('slTpModal');
    modal?.classList.add('hidden');
    activeId='';
  }

  async function openModal(id){
    ensureModal();
    const card=[...document.querySelectorAll('#tradeScroll .trade-card')].find(x=>x.dataset.tradeId===id);
    if(!card)return;
    const d=readCard(card); activeId=id;
    document.getElementById('modSymbol').textContent=d.symbol;
    document.getElementById('modTradeId').textContent=d.tradeId;
    document.getElementById('modSide').textContent=d.side;
    document.getElementById('modSide').className=d.side==='SELL'?'mod-sell':'mod-buy';
    document.getElementById('modVolume').textContent=d.volume;
    document.getElementById('modEntry').textContent=d.entry;
    document.getElementById('modSL').value='';
    document.getElementById('modTP').value='';
    const err=document.getElementById('modError'); err.classList.add('hidden'); err.textContent='';
    document.getElementById('slTpModal').classList.remove('hidden');
    document.getElementById('modSL').focus();

    // Pull the current position values so the combined editor can modify both at once.
    try{
      const account=document.getElementById('accountCode')?.textContent?.trim();
      if(account && window.api){
        const result=await window.api('/api/trade/get?account_code='+encodeURIComponent(account));
        const trade=(Array.isArray(result.trades)?result.trades:[]).find(t=>String(t.trade_id)===String(id));
        if(trade){
          if(trade.stop_loss!=null)document.getElementById('modSL').value=trade.stop_loss;
          if(trade.take_profit!=null)document.getElementById('modTP').value=trade.take_profit;
        }
      }
    }catch(e){
      // Existing trade remains editable even if the optional prefill request fails.
    }
  }

  async function saveModify(){
    if(!activeId||!window.api)return;
    const slRaw=document.getElementById('modSL').value.trim();
    const tpRaw=document.getElementById('modTP').value.trim();
    const sl=slRaw===''?null:Number(slRaw);
    const tp=tpRaw===''?null:Number(tpRaw);
    const error=document.getElementById('modError');
    if(sl!==null&&!Number.isFinite(sl)||tp!==null&&!Number.isFinite(tp)){
      error.textContent='Please enter valid SL / TP prices.';error.classList.remove('hidden');return;
    }
    const button=document.getElementById('modSave');
    button.disabled=true;button.textContent='UPDATING…';error.classList.add('hidden');
    try{
      await window.api('/api/trades/'+encodeURIComponent(activeId),{method:'PATCH',body:JSON.stringify({stop_loss:sl,take_profit:tp})});
      closeModal();
      if(window.toast)window.toast('SL / TP updated');
      if(typeof window.loadTrades==='function')await window.loadTrades();
    }catch(e){
      error.textContent=e.message||'Unable to modify position.';error.classList.remove('hidden');
    }finally{
      button.disabled=false;button.textContent='MODIFY POSITION';
    }
  }

  window.modifyTrade=openModal;
  window.renderTrades=function(){
    originalRenderTrades();
    const box=document.getElementById('tradeScroll');
    if(!box)return;

    // The legacy renderer intentionally showed the latest trade when no OPEN trade existed.
    // Remove that fallback so a closed position never remains visible in the Open tab.
    const count=Number(document.getElementById('tradeCount')?.textContent||0);
    const openTab=document.querySelector('.right-tab.active')?.dataset.tab==='OPEN';
    if(openTab && count===0){
      box.innerHTML='<div class="empty"><strong>No open trades</strong><span>Open positions for this account will appear here.</span></div>';
      return;
    }

    box.querySelectorAll('.trade-card').forEach(card=>{
      const d=readCard(card);
      const closeButton=card.querySelector('[data-close]');
      const modButton=card.querySelector('[data-mod]');
      const pendingButton=card.querySelector('[data-cancel]');
      const tradeId=modButton?.dataset.mod||closeButton?.dataset.close||pendingButton?.dataset.cancel||d.tradeId;
      card.dataset.tradeId=tradeId;
      card.classList.add('premium-trade-card');

      if(!modButton && !closeButton && !pendingButton)return;
      if(!modButton)return;

      // Open-position layout: pair + direction/lot on one line, compact order ID below,
      // entry row with SL/TP action beside it, then current price and P/L.
      const buttons=card.querySelector('.trade-buttons');
      const closeHtml=closeButton?closeButton.outerHTML:'';
      const modHtml=modButton?'<button class="mini premium-sltp" data-mod="'+esc(tradeId)+'">SL / TP</button>':'';
      card.innerHTML=`
        <div class="premium-trade-head">
          <div class="premium-pair-block">
            <div class="premium-pair-row"><b>${esc(d.symbol)}</b><span class="premium-direction ${d.side==='SELL'?'sell':''}">${esc(d.side)}</span><span class="premium-lot">${esc(d.volume)} LOT</span></div>
            <small>ORDER ID · ${esc(d.tradeId)}</small>
          </div>
        </div>
        <div class="premium-entry-row"><div><span>ENTRY PRICE</span><b>${esc(d.entry)}</b></div><div class="premium-entry-action">${modHtml}</div></div>
        <div class="premium-live-row"><div><span>CURRENT</span><b>${esc(d.current)}</b></div><div class="premium-pnl ${/^-/.test(d.pl)?'negative':'positive'}"><span>P / L</span><b>${esc(d.pl)}</b></div></div>
        <div class="trade-buttons premium-buttons">${closeHtml}</div>`;
      card.querySelector('[data-mod]')?.addEventListener('click',()=>openModal(tradeId));
    });
  };

  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
})();
