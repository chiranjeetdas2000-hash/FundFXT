'use strict';
// FundFXT: TradingView reloads only when the selected symbol or timeframe changes.
// BiQuote price polling continues independently without recreating the chart iframe.
(function(){
  const originalLoadTV=window.loadTV;
  if(typeof originalLoadTV!=='function')return;

  let lastKey='';
  window.loadTV=function(){
    const symbol=(document.getElementById('selectedSymbol')?.textContent||'EURUSD').trim().toUpperCase();
    const interval=document.querySelector('.tf.active')?.dataset.interval||'15';
    const key=`${symbol}|${interval}`;

    if(key===lastKey && document.querySelector('#tv iframe'))return;
    lastKey=key;
    originalLoadTV();
  };
})();
