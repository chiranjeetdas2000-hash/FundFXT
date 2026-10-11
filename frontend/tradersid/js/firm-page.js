(function(){
  'use strict';
  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('tid_token');
  if(!token){ location.href = '/tradersid/login.html'; return; }

  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function fmtMoney(cents){ var n = Number(cents || 0) / 100; if(n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'; if(n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; return '$' + n.toFixed(0); }
  function fmtDate(s){ if(!s) return '—'; try { return new Date(s).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}); } catch(_) { return '—'; } }

  var params = new URLSearchParams(location.search);
  var firmType = String(params.get('type') || 'PROP_FIRM').toUpperCase();
  var firmName = String(params.get('name') || '').trim();
  if(!firmName){ $('firm-content').innerHTML = '<div class="empty"><div class="empty-title">Missing firm name</div></div>'; return; }

  function getStatusMeta(a){
    var sync = String(a.platform_sync_status || 'NONE').toUpperCase();
    var st = String(a.status || '').toUpperCase();
    if(sync === 'FAILED') return { label: 'Sync Failed', cls: 'st-failed' };
    if(sync === 'SUCCESS'){
      if(st === 'BREACHED' || st === 'CLOSED') return { label: 'Synced', cls: 'st-synced' };
      return { label: 'LIVE', cls: 'st-live' };
    }
    return { label: 'Under Review', cls: 'st-review' };
  }

  function loadFirm(){
    fetch(API + '/api/tid/firms', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success || !d.rows){ throw new Error('Failed to load'); }
        var mine = d.rows.filter(function(a){
          var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
          var name = isBroker ? (a.broker_name || '') : (a.firm_name || '');
          return String(name).trim() === firmName;
        });
        if(!mine.length){
          $('firm-content').innerHTML = '<div class="empty"><div class="empty-title">Firm not found</div><div class="empty-text">' + esc(firmName) + '</div><a class="btn btn-primary" href="/tradersid/dashboard.html#accounts" style="margin-top:14px;display:inline-block">Back to Accounts</a></div>';
          return;
        }
        renderFirm(mine);
      })
      .catch(function(e){
        $('firm-content').innerHTML = '<div class="empty"><div class="empty-title">Unable to load</div><div class="empty-text">' + esc(e.message) + '</div></div>';
      });
  }

  function renderFirm(accounts){
    var el = $('firm-content');
    var i;
    var totalTrades = 0, totalWins = 0, totalLosses = 0, totalPips = 0, totalProfitCents = 0;
    var scoreSum = 0, scoreCount = 0;
    var depositCents = 0, withdrawalCents = 0;

    for(i = 0; i < accounts.length; i++){
      var a = accounts[i];
      totalTrades += Number(a.total_trades) || 0;
      totalWins += Number(a.total_wins) || 0;
      totalLosses += Number(a.total_losses) || 0;
      totalPips += Number(a.total_pips) || 0;
      depositCents += Number(a.total_deposit_cents) || 0;
      withdrawalCents += Number(a.total_withdrawal_cents) || 0;
      if((Number(a.account_score) || 0) > 0){ scoreSum += Number(a.account_score); scoreCount++; }
    }

    var avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;
    var winRate = totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100) : 0;
    var pipsColor = totalPips >= 0 ? '#10B981' : '#DC2626';
    var pipsSign = totalPips >= 0 ? '+' : '';

    var h = '';
    h += '<div style="margin-bottom:14px"><a href="/tradersid/dashboard.html#accounts" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#64748B;text-decoration:none">← Back to Accounts</a></div>';

    // Hero
    h += '<div class="hero">';
    h += '<div class="hero-inner">';
    h += '<div class="hero-avatar">' + esc(firmName.substring(0,2).toUpperCase()) + '</div>';
    h += '<div>';
    h += '<h1 class="hero-name">' + esc(firmName) + '</h1>';
    h += '<div class="hero-rank">' + (firmType === 'BROKER' ? '● BROKER' : '● PROP FIRM') + '</div>';
    h += '<div class="hero-meta">';
    h += '<div class="hero-meta-item"><span class="hero-meta-label">Accounts</span><span class="hero-meta-value">' + accounts.length + '</span></div>';
    h += '<div class="hero-meta-item"><span class="hero-meta-label">Total Trades</span><span class="hero-meta-value">' + totalTrades + '</span></div>';
    h += '<div class="hero-meta-item"><span class="hero-meta-label">Win Rate</span><span class="hero-meta-value">' + winRate + '%</span></div>';
    h += '</div></div>';
    h += '<div class="hero-score">';
    h += '<div class="score-ring">';
    h += '<svg width="110" height="110" viewBox="0 0 110 110"><circle class="score-ring-track" cx="55" cy="55" r="46"/><circle class="score-ring-bar" cx="55" cy="55" r="46" stroke-dasharray="' + Math.round((avgScore/100)*289) + ' 289"/></svg>';
    h += '<div class="score-val">' + avgScore + '</div>';
    h += '</div>';
    h += '<div class="score-label">Firm Score</div>';
    h += '</div>';
    h += '</div></div>';

    // Aggregate stats
    h += '<div class="stat-grid" style="margin-top:20px">';
    h += '<div class="stat"><div class="stat-icon">▦</div><div class="stat-label">Total Trades</div><div class="stat-value">' + totalTrades + '</div></div>';
    h += '<div class="stat"><div class="stat-icon green">✓</div><div class="stat-label">Win Rate</div><div class="stat-value">' + winRate + '%</div></div>';
    h += '<div class="stat"><div class="stat-icon gold">◆</div><div class="stat-label">Wins / Losses</div><div class="stat-value" style="font-size:20px">' + totalWins + 'W / ' + totalLosses + 'L</div></div>';
    h += '<div class="stat"><div class="stat-icon" style="background:rgba(0,181,106,.10);color:' + pipsColor + '">▲</div><div class="stat-label">Net Pips</div><div class="stat-value" style="color:' + pipsColor + '">' + pipsSign + totalPips.toFixed(0) + '</div></div>';
    h += '</div>';

    // Accounts list placeholder
    h += '<div id="firmAccountsWrap" style="margin-top:20px"></div>';

    el.innerHTML = h;
    renderAccountsList(accounts);
  }

  function renderAccountsList(accounts){
    var wrap = $('firmAccountsWrap');
    if(!wrap) return;
    var h = '';
    h += '<div class="card"><div class="card-head"><div class="card-title">Accounts</div><div class="card-sub">' + accounts.length + ' account' + (accounts.length === 1 ? '' : 's') + '</div></div>';
    h += '<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">';
    var i;
    for(i = 0; i < accounts.length; i++){
      var a = accounts[i];
      var st = getStatusMeta(a);
      var size = '$' + ((Number(a.account_size_cents) || 0) / 100).toLocaleString('en-US');
      var type = String(a.account_type || '').toUpperCase() || 'ACCOUNT';
      var wins = Number(a.total_wins) || 0;
      var losses = Number(a.total_losses) || 0;
      h += '<a href="/tradersid/account.html?id=' + a.id + '" style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid #E8EBF0;border-radius:10px;text-decoration:none;color:inherit;background:#fff" onmouseover="this.style.borderColor=\'#CBD5E1\'" onmouseout="this.style.borderColor=\'#E8EBF0\'">';
      h += '<div>';
      h += '<div style="font-weight:700;color:#0F1B2D;margin-bottom:4px">' + esc(size) + ' · ' + esc(type) + '</div>';
      h += '<div style="font-size:12px;color:#64748B">' + (Number(a.total_trades) || 0) + ' trades · ' + wins + 'W / ' + losses + 'L · ' + (Number(a.account_score) || 0) + ' score</div>';
      h += '</div>';
      h += '<span class="acct-pill ' + st.cls + '">' + esc(st.label) + '</span>';
      h += '</a>';
    }
    h += '</div></div>';
    wrap.innerHTML = h;
  }

  // Sidebar nav
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

  loadFirm();
})();