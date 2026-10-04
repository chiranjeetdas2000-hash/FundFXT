(function(){
  'use strict';

  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('tid_token');

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  function toast(msg){
    var t = $('toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(function(){ t.classList.remove('show'); }, 2600);
  }

  if(!token) return;

  var acctModal = $('accountModal');
  var accountsList = $('accountsList');
  var accountsCount = $('accountsCount');
  var addAcctBtn = $('addAccountBtn');
  var acctForm = $('accountForm');

  if(!accountsList || !addAcctBtn) return;

  function openAccountModal(){
    if(!acctModal) return;
    acctModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeAccountModal(){
    if(!acctModal) return;
    acctModal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function fmtMoney(cents){
    var n = Number(cents || 0) / 100;
    if(n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if(n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K';
    return '$' + n.toFixed(0);
  }
  function fmtShortDate(s){
    if(!s) return '\u2014';
    try { return new Date(s).toLocaleDateString('en-IN', {year:'numeric', month:'short', day:'numeric'}); }
    catch(_) { return '\u2014'; }
  }
  function statusClass(s){
    var u = String(s || 'NONE').toUpperCase();
    if(u === 'VERIFIED') return 'verified';
    if(u === 'PENDING') return 'pending';
    if(u === 'REJECTED') return 'rejected';
    return 'none';
  }
  function statusLabel(s){
    var u = String(s || 'NONE').toUpperCase();
    if(u === 'VERIFIED') return 'Verified';
    if(u === 'PENDING') return 'Pending Review';
    if(u === 'REJECTED') return 'Rejected';
    return 'Not Verified';
  }

  function renderAccounts(list){
    if(!accountsList) return;
    if(!list || !list.length){
      if(accountsCount) accountsCount.textContent = '0 accounts';
      accountsList.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18v13H3z"/><path d="M3 7l3-4h12l3 4"/></svg></div><div class="empty-title">No accounts yet</div><div class="empty-text">Add your first challenge or funded account to start building your verified track record.</div></div>';
      return;
    }
    if(accountsCount) accountsCount.textContent = list.length + (list.length === 1 ? ' account' : ' accounts');
    accountsList.innerHTML = list.map(function(a){
      var cls = statusClass(a.verification_status);
      var lbl = statusLabel(a.verification_status);
      return '<div class="acct-card" data-id="' + a.id + '">' +
        '<div class="acct-head"><div><div class="acct-firm">' + esc(a.firm_name || '\u2014') + '</div><div class="acct-size">' + fmtMoney(a.account_size_cents) + ' \u00b7 ' + esc(a.account_type || '') + '</div></div>' +
        '<span class="acct-badge ' + cls + '">' + lbl + '</span></div>' +
        '<div class="acct-meta">' +
          '<div class="acct-meta-item"><b>' + (Number(a.total_trades) || 0) + '</b>Total Trades</div>' +
          '<div class="acct-meta-item"><b>' + ((Number(a.win_rate_bps) || 0) / 100).toFixed(0) + '%</b>Win Rate</div>' +
          '<div class="acct-meta-item"><b>' + fmtShortDate(a.start_date) + '</b>Started</div>' +
        '</div>' +
        '<div class="acct-actions">' +
          '<button class="btn btn-ghost acct-verify" data-id="' + a.id + '">Verify \u00b7 $2</button>' +
          '<button class="btn btn-ghost acct-delete" data-id="' + a.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var delBtns = accountsList.querySelectorAll('.acct-delete');
    for(var i = 0; i < delBtns.length; i++){
      delBtns[i].addEventListener('click', function(){
        var id = this.getAttribute('data-id');
        if(!confirm('Delete this account? This cannot be undone.')) return;
        fetch(API + '/api/tid/accounts/' + id, {method:'DELETE', headers:{Authorization:'Bearer ' + token}})
          .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
          .then(function(x){ if(!x.ok) throw new Error(x.data.error || 'Delete failed'); toast('Account deleted'); loadAccounts(); })
          .catch(function(e){ toast(e.message || 'Delete failed'); });
      });
    }
    var verBtns = accountsList.querySelectorAll('.acct-verify');
    for(var j = 0; j < verBtns.length; j++){
      verBtns[j].addEventListener('click', function(){
        toast('Verification payment ($2) coming soon');
      });
    }
  }

  function loadAccounts(){
    if(!token || !accountsList) return;
    fetch(API + '/api/tid/accounts', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){
        if(r.status === 401 || r.status === 403){
          localStorage.removeItem('tid_token');
          localStorage.removeItem('tid_user');
          window.location.href = '/tradersid/login.html';
          throw new Error('unauth');
        }
        return r.json();
      })
      .then(function(d){ if(!d.success) throw new Error(d.error || 'Load failed'); renderAccounts(d.accounts || []); })
      .catch(function(e){ if(e.message !== 'unauth' && accountsCount){ accountsCount.textContent = 'Unable to load'; } });
  }

  addAcctBtn.addEventListener('click', openAccountModal);
  var acctClose = $('accountModalClose');
  if(acctClose) acctClose.addEventListener('click', closeAccountModal);
  var acctCancel = $('accountCancel');
  if(acctCancel) acctCancel.addEventListener('click', closeAccountModal);
  if(acctModal) acctModal.addEventListener('click', function(e){ if(e.target === acctModal) closeAccountModal(); });

  if(acctForm) acctForm.addEventListener('submit', function(e){
    e.preventDefault();
    var errBox = $('acctError');
    if(errBox) errBox.classList.remove('show');
    var firmInput = $('acctFirm');
    var firm = firmInput ? firmInput.value.trim() : '';
    if(firm.length < 2){
      if(errBox){ errBox.textContent = 'Enter firm name'; errBox.classList.add('show'); }
      return;
    }
    var sizeEl = $('acctSize');
    var typeEl = $('acctType');
    var dateEl = $('acctStartDate');
    var payload = {
      firm_name: firm,
      account_size_cents: Number(sizeEl ? sizeEl.value : 0) || 0,
      account_type: typeEl ? typeEl.value : 'CHALLENGE',
      start_date: dateEl && dateEl.value ? dateEl.value : null
    };
    var submitBtn = $('accountSubmit');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

    fetch(API + '/api/tid/accounts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
      body: JSON.stringify(payload)
    })
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
      .then(function(x){
        if(!x.ok || !x.data.success) throw new Error(x.data.error || 'Create failed');
        var newId = x.data.account && x.data.account.id;
        var fileInput = $('acctFile');
        if(fileInput && fileInput.files && fileInput.files[0] && newId){
          var fd = new FormData();
          fd.append('file', fileInput.files[0]);
          fd.append('file_type', 'STATEMENT');
          fd.append('account_id', String(newId));
          fetch(API + '/api/tid/upload', {method:'POST', headers:{Authorization:'Bearer ' + token}, body: fd}).catch(function(){});
        }
        closeAccountModal();
        acctForm.reset();
        toast('Account added');
        loadAccounts();
      })
      .catch(function(err){
        if(errBox){ errBox.textContent = err.message || 'Create failed'; errBox.classList.add('show'); }
      })
      .then(function(){
        if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = 'Create Account'; }
      });
  });

  loadAccounts();
})();