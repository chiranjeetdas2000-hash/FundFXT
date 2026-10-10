(function(){
  'use strict';
  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('tid_token');
  if(!token){ location.href = '/tradersid/login.html'; return; }

  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function fmtDate(s){ if(!s) return '—'; try { return new Date(s).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}); } catch(_) { return '—'; } }
  function fmtDateTime(s){ if(!s) return '—'; try { return new Date(s).toLocaleString('en-IN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch(_) { return '—'; } }
  function fmtMoney(cents){ var n = Number(cents || 0) / 100; if(n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'; if(n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; return '$' + n.toFixed(0); }

  var params = new URLSearchParams(location.search);
  var accountId = params.get('id');
  if(!accountId){ $('account-content').innerHTML = '<div class="empty"><div class="empty-title">No account ID</div><div class="empty-text">Please navigate from the Accounts page.</div></div>'; return; }

  function loadAccount(){
    fetch(API + '/api/tid/accounts/' + accountId, {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success || !d.account){ throw new Error('Account not found'); }
        renderAccount(d.account);
      })
      .catch(function(e){
        $('account-content').innerHTML = '<div class="empty"><div class="empty-title">Unable to load account</div><div class="empty-text">' + esc(e.message) + '</div></div>';
      });
  }

  function renderAccount(a){
    var el = $('account-content');
    var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
    var name = isBroker ? (a.broker_name || 'Broker') : (a.firm_name || 'Firm');
    var score = Number(a.account_score) || 0;
    var arcLen = Math.round((score / 100) * 289);
    var isVerified = String(a.verification_status || '').toUpperCase() === 'VERIFIED';
    var initials = name.substring(0, 2).toUpperCase();
    var sub;
    if(isBroker){
      var mode = String(a.broker_account_mode || '').toUpperCase() === 'DEMO' ? 'Demo' : 'Real';
      sub = 'ID: ' + (a.broker_account_id || '—') + ' · ' + mode;
    } else {
      sub = '$' + ((Number(a.account_size_cents) || 0) / 100).toLocaleString('en-US') + ' · ' + (a.account_type || '—');
    }
    var rankLabel = isVerified ? '★ VERIFIED' : (isBroker ? '● BROKER' : '● CHALLENGE');

    var h = '';
    h += '<div style="margin-bottom:14px"><a href="/tradersid/dashboard.html#accounts" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#64748B;text-decoration:none">← Back to Accounts</a></div>';
    h += '<div class="hero">';
    h += '<div class="hero-inner">';
    h += '<div class="hero-avatar">' + esc(initials) + '</div>';
    h += '<div>';
    h += '<h1 class="hero-name">' + esc(name) + '</h1>';
    h += '<div class="hero-rank">' + esc(rankLabel) + '</div>';
    h += '<div class="hero-meta">';
    h += '<div class="hero-meta-item"><span class="hero-meta-label">Account</span><span class="hero-meta-value">' + esc(sub) + '</span></div>';
    h += '<div class="hero-meta-item"><span class="hero-meta-label">Type</span><span class="hero-meta-value">' + esc(isBroker ? 'Broker' : 'Prop Firm') + '</span></div>';
    h += '<div class="hero-meta-item"><span class="hero-meta-label">Status</span><span class="hero-meta-value">' + esc(isVerified ? 'Verified' : 'Not Verified') + '</span></div>';
    h += '</div></div>';
    h += '<div class="hero-score">';
    h += '<div class="score-ring">';
    h += '<svg width="110" height="110" viewBox="0 0 110 110"><circle class="score-ring-track" cx="55" cy="55" r="46"/><circle class="score-ring-bar" cx="55" cy="55" r="46" stroke-dasharray="' + arcLen + ' 289"/></svg>';
    h += '<div class="score-val">' + score + '</div>';
    h += '</div>';
    h += '<div class="score-label">Account Score</div>';
    h += '</div>';
    h += '</div></div>';
    h += '<div id="acctStatsWrap"></div>';
    h += '<div id="acctChartsWrap"></div>';
    h += '<div id="acctMoneyWrap"></div>';
    h += '<div id="acctTradesWrap"></div>';
    h += '<div id="acctTxWrap"></div>';

    el.innerHTML = h;
    renderAcctStats(a);
    renderAcctCharts(a);
    renderAcctMoney(a);
  }

  function renderAcctStats(a){
    var wrap = $('acctStatsWrap');
    if(!wrap) return;
    var totalTrades = Number(a.total_trades) || 0;
    var totalWins = Number(a.total_wins) || 0;
    var totalLosses = Number(a.total_losses) || 0;
    var winRateBps = Number(a.win_rate_bps) || 0;
    var winRate = (winRateBps / 100).toFixed(0);
    var totalPips = Number(a.total_pips) || 0;
    var pipsColor = totalPips >= 0 ? '#00b56a' : '#DC2626';
    var pipsSign = totalPips >= 0 ? '+' : '';
    var h = '';
    h += '<div class="stat-grid" style="margin-top:20px">';
    h += '<div class="stat"><div class="stat-icon">▦</div><div class="stat-label">Total Trades</div><div class="stat-value">' + totalTrades + '</div></div>';
    h += '<div class="stat"><div class="stat-icon green">✓</div><div class="stat-label">Win Rate</div><div class="stat-value">' + winRate + '%</div></div>';
    h += '<div class="stat"><div class="stat-icon gold">◆</div><div class="stat-label">Wins / Losses</div><div class="stat-value" style="font-size:20px">' + totalWins + 'W / ' + totalLosses + 'L</div></div>';
    h += '<div class="stat"><div class="stat-icon" style="background:rgba(0,181,106,.10);color:' + pipsColor + '">▲</div><div class="stat-label">Net Pips</div><div class="stat-value" style="color:' + pipsColor + '">' + pipsSign + totalPips.toFixed(0) + '</div></div>';
    h += '</div>';
    wrap.innerHTML = h;
  }

  function renderAcctCharts(a){
    var wrap = $('acctChartsWrap');
    if(!wrap) return;
    var totalTrades = Number(a.total_trades) || 0;
    var totalWins = Number(a.total_wins) || 0;
    var totalLosses = Number(a.total_losses) || 0;
    if(totalTrades === 0){
      wrap.innerHTML = '<div class="card" style="margin-top:20px"><div class="card-head"><div class="card-title">Performance</div><div class="card-sub">No trades yet</div></div><div class="chart-empty">Trade data will appear here once trades are recorded.</div></div>';
      return;
    }
    var h = '';
    h += '<div class="grid-2" style="margin-top:20px">';
    h += '<div class="card"><div class="card-head"><div class="card-title">Lifetime Performance</div><div class="card-sub">Cumulative pips</div></div><div class="chart-wrap"><canvas id="acctEquityChart"></canvas></div></div>';
    h += '<div class="card"><div class="card-head"><div class="card-title">Win / Loss</div><div class="card-sub">' + totalWins + 'W · ' + totalLosses + 'L</div></div><div class="chart-wrap"><canvas id="acctWlChart"></canvas></div></div>';
    h += '</div>';
    wrap.innerHTML = h;
    fetch(API + '/api/tid/me/snapshots', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        var snaps = (d && Array.isArray(d.snapshots)) ? d.snapshots : [];
        var mine = snaps.filter(function(s){ return String(s.account_id) === String(accountId); });
        mine.sort(function(x,y){
          return String(x.snapshot_date || '').localeCompare(String(y.snapshot_date || ''));
        });
        var labels = ['Start'];
        var pips = [0];
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var count = 0;
        mine.forEach(function(s){
          count++;
          var v = Number(s.cumulative_pips) || 0;
          var dt = s.snapshot_date ? String(s.snapshot_date).substring(0,10) : '';
          var lb = 'T' + count;
          try {
            var dd = new Date(dt + 'T00:00:00Z');
            if(!isNaN(dd.getTime()) && dd.getFullYear() > 2000){
              lb = dd.getDate() + ' ' + months[dd.getMonth()];
            }
          } catch(_){}
          labels.push(lb);
          pips.push(v);
        });
        var eq = $('acctEquityChart');
        if(eq){
          var ctx = eq.getContext('2d');
          var grad = ctx.createLinearGradient(0,0,0,220);
          grad.addColorStop(0,'rgba(37,99,235,.28)');
          grad.addColorStop(1,'rgba(37,99,235,0)');
          new Chart(ctx, {
            type:'line',
            data:{ labels:labels, datasets:[{ label:'Cumulative Pips', data:pips, borderColor:'#2563EB', backgroundColor:grad, fill:true, borderWidth:2.4, tension:.35, pointRadius:0 }] },
            options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false }, ticks:{ color:'#94A3B8', font:{size:10,family:'Inter'}, maxTicksLimit:8 } }, y:{ grid:{ color:'#E8EBF0' }, ticks:{ color:'#94A3B8', font:{size:10,family:'Inter'} } } } }
          });
        }
        var wl = $('acctWlChart');
        if(wl){
          new Chart(wl.getContext('2d'), {
            type:'doughnut',
            data:{ labels:['Wins','Losses'], datasets:[{ data:[totalWins, totalLosses], backgroundColor:['#00b56a','#E8EBF0'], borderWidth:0, hoverOffset:4 }] },
            options:{ responsive:true, maintainAspectRatio:false, cutout:'68%', plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, boxHeight:10, font:{size:11,family:'Inter'}, color:'#64748B', padding:12 } } } }
          });
        }
      })
      .catch(function(){
        var eq = $('acctEquityChart');
        if(eq){ eq.parentNode.innerHTML = '<div class="chart-empty">Unable to load trade data.</div>'; }
      });
  }

  function renderAcctMoney(a){
    var wrap = $('acctMoneyWrap');
    if(!wrap) return;
    var dep = Number(a.total_deposit_cents) || 0;
    var wd = Number(a.total_withdrawal_cents) || 0;
    var net = dep - wd;
    var netColor = net >= 0 ? '#00b56a' : '#DC2626';
    var netSign = net >= 0 ? '+' : '-';
    var avgWin = Number(a.avg_win_pips) || 0;
    var avgLoss = Number(a.avg_loss_pips) || 0;
    var rr = Number(a.avg_rr) || 0;
    var best = Number(a.best_trade_pips) || 0;
    var worst = Number(a.worst_trade_pips) || 0;
    var cons = Number(a.consistency_score) || 0;
    var h = '';
    h += '<div class="grid-2-eq" style="margin-top:20px">';
    h += '<div class="card"><div class="card-head"><div class="card-title">Money Flow</div><div class="card-sub">Deposits &amp; withdrawals</div></div>';
    h += '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0">';
    h += '<div class="stat"><div class="stat-icon green">↓</div><div class="stat-label">Deposited</div><div class="stat-value" style="font-size:20px">' + fmtMoney(dep) + '</div></div>';
    h += '<div class="stat"><div class="stat-icon red">↑</div><div class="stat-label">Withdrawn</div><div class="stat-value" style="font-size:20px">' + fmtMoney(wd) + '</div></div>';
    h += '<div class="stat"><div class="stat-icon">◆</div><div class="stat-label">Net Balance</div><div class="stat-value" style="font-size:20px;color:' + netColor + '">' + netSign + fmtMoney(Math.abs(net)) + '</div></div>';
    h += '</div>';
    h += '<div class="stat-foot" id="acctMoneyMeta" style="margin-top:12px">Loading transaction dates…</div>';
    h += '</div>';
    h += '<div class="card"><div class="card-head"><div class="card-title">Pips Analysis</div><div class="card-sub">Trade quality metrics</div></div>';
    h += '<div class="stat-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:0">';
    h += '<div class="stat"><div class="stat-icon green">✓</div><div class="stat-label">Avg Win</div><div class="stat-value" style="font-size:20px;color:#00b56a">+' + avgWin.toFixed(1) + '</div></div>';
    h += '<div class="stat"><div class="stat-icon red">✗</div><div class="stat-label">Avg Loss</div><div class="stat-value" style="font-size:20px;color:#DC2626">-' + avgLoss.toFixed(1) + '</div></div>';
    h += '<div class="stat"><div class="stat-icon gold">◆</div><div class="stat-label">R : R Ratio</div><div class="stat-value" style="font-size:20px">1 : ' + rr.toFixed(2) + '</div></div>';
    h += '<div class="stat"><div class="stat-icon">▦</div><div class="stat-label">Consistency</div><div class="stat-value" style="font-size:20px">' + cons + '%</div></div>';
    h += '</div>';
    h += '<div style="display:flex;justify-content:space-between;gap:12px;margin-top:12px;font-size:12px;color:#64748B">';
    h += '<span><b style="color:#00b56a">Best:</b> +' + best.toFixed(1) + ' pips</span>';
    h += '<span><b style="color:#DC2626">Worst:</b> ' + worst.toFixed(1) + ' pips</span>';
    h += '</div>';
    h += '</div>';
    h += '</div>';
    wrap.innerHTML = h;
    fetch(API + '/api/tid/accounts/' + accountId + '/transactions', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        var meta = $('acctMoneyMeta');
        if(!meta) return;
        var rows = (d && Array.isArray(d.transactions)) ? d.transactions : [];
        if(!rows.length){ meta.textContent = 'No transaction dates recorded.'; return; }
        rows.sort(function(x, y){ return String(y.tx_date || y.created_at || '').localeCompare(String(x.tx_date || x.created_at || '')); });
        var latest = rows[0];
        var latestType = String(latest.tx_type || '').toUpperCase();
        var latestLabel = latestType === 'DEPOSIT' ? 'Deposit' : (latestType === 'WITHDRAWAL' ? 'Withdrawal' : 'Adjustment');
        var latestAmt = fmtMoney(Math.abs(Number(latest.amount_cents) || 0));
        var latestDate = fmtDate(latest.tx_date || latest.created_at);
        meta.innerHTML = 'Latest: <b>' + esc(latestLabel) + '</b> ' + latestAmt + ' · ' + esc(latestDate);
      })
      .catch(function(){
        var meta = $('acctMoneyMeta');
        if(meta) meta.textContent = 'Unable to load transaction dates.';
      });
  }

  // Sidebar nav (redirect to dashboard with section)
  document.querySelectorAll('.side-link[data-section]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var s = this.getAttribute('data-section');
      location.href = '/tradersid/dashboard.html#' + s;
    });
  });

  // Logout
  function logout(){
    localStorage.removeItem('tid_token');
    localStorage.removeItem('tid_user');
    location.href = '/tradersid/login.html';
  }
  var lb = $('logoutBtn'); if(lb) lb.addEventListener('click', logout);
  var lbt = $('logoutBtnTop'); if(lbt) lbt.addEventListener('click', logout);
  var lbm = $('logoutBtnMobile'); if(lbm) lbm.addEventListener('click', logout);

  loadAccount();
})();