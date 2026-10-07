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
        var chart = window.wlChart || (typeof wlChart !== 'undefined' ? wlChart : null);
        if(chart && (totalWins + totalLosses) > 0){
          chart.data.datasets[0].data = [totalWins, totalLosses];
          chart.update();
          var wlE = $('wlEmpty');
          if(wlE) wlE.style.display = 'none';
        }
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