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
    fetch(API + '/api/tid/me/trades-timeline', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        var trades = (d && Array.isArray(d.trades)) ? d.trades : [];
        if(!trades.length) return;
        var anyProfit = false;
        var k;
        for(k = 0; k < trades.length; k++){
          if(Number(trades[k].profit_cents) !== 0){ anyProfit = true; break; }
        }
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var labels = ['Start'];
        var data = [0];
        var cumProfit = 0;
        var cumPips = 0;
        var count = 0;
        var i;
        for(i = 0; i < trades.length; i++){
          var t = trades[i];
          cumProfit += Number(t.profit_cents) || 0;
          cumPips += Number(t.pips) || 0;
          count++;
          var avgMoney = cumProfit / count / 100;
          var avgPips = cumPips / count;
          var y = anyProfit ? avgMoney : avgPips;
          var dtStr = t.closed_at || t.opened_at || null;
          var lb = 'T' + count;
          if(dtStr){
            try {
              var dd = new Date(dtStr);
              if(!isNaN(dd.getTime()) && dd.getFullYear() > 2000){
                lb = dd.getDate() + ' ' + months[dd.getMonth()];
              }
            } catch(_){}
          }
          labels.push(lb);
          data.push(Number(y.toFixed(2)));
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