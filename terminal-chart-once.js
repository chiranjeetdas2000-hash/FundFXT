'use strict';
// FundFXT: TradingView must load only once per terminal page session.
// BiQuote price polling continues independently; it never recreates the chart iframe.
(function(){
  const originalLoadTV=window.loadTV;
  if(typeof originalLoadTV!=='function')return;
  let loaded=false;
  window.loadTV=function(){
    if(loaded)return;
    loaded=true;
    originalLoadTV();
  };
})();
