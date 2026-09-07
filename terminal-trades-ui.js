'use strict';

// FundFXT premium open-position cards + combined SL/TP editor.
// This layer enhances the existing trade renderer without changing execution APIs.
(function(){
  const originalRenderTrades=window.renderTrades;
  if(typeof originalRenderTrades!=='function')return;

  const API='https://fundfxt.onrender.com';
  const token=localStorage.getItem('fundfxt_token');
  const request=async(path,opt={})=>{
    const r=await fetch(API+path,{...opt,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(opt.headers||{})}});
    let d={};try{d=await r.json()}catch{}
    if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);
    return d;
  };

  function esc(v){return String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m));}
  function readCard(card){
    const top=card.querySelector('.trade-top');
    const meta=[...card.querySelectorAll('.trade-meta>div')];
    const symbol=top?.querySelector('b')?.textContent?.trim()||'—';
    const tradeId=top?.querySelector('small')?.textContent?.trim()||'Position';
    const sideText=top?.querySelector('.side')?.textContent?.trim()||'';
    const parts=sideText.split('·').map(x=>x.trim());
    return {symbol,tradeId,side:parts[0]||'BUY',volume:parts[1]||'—',entry:meta[0]?.querySelector('b')?.textContent?.trim()||'—',current:meta[1]?.querySelector('b')?.textContent?.trim()||'—',pl:meta[2]?.querySelector('b')?.textContent?.trim()||'—'};
  }

  function ensureModal(){
    if(document.getElementById('slTpModal'))return;
    const modal=document.createElement('div');modal.id='slTpModal';modal.className='trade-modal hidden';
    modal.innerHTML=`
      <div class="trade-modal-backdrop" data-modal-close></div>
      <div class="trade-modal-card" role="dialog" aria-modal="true" aria-labelledby="slTpTitle">
        <div class="trade-modal-head">
          <div><span class="trade-modal-kicker">POSITION MANAGEMENT</span><h3 id="slTpTitle">Modify SL / TP</h3></div>
          <button type="button" class="trade-modal-x" data-modal-close aria-label="Close">×</button>
        </div>
        <div class="trade-modal-summary">
          <div><span>PAIR</span><b id="modSymbol">—</b></div>
          <div><span>ORDER ID</span><b id="modTradeId">—</b></div>
          <div><span>DIRECTION</span><b id="modSide">—</b></div>
          <div><span>LOT SIZE</span><b id="modVolume">—</b></div>
          <div><span>ENTRY PRICE</span><b id="modEntry">—</b></div>
        </div>
        <div class="existing-risk hidden" id="existingRisk">
          <div><span>PREVIOUS SL</span><b id="previousSL">Not set</b></div>
          <div><span>PREVIOUS TP</span><b id="previousTP">Not set</b></div>
        </div>
        <div class="trade-modal-fields">
          <label class="mod-field sl-field"><span>STOP LOSS</span><input id="modSL" type="number" step="any" placeholder="Enter SL"></label>
          <label class="mod-field tp-field"><span>TAKE PROFIT</span><input id="modTP" type="number" step="any" placeholder="Enter TP"></label>
        </div>
        <div id="modHint" class="trade-modal-hint hidden"></div>
        <div id="modError" class="trade-modal-error hidden"></div>
        <button id="modSave" type="button" class="modify-primary">MODIFY POSITION</button>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-modal-close]').forEach(x=>x.addEventListener('click',closeModal));
    document.getElementById('modSave').addEventListener('click',saveModify);
  }

  let activeId='';
  function closeModal(){document.getElementById('slTpModal')?.classList.add('hidden');activeId=''}

  async function openModal(id){
    ensureModal();
    const card=[...document.querySelectorAll('#tradeScroll .trade-card')].find(x=>x.dataset.tradeId===id);
    if(!card)return;
    const d=readCard(card);activeId=id;
    document.getElementById('modSymbol').textContent=d.symbol;
    document.getElementById('modTradeId').textContent=d.tradeId;
    const sideEl=document.getElementById('modSide');sideEl.textContent=d.side;sideEl.className=d.side==='SELL'?'mod-sell':'mod-buy';
    document.getElementById('modVolume').textContent=d.volume;
    document.getElementById('modEntry').textContent=d.entry;
    document.getElementById('modSL').value='';document.getElementById('modTP').value='';
    document.getElementById('modSave').textContent='MODIFY POSITION';
    document.getElementById('modSave').disabled=false;
    document.getElementById('existingRisk').classList.add('hidden');
    document.getElementById('modHint').classList.add('hidden');
    const err=document.getElementById('modError');err.classList.add('hidden');err.textContent='';
    document.getElementById('slTpModal').classList.remove('hidden');

    try{
      const account=document.getElementById('accountCode')?.textContent?.trim();
      if(!account)throw Error('Trading account unavailable');
      const result=await request('/api/trade/get?account_code='+encodeURIComponent(account));
      const trade=(Array.isArray(result.trades)?result.trades:[]).find(t=>String(t.trade_id)===String(id));
      if(trade){
        const prevSL=trade.stop_loss!=null&&trade.stop_loss!==''?trade.stop_loss:null;
        const prevTP=trade.take_profit!=null&&trade.take_profit!==''?trade.take_profit:null;
        const existing=document.getElementById('existingRisk');
        document.getElementById('previousSL').textContent=prevSL!=null?prevSL:'Not set';
        document.getElementById('previousTP').textContent=prevTP!=null?prevTP:'Not set';
        if(prevSL!=null)document.getElementById('modSL').value=prevSL;
        if(prevTP!=null)document.getElementById('modTP').value=prevTP;
        if(prevSL!=null||prevTP!=null){
          existing.classList.remove('hidden');
          document.getElementById('modHint').textContent='Existing protection loaded. Change either value or both, then save a re-modification.';
          document.getElementById('modHint').classList.remove('hidden');
          document.getElementById('modSave').textContent='RE-MODIFY & SAVE';
        }
      }
    }catch(e){
      document.getElementById('modHint').textContent='Current SL / TP could not be preloaded. You can still enter both values manually.';
      document.getElementById('modHint').classList.remove('hidden');
    }
    document.getElementById('modSL').focus();
  }

  async function saveModify(){
    if(!activeId)return;
    const slRaw=document.getElementById('modSL').value.trim(),tpRaw=document.getElementById('modTP').value.trim();
    const sl=slRaw===''?null:Number(slRaw),tp=tpRaw===''?null:Number(tpRaw),error=document.getElementById('modError');
    if((sl!==null&&!Number.isFinite(sl))||(tp!==null&&!Number.isFinite(tp))){error.textContent='Please enter valid SL / TP prices.';error.classList.remove('hidden');return}
    const button=document.getElementById('modSave');button.disabled=true;button.textContent='SAVING…';error.classList.add('hidden');
    try{
      await request('/api/trades/'+encodeURIComponent(activeId),{method:'PATCH',body:JSON.stringify({stop_loss:sl,take_profit:tp})});
      closeModal();
      if(window.toast)window.toast('SL / TP updated successfully');
      if(typeof window.loadTrades==='function')await window.loadTrades();
    }catch(e){error.textContent=e.message||'Unable to modify position.';error.classList.remove('hidden')}
    finally{button.disabled=false;button.textContent='MODIFY POSITION'}
  }

  window.modifyTrade=openModal;
  window.renderTrades=function(){
    originalRenderTrades();
    const box=document.getElementById('tradeScroll');if(!box)return;
    const count=Number(document.getElementById('tradeCount')?.textContent||0);
    const openTab=document.querySelector('.right-tab.active')?.dataset.tab==='OPEN';
    if(openTab&&count===0){box.innerHTML='<div class="empty"><strong>No open trades</strong><span>Open positions for this account will appear here.</span></div>';return}
    box.querySelectorAll('.trade-card').forEach(card=>{
      const d=readCard(card),closeButton=card.querySelector('[data-close]'),modButton=card.querySelector('[data-mod]'),pendingButton=card.querySelector('[data-cancel]');
      const tradeId=modButton?.dataset.mod||closeButton?.dataset.close||pendingButton?.dataset.cancel||d.tradeId;card.dataset.tradeId=tradeId;card.classList.add('premium-trade-card');
      if(!modButton&&!closeButton&&!pendingButton)return;if(!modButton)return;
      const closeHtml=closeButton?closeButton.outerHTML:'';
      card.innerHTML=`
        <div class="premium-trade-head"><div class="premium-pair-block">
          <div class="premium-pair-row"><b>${esc(d.symbol)}</b><span class="premium-direction ${d.side==='SELL'?'sell':''}">${esc(d.side)}</span><span class="premium-lot">${esc(d.volume)} LOT</span></div>
          <small>ORDER ID · ${esc(d.tradeId)}</small>
        </div></div>
        <div class="premium-entry-row"><div><span>ENTRY PRICE</span><b>${esc(d.entry)}</b></div><div class="premium-entry-action"><button class="mini premium-sltp" data-mod="${esc(tradeId)}">SL / TP</button></div></div>
        <div class="premium-live-row"><div><span>CURRENT</span><b>${esc(d.current)}</b></div><div class="premium-pnl ${/^-/.test(d.pl)?'negative':'positive'}"><span>P / L</span><b>${esc(d.pl)}</b></div></div>
        <div class="trade-buttons premium-buttons">${closeHtml}</div>`;
      card.querySelector('[data-mod]')?.addEventListener('click',()=>openModal(tradeId));
    });
  };
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
})();
