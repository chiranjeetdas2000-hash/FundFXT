(function(){
  'use strict';
  var API = 'https://fundfxt.onrender.com';

  function $(id){ return document.getElementById(id); }

  function loadStats(){
    var token = localStorage.getItem('tid_token');
    if(!token) return;
    fetch(API + '/api/tid/accounts', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success) return;
        var accounts = d.accounts || [];
        var totalWins = 0;
        var totalLosses = 0;
        var bigWin = 0;
        var bigLoss = 0;
        var i;
        for(i = 0; i < accounts.length; i++){
          var a = accounts[i];
          totalWins = totalWins + (Number(a.total_wins) || 0);
          totalLosses = totalLosses + (Number(a.total_losses) || 0);
          var bw = Number(a.biggest_win_cents) || 0;
          var bl = Number(a.biggest_loss_cents) || 0;
          if(bw > bigWin) bigWin = bw;
          if(bl > bigLoss) bigLoss = bl;
        }
        var bwEl = $('biggestWin');
        if(bwEl) bwEl.textContent = bigWin > 0 ? '+$' + (bigWin / 100).toFixed(0) : '—';
        var bwMeta = $('biggestWinMeta');
        if(bwMeta) bwMeta.textContent = bigWin > 0 ? 'Best single trade' : 'No data yet';
        var blEl = $('biggestLoss');
        if(blEl) blEl.textContent = bigLoss > 0 ? '-$' + (bigLoss / 100).toFixed(0) : '—';
        var blMeta = $('biggestLossMeta');
        if(blMeta) blMeta.textContent = bigLoss > 0 ? 'Worst single trade' : 'No data yet';
        var chart = window.wlChart || null;
        if(chart && (totalWins + totalLosses) > 0){
          chart.data.datasets[0].data = [totalWins, totalLosses];
          chart.update();
          var wlE = $('wlEmpty');
          if(wlE) wlE.style.display = 'none';
        }
        renderHomeEquity(accounts);
      })
      .catch(function(){});
  }

  function fmtMonth(dtStr){
    if(!dtStr) return null;
    try {
      var d = new Date(dtStr);
      if(isNaN(d.getTime())) return null;
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[d.getMonth()] + " '" + String(d.getFullYear()).slice(-2);
    } catch(_) { return null; }
  }

  function renderHomeEquity(accounts){
    var eq = window.equityChart || null;
    if(!eq) return;
    var token = localStorage.getItem('tid_token');
    if(!token) return;
    fetch(API + '/api/tid/me/snapshots', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        var snaps = (d && Array.isArray(d.snapshots)) ? d.snapshots : [];
        if(!snaps.length) return;
        var byDate = {};
        var i;
        for(i = 0; i < snaps.length; i++){
          var s = snaps[i];
          var dt = s.snapshot_date;
          if(!dt) continue;
          var key = String(dt).substring(0, 10);
          if(!byDate[key]){ byDate[key] = { profit: 0, pips: 0, trades: 0 }; }
          byDate[key].profit += Number(s.cumulative_profit_cents) || 0;
          byDate[key].pips += Number(s.cumulative_pips) || 0;
          byDate[key].trades += Number(s.total_trades) || 0;
        }
        var dates = Object.keys(byDate).sort();
        if(!dates.length) return;
        var anyProfit = false;
        for(i = 0; i < dates.length; i++){
          if(byDate[dates[i]].profit !== 0){ anyProfit = true; break; }
        }
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var labels = ['Start'];
        var data = [0];
        var j;
        for(j = 0; j < dates.length; j++){
          var k = dates[j];
          var bucket = byDate[k];
          var yVal = 0;
          if(bucket.trades > 0){
            yVal = anyProfit ? (bucket.profit / bucket.trades / 100) : (bucket.pips / bucket.trades);
          }
          var lb = 'T' + (j + 1);
          try {
            var dd = new Date(k + 'T00:00:00Z');
            if(!isNaN(dd.getTime()) && dd.getFullYear() > 2000){
              lb = dd.getDate() + ' ' + months[dd.getMonth()];
            }
          } catch(_){}
          labels.push(lb);
          data.push(Number(yVal.toFixed(2)));
        }
        eq.data.labels = labels;
        eq.data.datasets[0].data = labels.map(function(){ return 0; });
        eq.data.datasets[1].data = data;
        eq.data.datasets[1].label = anyProfit ? 'Avg Profit / Trade ($)' : 'Avg Pips / Trade';
        eq.update();
        var eqE = $('equityEmpty');
        if(eqE) eqE.style.display = 'none';
      })
      .catch(function(){});
  }

  window.loadDashboardTradeStats = loadStats;

  if(document.readyState === 'complete'){
    setTimeout(loadStats, 300);
  } else {
    window.addEventListener('load', function(){ setTimeout(loadStats, 300); });
  }
})();