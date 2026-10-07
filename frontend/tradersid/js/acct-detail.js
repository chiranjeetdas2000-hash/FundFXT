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
      var firstDep = '';
      var lastWd = '';
      var i;
      for(i = 0; i < txs.length; i++){
        var amt = (Number(txs[i].amount_cents) || 0) / 100;
        if(txs[i].tx_type === 'DEPOSIT'){ dep = dep + amt; if(!firstDep) firstDep = txs[i].tx_date; }
        if(txs[i].tx_type === 'WITHDRAWAL'){ wd = wd + amt; lastWd = txs[i].tx_date; }
      }
      var fmt = function(dt){
        if(!dt) return '—';
        try { return new Date(dt).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}); } catch(e) { return '—'; }
      };
      var m = '';
      m += '<div style="margin-top:16px;display:flex;gap:10px">';
      m += '<div style="flex:1;background:#F8F9FB;border:1px solid #E8EBF0;border-radius:10px;padding:12px;text-align:center">';
      m += '<div style="font-size:10px;color:#64748B;letter-spacing:.05em">DEPOSITED</div>';
      m += '<div style="font-size:16px;font-weight:800;color:#10B981;margin-top:2px">$' + dep.toFixed(0) + '</div>';
      m += '<div style="font-size:9.5px;color:#94A3B8;margin-top:4px">First: ' + fmt(firstDep) + '</div>';
      m += '</div>';
      m += '<div style="flex:1;background:#F8F9FB;border:1px solid #E8EBF0;border-radius:10px;padding:12px;text-align:center">';
      m += '<div style="font-size:10px;color:#64748B;letter-spacing:.05em">WITHDRAWN</div>';
      m += '<div style="font-size:16px;font-weight:800;color:#EF4444;margin-top:2px">$' + wd.toFixed(0) + '</div>';
      m += '<div style="font-size:9.5px;color:#94A3B8;margin-top:4px">Last: ' + fmt(lastWd) + '</div>';
      m += '</div>';
      m += '</div>';
      el.innerHTML = m;
    })
    .catch(function(){
      el.textContent = '';
    });
};