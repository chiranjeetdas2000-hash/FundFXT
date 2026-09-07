'use strict';
// FundFXT terminal API guard: keep auth current, recover market quotes directly
// from BiQuote, and load the authoritative account/trade synchronizer.
(function(){
  const API='https://fundfxt.onrender.com';
  const SYMBOLS=['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD','EURGBP','EURJPY','EURAUD','EURCHF','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPNZD','AUDJPY','AUDNZD','AUDCAD','AUDCHF','CADJPY','CADCHF','CHFJPY','NZDJPY','NZDCHF','NZDCAD','XAUUSD','XAGUSD'];
  const BQ='https://biquote.io/api/latest?'+SYMBOLS.map(s=>'symbols='+encodeURIComponent(s)).join('&');
  const original=window.fetch.bind(window);
  async function directPrices(){const r=await original(BQ,{headers:{accept:'application/json'}});if(!r.ok)throw new Error('BiQuote HTTP '+r.status);const body=await r.json();const source=body&&body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body;return source&&typeof source==='object'?source:{}}
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:input?.url||'';const opts={...(init||{})};
    if(url.startsWith(API+'/')){
      const h=new Headers(opts.headers||(input instanceof Request?input.headers:undefined));const current=localStorage.getItem('fundfxt_token')||'';if(current)h.set('Authorization','Bearer '+current);opts.headers=h;
      const response=await original(input instanceof Request?new Request(input,opts):url,opts);
      if(url===API+'/api/prices'){
        try{const payload=await response.clone().json();const backendPrices=payload?.prices&&typeof payload.prices==='object'?payload.prices:{};const backendSymbols=Array.isArray(payload?.symbols)?payload.symbols:SYMBOLS;const missing=backendSymbols.some(s=>!backendPrices[s]||!Number.isFinite(Number(backendPrices[s]?.bid))||!Number.isFinite(Number(backendPrices[s]?.ask)));if(!response.ok||missing){const direct=await directPrices();const merged={...backendPrices};for(const symbol of Object.keys(direct)){const q=direct[symbol];if(q&&Number.isFinite(Number(q.bid))&&Number.isFinite(Number(q.ask)))merged[String(symbol).toUpperCase()]=q}return new Response(JSON.stringify({success:true,source:response.ok?'BiQuote-merged':'BiQuote-direct',symbols:[...new Set([...backendSymbols,...Object.keys(merged)])],prices:merged}),{status:200,headers:{'Content-Type':'application/json'}})}}catch(e){try{const direct=await directPrices();return new Response(JSON.stringify({success:true,source:'BiQuote-direct',symbols:Object.keys(direct),prices:direct}),{status:200,headers:{'Content-Type':'application/json'}})}catch(f){console.warn('FundFXT BiQuote direct fallback failed',f)}}
      }
      if((response.status===401||response.status===403)&&location.pathname.includes('terminal'))setTimeout(()=>{localStorage.removeItem('fundfxt_token');location.href='/login.html'},50);
      return response;
    }
    return original(input,init);
  };
  function loadAuthoritativeSync(){if(document.getElementById('fundfxt-authoritative-sync'))return;const s=document.createElement('script');s.id='fundfxt-authoritative-sync';s.src='terminal-live-trade-sync.js?v=20260907-1';s.defer=true;document.head.appendChild(s)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadAuthoritativeSync,{once:true});else loadAuthoritativeSync();
})();
