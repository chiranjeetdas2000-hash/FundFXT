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
    el.innerHTML = '<div class="page-head"><div class="page-eyebrow">' + esc(isBroker ? 'Broker Account' : 'Prop Firm Account') + '</div><h1 class="page-title">' + esc(name) + '</h1><p class="page-sub">' + esc(a.broker_account_id || a.account_type || '') + '</p></div><div class="card"><div class="card-head"><div><div class="card-title">Account ' + esc(accountId) + '</div><div class="card-sub">Page is loading components…</div></div></div><div style="padding:20px;text-align:center;color:#94A3B8;font-size:13px">Full UI coming in next phase.</div></div>';
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