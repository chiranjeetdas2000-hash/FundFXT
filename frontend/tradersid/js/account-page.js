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