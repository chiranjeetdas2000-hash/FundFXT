'use strict';
// Keep terminal API auth in sync with the current login token and provide a direct
// BiQuote fallback for market prices if the backend price proxy is unavailable.
(function(){
  const API='https://fundfxt.onrender.com';
  const BQ='https://biquote.io/api/latest?'+['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD','EURGBP','EURJPY','EURAUD','EURCHF','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPNZD','AUDJPY','AUDNZD','AUDCAD','AUDCHF','CADJPY','CADCHF','CHFJPY','NZDJPY','NZDCHF','NZDCAD','XAUUSD','XAGUSD'].map(s=>'symbols='+encodeURIComponent(s)).join('&');
  const original=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:input?.url||'';
    const opts={...(init||{})};
    if(url.startsWith(API+'/')){
      const h=new Headers(opts.headers|| (input instanceof Request?input.headers:undefined));
      const current=localStorage.getItem('fundfxt_token')||'';
      if(current)h.set('Authorization','Bearer '+current);
      opts.headers=h;
      const response=await original(input instanceof Request?new Request(input,opts):url,opts);
      if(url===API+'/api/prices' && !response.ok){
        try{
          const r=await original(BQ,{headers:{accept:'application/json'}});
          if(r.ok){
            const body=await r.json();
            return new Response(JSON.stringify({success:true,source:'BiQuote-direct',symbols:Object.keys(body||{}),prices:body||{}}),{status:200,headers:{'Content-Type':'application/json'}});
          }
        }catch(e){console.warn('FundFXT direct BiQuote fallback failed',e)}
      }
      if((response.status===401||response.status===403)&&location.pathname.includes('terminal')){
        setTimeout(()=>{localStorage.removeItem('fundfxt_token');location.href='/login.html'},50);
      }
      return response;
    }
    return original(input,init);
  };
})();
