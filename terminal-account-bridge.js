'use strict';
// Keep the terminal on the same account selected by the dashboard/account menu.
// Older links may use ?account=..., while terminal.js reads ?account_code=....
(function(){
  try{
    const u=new URL(location.href);
    const code=u.searchParams.get('account_code')||u.searchParams.get('account')||localStorage.getItem('fundfxt_selected_account');
    if(code){
      localStorage.setItem('fundfxt_selected_account',code);
      if(!u.searchParams.get('account_code')){
        u.searchParams.set('account_code',code);
        u.searchParams.delete('account');
        history.replaceState(null,'',u.pathname+'?'+u.searchParams.toString()+u.hash);
      }
    }
  }catch(e){console.warn('FundFXT account link bridge failed',e)}
})();
