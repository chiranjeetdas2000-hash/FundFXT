window.renderAcctMoney = function(accountId){
  var el = document.getElementById('acctDetailMoney');
  if(!el) return;
  el.textContent = 'Loading...';
  var token = localStorage.getItem('tid_token');
  fetch('https://fundfxt.onrender.com/api/tid/accounts/' + accountId + '/transactions', {headers:{Authorization:'Bearer ' + token}})
    .then(function(r){ return r.json(); })
    .then(function(d){
      var txs = (d && d.transactions) || [];
      var dep = 0;
      var wd = 0;
      var i;
      for(i = 0; i < txs.length; i++){
        var amt = (Number(txs[i].amount_cents) || 0) / 100;
        if(txs[i].tx_type === 'DEPOSIT') dep = dep + amt;
        if(txs[i].tx_type === 'WITHDRAWAL') wd = wd + amt;
      }
      el.innerHTML = '<div style="margin-top:16px;display:flex;gap:10px"><div style="flex:1;background:#F8F9FB;border:1px solid #E8EBF0;border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;color:#64748B">DEPOSITED</div><div style="font-size:16px;font-weight:800;color:#10B981">$' + dep.toFixed(0) + '</div></div><div style="flex:1;background:#F8F9FB;border:1px solid #E8EBF0;border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;color:#64748B">WITHDRAWN</div><div style="font-size:16px;font-weight:800;color:#EF4444">$' + wd.toFixed(0) + '</div></div></div>';
    })
    .catch(function(){
      el.textContent = '';
    });
};