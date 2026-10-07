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
      var sorted = txs.slice().sort(function(a,b){ return new Date(a.tx_date) - new Date(b.tx_date); });
      if(sorted.length >= 1){
        var points = [{ x: 0, y: 0 }];
        var balance = 0;
        for(var k = 0; k < sorted.length; k++){
          var amt2 = (Number(sorted[k].amount_cents) || 0) / 100;
          if(sorted[k].tx_type === 'DEPOSIT') balance = balance + amt2;
          if(sorted[k].tx_type === 'WITHDRAWAL') balance = balance - amt2;
          points.push({ x: k + 1, y: balance });
        }
        var maxY = 0;
        var minY = 0;
        for(var p = 0; p < points.length; p++){
          if(points[p].y > maxY) maxY = points[p].y;
          if(points[p].y < minY) minY = points[p].y;
        }
        if(maxY === 0 && minY === 0) maxY = 1;
        var W = 500;
        var H = 140;
        var padL = 8;
        var padR = 8;
        var padT = 14;
        var padB = 14;
        var chartW = W - padL - padR;
        var chartH = H - padT - padB;
        var range = maxY - minY;
        if(range === 0) range = 1;
        var pathParts = [];
        for(var q = 0; q < points.length; q++){
          var px = padL + (q / (points.length - 1)) * chartW;
          var py = padT + chartH - ((points[q].y - minY) / range) * chartH;
          pathParts.push((q === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1));
        }
        var linePath = pathParts.join(' ');
        var lastX = padL + chartW;
        var lastY = padT + chartH - ((balance - minY) / range) * chartH;
        var areaPath = linePath + ' L' + lastX.toFixed(1) + ' ' + (padT + chartH).toFixed(1) + ' L' + padL.toFixed(1) + ' ' + (padT + chartH).toFixed(1) + ' Z';
        m += '<div style="margin-top:14px">';
        m += '<div style="display:flex;justify-content:space-between;font-size:10px;color:#64748B;letter-spacing:.05em;margin-bottom:6px"><span>EQUITY CURVE</span><span>$' + balance.toFixed(0) + '</span></div>';
        m += '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;background:#F8F9FB;border-radius:10px;border:1px solid #E8EBF0">';
        m += '<defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10B981" stop-opacity="0.28"/><stop offset="100%" stop-color="#10B981" stop-opacity="0"/></linearGradient></defs>';
        m += '<path d="' + areaPath + '" fill="url(#eqGrad)"/>';
        m += '<path d="' + linePath + '" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
        m += '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="4" fill="#10B981"/>';
        m += '<text x="' + (padL + 4) + '" y="' + (padT + 10) + '" font-size="10" fill="#94A3B8" font-family="Inter,sans-serif">$' + maxY.toFixed(0) + '</text>';
        m += '<text x="' + (padL + 4) + '" y="' + (padT + chartH - 2) + '" font-size="10" fill="#94A3B8" font-family="Inter,sans-serif">$' + minY.toFixed(0) + '</text>';
        m += '</svg>';
        m += '</div>';
      }
      el.innerHTML = m;
    })
    .catch(function(){
      el.textContent = '';
    });
};