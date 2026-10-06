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

  var filesModal = $('filesModal');
  var filesList = $('filesList');
  var filesUploadInput = $('filesUploadInput');
  var filesUploadType = $('filesUploadType');
  var filesUploadBtn = $('filesUploadBtn');
  var filesUploadProgress = $('filesUploadProgress');
  var filesError = $('filesError');
  var filesModalTitle = $('filesModalTitle');
  var currentFileAccountId = null;

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

  function openFilesModal(accountId){
    if(!filesModal) return;
    currentFileAccountId = accountId;
    if(filesModalTitle) filesModalTitle.textContent = 'Account Files';
    if(filesError) filesError.classList.remove('show');
    if(filesUploadProgress) filesUploadProgress.style.display = 'none';
    filesModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadFiles(accountId);
  }
  function closeFilesModal(){
    if(!filesModal) return;
    filesModal.classList.remove('open');
    document.body.style.overflow = '';
    currentFileAccountId = null;
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
  function fmtBytes(b){
    var n = Number(b || 0);
    if(n < 1024) return n + ' B';
    if(n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function statusClass(s){
    var u = String(s || 'NONE').toUpperCase();
    if(u === 'VERIFIED') return 'verified';
    if(u === 'PENDING') return 'pending';
    if(u === 'REJECTED') return 'rejected';
    if(u === 'AWAITING_PAYMENT' || u === 'PAID_REQUESTED' || u === 'LINK_SENT' || u === 'PAID_PENDING') return 'pending';
    if(u === 'TRACKING_ONLY') return 'none';
    return 'none';
  }
  function statusLabel(s){
    var u = String(s || 'NONE').toUpperCase();
    if(u === 'VERIFIED') return 'Verified';
    if(u === 'PENDING') return 'Pending Review';
    if(u === 'REJECTED') return 'Rejected';
    if(u === 'AWAITING_PAYMENT') return 'Awaiting Payment';
    if(u === 'PAID_REQUESTED') return 'Request Sent';
    if(u === 'LINK_SENT') return 'Link Sent';
    if(u === 'PAID_PENDING') return 'Under Review';
    if(u === 'TRACKING_ONLY') return 'Tracking Only';
    return 'Not Verified';
  }
  function fileStatusClass(s){
    var u = String(s || 'PENDING').toUpperCase();
    if(u === 'APPROVED') return 'verified';
    if(u === 'REJECTED') return 'rejected';
    return 'pending';
  }
  function fileStatusLabel(s){
    var u = String(s || 'PENDING').toUpperCase();
    if(u === 'APPROVED') return 'Approved';
    if(u === 'REJECTED') return 'Rejected';
    return 'Pending';
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
      var isVerified = String(a.verification_status || '').toUpperCase() === 'VERIFIED';
      var filesBtn = isVerified ? '' : '<button class="btn btn-ghost acct-files" data-id="' + a.id + '">Files</button>';
      var vStatus = String(a.verification_status || 'NONE').toUpperCase();
      var hasIntent = String(a.score_impact_intent || 'NO').toUpperCase() === 'YES';
      var verifyBtn = '';
      if (vStatus === 'AWAITING_PAYMENT' && hasIntent) {
        verifyBtn = '<button class="btn btn-ghost acct-verify" data-id="' + a.id + '">Pay $2 \u00b7 Request</button>';
      } else if (vStatus === 'PAID_REQUESTED') {
        verifyBtn = '<button class="btn btn-ghost" disabled>Request Sent</button>';
      } else if (vStatus === 'LINK_SENT') {
        verifyBtn = '<button class="btn btn-ghost" disabled>Check Email</button>';
      } else if (vStatus === 'PAID_PENDING') {
        verifyBtn = '<button class="btn btn-ghost" disabled>Under Review</button>';
      }
      var isBroker = String(a.account_category || 'PROP_FIRM').toUpperCase() === 'BROKER';
      var intentYes = String(a.score_impact_intent || 'NO').toUpperCase() === 'YES';
      var catLabel = isBroker ? 'Broker' : 'Prop Firm';
      var intentBadge = intentYes ? '<span style="display:inline-block;margin-left:8px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(16,185,129,.12);color:#10B981;border-radius:6px;letter-spacing:.04em">SCORE VERIFY</span>' : '';
      var titleLine, subLine;
      if(isBroker){
        titleLine = esc(a.broker_name || '\u2014');
        var modeTxt = String(a.broker_account_mode || '').toUpperCase() === 'DEMO' ? 'Demo' : 'Real';
        subLine = modeTxt + ' \u00b7 ID: ' + esc(a.broker_account_id || '\u2014');
      } else {
        titleLine = esc(a.firm_name || '\u2014');
        subLine = fmtMoney(a.account_size_cents) + ' \u00b7 ' + esc(a.account_type || '');
      }
      var brokerMoney = isBroker ? (
        '<div class="acct-meta-item"><b>' + fmtMoney(a.total_deposit_cents) + '</b>Deposited</div>' +
        '<div class="acct-meta-item"><b>' + fmtMoney(a.total_withdrawal_cents) + '</b>Withdrawn</div>'
      ) : '';
      return '<div class="acct-card" data-id="' + a.id + '">' +
        '<div class="acct-head"><div><div class="acct-firm">' + titleLine + intentBadge + '</div><div class="acct-size">' + catLabel + ' \u00b7 ' + subLine + '</div>' + (a.payment_request_no ? '<div style="font-family:Consolas,monospace;font-size:11.5px;margin-top:2px;color:var(--muted)">Request: ' + esc(a.payment_request_no) + '</div>' : '') + '</div>' +
        '<span class="acct-badge ' + cls + '">' + lbl + '</span></div>' +
        '<div class="acct-meta">' +
          '<div class="acct-meta-item"><b>' + (Number(a.total_trades) || 0) + '</b>Total Trades</div>' +
          '<div class="acct-meta-item"><b>' + ((Number(a.win_rate_bps) || 0) / 100).toFixed(0) + '%</b>Win Rate</div>' +
          brokerMoney +
          (isBroker ? '' : '<div class="acct-meta-item"><b>' + fmtShortDate(a.start_date) + '</b>Started</div>') +
        '</div>' +
        '<div class="acct-actions">' +
          filesBtn +
          verifyBtn +
          '<button class="btn btn-ghost acct-trades" data-id="' + a.id + '">Trades</button>' +
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
        var id = this.getAttribute('data-id');
        var btn = this;
        if(!confirm('Request verification for this account? Admin will review and may request a $2 fee.')) return;
        btn.disabled = true;
        btn.textContent = 'Requesting…';
        fetch(API + '/api/tid/accounts/' + id + '/request-payment', {
          method: 'POST',
          headers: {Authorization:'Bearer ' + token}
        })
          .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
          .then(function(x){
            if(!x.ok || !x.data.success) throw new Error(x.data.error || 'Request failed');
            toast('Payment request sent to admin');
            loadAccounts();
          })
          .catch(function(e){
            toast(e.message || 'Request failed');
            btn.disabled = false;
            btn.textContent = 'Pay $2 \u00b7 Request';
          });
      });
    }
    var fileBtns = accountsList.querySelectorAll('.acct-files');
    for(var k = 0; k < fileBtns.length; k++){
      fileBtns[k].addEventListener('click', function(){
        var id = this.getAttribute('data-id');
        openFilesModal(id);
      });
    }
    // Update button removed — metrics are set by admin after verification
    var trdBtns = accountsList.querySelectorAll('.acct-trades');
    for(var n = 0; n < trdBtns.length; n++){
      trdBtns[n].addEventListener('click', function(){
        var id = this.getAttribute('data-id');
        if(typeof openTradesModal === 'function') openTradesModal(id);
      });
    }
  }

  // ===== Trades =====
  var tradesListModal = $('tradesListModal');
  var currentTradesAccountId = null;

  window.openTradesModal = function(accountId){
    if(!tradesListModal) return;
    currentTradesAccountId = accountId;
    var h = $('tradesListAccountId');
    if(h) h.value = accountId;
    tradesListModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadTrades(accountId);
  };

  function closeTradesModal(){
    if(tradesListModal) tradesListModal.classList.remove('open');
    document.body.style.overflow = '';
    currentTradesAccountId = null;
  }

  function loadTrades(accountId){
    var body = $('tradesListBody');
    if(!body) return;
    body.innerHTML = '<div class="empty"><div class="empty-text">Loading trades…</div></div>';
    fetch(API + '/api/tid/accounts/' + accountId + '/trades', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success) throw new Error(d.error || 'Load failed');
        renderTrades(d.trades || []);
      })
      .catch(function(e){
        body.innerHTML = '<div class="empty"><div class="empty-text">' + esc(e.message) + '</div></div>';
      });
  }

  function renderTrades(trades){
    var body = $('tradesListBody');
    var summary = $('tradesListSummary');
    if(!body) return;
    if(!trades.length){
      body.innerHTML = '<div class="empty"><div class="empty-title">No trades yet</div><div class="empty-text">Add your first trade or import a statement.</div></div>';
      if(summary) summary.textContent = '';
      return;
    }
    var totalPips = 0;
    var wins = 0;
    for(var i = 0; i < trades.length; i++){
      totalPips += Number(trades[i].pips) || 0;
      if((Number(trades[i].pips) || 0) > 0) wins++;
    }
    if(summary) summary.textContent = trades.length + ' trades · ' + wins + ' wins · ' + totalPips.toFixed(1) + ' pips';

    var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">';
    html += '<thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em">';
    html += '<th style="padding:8px 6px">Date</th><th style="padding:8px 6px">Symbol</th><th style="padding:8px 6px">Dir</th><th style="padding:8px 6px;text-align:right">Pips</th><th style="padding:8px 6px;text-align:right">P/L</th><th style="padding:8px 6px">Status</th><th style="padding:8px 6px"></th></tr></thead><tbody>';
    for(var j = 0; j < trades.length; j++){
      var t = trades[j];
      var pips = Number(t.pips) || 0;
      var profit = (Number(t.profit_cents) || 0) / 100;
      var dateStr = t.closed_at || t.opened_at || t.created_at;
      var dateShow = dateStr ? new Date(dateStr).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}) : '—';
      var pipsColor = pips > 0 ? '#10B981' : (pips < 0 ? '#EF4444' : 'var(--muted)');
      var plColor = profit > 0 ? '#10B981' : (profit < 0 ? '#EF4444' : 'var(--muted)');
      var dirBg = t.direction === 'BUY' ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)';
      var dirFg = t.direction === 'BUY' ? '#10B981' : '#EF4444';
      html += '<tr style="border-top:1px solid var(--border)">';
      html += '<td style="padding:8px 6px;white-space:nowrap">' + esc(dateShow) + '</td>';
      html += '<td style="padding:8px 6px;font-weight:600">' + esc(t.symbol) + '</td>';
      html += '<td style="padding:8px 6px"><span style="padding:2px 6px;border-radius:4px;font-size:10.5px;font-weight:700;background:' + dirBg + ';color:' + dirFg + '">' + esc(t.direction) + '</span></td>';
      html += '<td style="padding:8px 6px;text-align:right;color:' + pipsColor + ';font-weight:700">' + (pips > 0 ? '+' : '') + pips.toFixed(1) + '</td>';
      html += '<td style="padding:8px 6px;text-align:right;color:' + plColor + ';font-weight:700">' + (profit > 0 ? '+' : '') + '
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

  function loadFiles(accountId){
    if(!filesList) return;
    filesList.innerHTML = '<div class="files-loading">Loading files\u2026</div>';
    fetch(API + '/api/tid/files?account_id=' + accountId, {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success) throw new Error(d.error || 'Load failed');
        renderFiles(d.files || []);
      })
      .catch(function(e){
        filesList.innerHTML = '<div class="files-empty">Unable to load files. ' + esc(e.message || '') + '</div>';
      });
  }

  function renderFiles(files){
    if(!filesList) return;
    if(!files.length){
      filesList.innerHTML = '<div class="files-empty">No files uploaded yet.<br>Upload your first statement or receipt below.</div>';
      if(filesUploadBtn) filesUploadBtn.disabled = false;
      return;
    }
    filesList.innerHTML = files.map(function(f){
      var sc = fileStatusClass(f.status);
      var sl = fileStatusLabel(f.status);
      var canDel = String(f.status || '').toUpperCase() !== 'APPROVED';
      var delBtn = canDel ? '<button class="btn btn-ghost file-del" data-id="' + f.id + '">Delete</button>' : '';
      return '<div class="file-row">' +
        '<div class="file-row-info">' +
          '<div class="file-row-name">' + esc(f.file_type || 'File').replace(/_/g, ' ') + '</div>' +
          '<div class="file-row-meta">' + fmtBytes(f.file_size) + ' \u00b7 ' + esc(f.mime_type || '') + ' \u00b7 ' + fmtShortDate(f.uploaded_at) + '</div>' +
          '<div class="file-row-meta file-row-status file-row-status-' + sc + '">' + sl + '</div>' +
        '</div>' +
        delBtn +
      '</div>';
    }).join('');

    if(filesUploadBtn) filesUploadBtn.disabled = files.length >= 2;

    var dbs = filesList.querySelectorAll('.file-del');
    for(var i = 0; i < dbs.length; i++){
      dbs[i].addEventListener('click', function(){
        var id = this.getAttribute('data-id');
        if(!confirm('Delete this file?')) return;
        fetch(API + '/api/tid/file/' + id, {method:'DELETE', headers:{Authorization:'Bearer ' + token}})
          .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
          .then(function(x){ if(!x.ok) throw new Error(x.data.error || 'Delete failed'); toast('File deleted'); loadFiles(currentFileAccountId); })
          .catch(function(e){ toast(e.message || 'Delete failed'); });
      });
    }
  }

  addAcctBtn.addEventListener('click', openAccountModal);
  var acctClose = $('accountModalClose');
  if(acctClose) acctClose.addEventListener('click', closeAccountModal);
  var acctCancel = $('accountCancel');
  if(acctCancel) acctCancel.addEventListener('click', closeAccountModal);
  if(acctModal) acctModal.addEventListener('click', function(e){ if(e.target === acctModal) closeAccountModal(); });

  var filesClose = $('filesModalClose');
  if(filesClose) filesClose.addEventListener('click', closeFilesModal);
  var filesDone = $('filesModalDone');
  if(filesDone) filesDone.addEventListener('click', closeFilesModal);
  if(filesModal) filesModal.addEventListener('click', function(e){ if(e.target === filesModal) closeFilesModal(); });

  if(filesUploadBtn) filesUploadBtn.addEventListener('click', function(){
    if(filesUploadInput) filesUploadInput.click();
  });

  if(filesUploadInput) filesUploadInput.addEventListener('change', function(){
    var file = this.files && this.files[0];
    if(!file) return;
    if(file.size > 3 * 1024 * 1024){ toast('File too large. Max 3 MB.'); this.value = ''; return; }
    var fd = new FormData();
    fd.append('file', file);
    fd.append('file_type', filesUploadType ? filesUploadType.value : 'STATEMENT');
    fd.append('account_id', String(currentFileAccountId));
    if(filesUploadProgress) filesUploadProgress.style.display = 'block';
    if(filesUploadBtn) filesUploadBtn.disabled = true;
    if(filesError) filesError.classList.remove('show');

    fetch(API + '/api/tid/upload', {method:'POST', headers:{Authorization:'Bearer ' + token}, body: fd})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
      .then(function(x){
        if(!x.ok) throw new Error(x.data.error || 'Upload failed');
        toast('File uploaded');
        if(filesUploadInput) filesUploadInput.value = '';
        loadFiles(currentFileAccountId);
      })
      .catch(function(e){
        if(filesError){ filesError.textContent = e.message || 'Upload failed'; filesError.classList.add('show'); }
      })
      .then(function(){
        if(filesUploadProgress) filesUploadProgress.style.display = 'none';
        if(filesUploadBtn) filesUploadBtn.disabled = false;
      });
  });

  var propFields = $('propFirmFields');
  var brokerFields = $('brokerFields');
  var categoryRadios = document.querySelectorAll('input[name="acctCategory"]');
  function applyCategoryToggle(){
    var selected = document.querySelector('input[name="acctCategory"]:checked');
    var cat = selected ? selected.value : 'PROP_FIRM';
    if(propFields) propFields.style.display = (cat === 'PROP_FIRM') ? '' : 'none';
    if(brokerFields) brokerFields.style.display = (cat === 'BROKER') ? '' : 'none';
  }
  for(var cr = 0; cr < categoryRadios.length; cr++){
    categoryRadios[cr].addEventListener('change', applyCategoryToggle);
  }
  applyCategoryToggle();

  if(acctForm) acctForm.addEventListener('submit', function(e){
    e.preventDefault();
    var errBox = $('acctError');
    if(errBox) errBox.classList.remove('show');

    var catEl = document.querySelector('input[name="acctCategory"]:checked');
    var category = catEl ? catEl.value : 'PROP_FIRM';
    var intentEl = $('acctIntentYes');
    var intent = (intentEl && intentEl.checked) ? 'YES' : 'NO';

    var payload = {
      account_category: category,
      score_impact_intent: intent
    };

    if(category === 'PROP_FIRM'){
      var firmInput = $('acctFirm');
      var firm = firmInput ? firmInput.value.trim() : '';
      if(firm.length < 2){
        if(errBox){ errBox.textContent = 'Enter firm name'; errBox.classList.add('show'); }
        return;
      }
      var sizeEl = $('acctSize');
      var typeEl = $('acctType');
      var dateEl = $('acctStartDate');
      payload.firm_name = firm;
      payload.account_size_cents = Number(sizeEl ? sizeEl.value : 0) || 0;
      payload.account_type = typeEl ? typeEl.value : 'CHALLENGE';
      payload.start_date = dateEl && dateEl.value ? dateEl.value : null;
    } else {
      var bNameEl = $('acctBrokerName');
      var bName = bNameEl ? bNameEl.value.trim() : '';
      if(bName.length < 2){
        if(errBox){ errBox.textContent = 'Enter broker name'; errBox.classList.add('show'); }
        return;
      }
      var bIdEl = $('acctBrokerId');
      var bId = bIdEl ? bIdEl.value.trim() : '';
      if(!bId){
        if(errBox){ errBox.textContent = 'Enter broker account ID'; errBox.classList.add('show'); }
        return;
      }
      var bModeEl = $('acctBrokerMode');
      var depEl = $('acctDeposit');
      var wdEl = $('acctWithdrawal');
      payload.broker_name = bName;
      payload.broker_account_id = bId;
      payload.broker_account_mode = bModeEl ? bModeEl.value : 'REAL';
      payload.total_deposit_cents = Math.round((Number(depEl ? depEl.value : 0) || 0) * 100);
      payload.total_withdrawal_cents = Math.round((Number(wdEl ? wdEl.value : 0) || 0) * 100);
    }

    var submitBtn = $('accountSubmit');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

    fetch(API + '/api/tid/accounts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization:'Bearer ' + token},
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
})(); + profit.toFixed(2) + '</td>';
      html += '<td style="padding:8px 6px;font-size:11px;color:var(--muted)">' + esc(t.status) + '</td>';
      html += '<td style="padding:8px 6px;text-align:right"><button class="btn btn-ghost trade-del" data-id="' + t.id + '" style="padding:4px 8px;font-size:11px">Delete</button></td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    body.innerHTML = html;

    var delBtns = body.querySelectorAll('.trade-del');
    for(var k = 0; k < delBtns.length; k++){
      delBtns[k].addEventListener('click', function(){
        var tid = this.getAttribute('data-id');
        if(!confirm('Delete this trade?')) return;
        fetch(API + '/api/tid/accounts/' + currentTradesAccountId + '/trades/' + tid, {method:'DELETE', headers:{Authorization:'Bearer ' + token}})
          .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
          .then(function(x){
            if(!x.ok || !x.data.success) throw new Error(x.data.error || 'Delete failed');
            toast('Trade deleted');
            loadTrades(currentTradesAccountId);
            loadAccounts();
            if(typeof window.loadDashboard === 'function') window.loadDashboard();
          })
          .catch(function(e){ toast(e.message || 'Delete failed'); });
      });
    }
  }

  if(tradesListModal){
    var tlClose = $('tradesListClose');
    if(tlClose) tlClose.addEventListener('click', closeTradesModal);
    tradesListModal.addEventListener('click', function(e){ if(e.target === tradesListModal) closeTradesModal(); });
  }
  var openAddTradeBtn = $('openAddTradeBtn');
  if(openAddTradeBtn) openAddTradeBtn.addEventListener('click', function(){
    if(typeof openTradeForm === 'function') openTradeForm(currentTradesAccountId);
  });
  var openBulkImportBtn = $('openBulkImportBtn');
  if(openBulkImportBtn) openBulkImportBtn.addEventListener('click', function(){
    if(typeof openBulkImport === 'function') openBulkImport(currentTradesAccountId);
  });

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

  function loadFiles(accountId){
    if(!filesList) return;
    filesList.innerHTML = '<div class="files-loading">Loading files\u2026</div>';
    fetch(API + '/api/tid/files?account_id=' + accountId, {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success) throw new Error(d.error || 'Load failed');
        renderFiles(d.files || []);
      })
      .catch(function(e){
        filesList.innerHTML = '<div class="files-empty">Unable to load files. ' + esc(e.message || '') + '</div>';
      });
  }

  function renderFiles(files){
    if(!filesList) return;
    if(!files.length){
      filesList.innerHTML = '<div class="files-empty">No files uploaded yet.<br>Upload your first statement or receipt below.</div>';
      if(filesUploadBtn) filesUploadBtn.disabled = false;
      return;
    }
    filesList.innerHTML = files.map(function(f){
      var sc = fileStatusClass(f.status);
      var sl = fileStatusLabel(f.status);
      var canDel = String(f.status || '').toUpperCase() !== 'APPROVED';
      var delBtn = canDel ? '<button class="btn btn-ghost file-del" data-id="' + f.id + '">Delete</button>' : '';
      return '<div class="file-row">' +
        '<div class="file-row-info">' +
          '<div class="file-row-name">' + esc(f.file_type || 'File').replace(/_/g, ' ') + '</div>' +
          '<div class="file-row-meta">' + fmtBytes(f.file_size) + ' \u00b7 ' + esc(f.mime_type || '') + ' \u00b7 ' + fmtShortDate(f.uploaded_at) + '</div>' +
          '<div class="file-row-meta file-row-status file-row-status-' + sc + '">' + sl + '</div>' +
        '</div>' +
        delBtn +
      '</div>';
    }).join('');

    if(filesUploadBtn) filesUploadBtn.disabled = files.length >= 2;

    var dbs = filesList.querySelectorAll('.file-del');
    for(var i = 0; i < dbs.length; i++){
      dbs[i].addEventListener('click', function(){
        var id = this.getAttribute('data-id');
        if(!confirm('Delete this file?')) return;
        fetch(API + '/api/tid/file/' + id, {method:'DELETE', headers:{Authorization:'Bearer ' + token}})
          .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
          .then(function(x){ if(!x.ok) throw new Error(x.data.error || 'Delete failed'); toast('File deleted'); loadFiles(currentFileAccountId); })
          .catch(function(e){ toast(e.message || 'Delete failed'); });
      });
    }
  }

  addAcctBtn.addEventListener('click', openAccountModal);
  var acctClose = $('accountModalClose');
  if(acctClose) acctClose.addEventListener('click', closeAccountModal);
  var acctCancel = $('accountCancel');
  if(acctCancel) acctCancel.addEventListener('click', closeAccountModal);
  if(acctModal) acctModal.addEventListener('click', function(e){ if(e.target === acctModal) closeAccountModal(); });

  var filesClose = $('filesModalClose');
  if(filesClose) filesClose.addEventListener('click', closeFilesModal);
  var filesDone = $('filesModalDone');
  if(filesDone) filesDone.addEventListener('click', closeFilesModal);
  if(filesModal) filesModal.addEventListener('click', function(e){ if(e.target === filesModal) closeFilesModal(); });

  if(filesUploadBtn) filesUploadBtn.addEventListener('click', function(){
    if(filesUploadInput) filesUploadInput.click();
  });

  if(filesUploadInput) filesUploadInput.addEventListener('change', function(){
    var file = this.files && this.files[0];
    if(!file) return;
    if(file.size > 3 * 1024 * 1024){ toast('File too large. Max 3 MB.'); this.value = ''; return; }
    var fd = new FormData();
    fd.append('file', file);
    fd.append('file_type', filesUploadType ? filesUploadType.value : 'STATEMENT');
    fd.append('account_id', String(currentFileAccountId));
    if(filesUploadProgress) filesUploadProgress.style.display = 'block';
    if(filesUploadBtn) filesUploadBtn.disabled = true;
    if(filesError) filesError.classList.remove('show');

    fetch(API + '/api/tid/upload', {method:'POST', headers:{Authorization:'Bearer ' + token}, body: fd})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
      .then(function(x){
        if(!x.ok) throw new Error(x.data.error || 'Upload failed');
        toast('File uploaded');
        if(filesUploadInput) filesUploadInput.value = '';
        loadFiles(currentFileAccountId);
      })
      .catch(function(e){
        if(filesError){ filesError.textContent = e.message || 'Upload failed'; filesError.classList.add('show'); }
      })
      .then(function(){
        if(filesUploadProgress) filesUploadProgress.style.display = 'none';
        if(filesUploadBtn) filesUploadBtn.disabled = false;
      });
  });

  var propFields = $('propFirmFields');
  var brokerFields = $('brokerFields');
  var categoryRadios = document.querySelectorAll('input[name="acctCategory"]');
  function applyCategoryToggle(){
    var selected = document.querySelector('input[name="acctCategory"]:checked');
    var cat = selected ? selected.value : 'PROP_FIRM';
    if(propFields) propFields.style.display = (cat === 'PROP_FIRM') ? '' : 'none';
    if(brokerFields) brokerFields.style.display = (cat === 'BROKER') ? '' : 'none';
  }
  for(var cr = 0; cr < categoryRadios.length; cr++){
    categoryRadios[cr].addEventListener('change', applyCategoryToggle);
  }
  applyCategoryToggle();

  if(acctForm) acctForm.addEventListener('submit', function(e){
    e.preventDefault();
    var errBox = $('acctError');
    if(errBox) errBox.classList.remove('show');

    var catEl = document.querySelector('input[name="acctCategory"]:checked');
    var category = catEl ? catEl.value : 'PROP_FIRM';
    var intentEl = $('acctIntentYes');
    var intent = (intentEl && intentEl.checked) ? 'YES' : 'NO';

    var payload = {
      account_category: category,
      score_impact_intent: intent
    };

    if(category === 'PROP_FIRM'){
      var firmInput = $('acctFirm');
      var firm = firmInput ? firmInput.value.trim() : '';
      if(firm.length < 2){
        if(errBox){ errBox.textContent = 'Enter firm name'; errBox.classList.add('show'); }
        return;
      }
      var sizeEl = $('acctSize');
      var typeEl = $('acctType');
      var dateEl = $('acctStartDate');
      payload.firm_name = firm;
      payload.account_size_cents = Number(sizeEl ? sizeEl.value : 0) || 0;
      payload.account_type = typeEl ? typeEl.value : 'CHALLENGE';
      payload.start_date = dateEl && dateEl.value ? dateEl.value : null;
    } else {
      var bNameEl = $('acctBrokerName');
      var bName = bNameEl ? bNameEl.value.trim() : '';
      if(bName.length < 2){
        if(errBox){ errBox.textContent = 'Enter broker name'; errBox.classList.add('show'); }
        return;
      }
      var bIdEl = $('acctBrokerId');
      var bId = bIdEl ? bIdEl.value.trim() : '';
      if(!bId){
        if(errBox){ errBox.textContent = 'Enter broker account ID'; errBox.classList.add('show'); }
        return;
      }
      var bModeEl = $('acctBrokerMode');
      var depEl = $('acctDeposit');
      var wdEl = $('acctWithdrawal');
      payload.broker_name = bName;
      payload.broker_account_id = bId;
      payload.broker_account_mode = bModeEl ? bModeEl.value : 'REAL';
      payload.total_deposit_cents = Math.round((Number(depEl ? depEl.value : 0) || 0) * 100);
      payload.total_withdrawal_cents = Math.round((Number(wdEl ? wdEl.value : 0) || 0) * 100);
    }

    var submitBtn = $('accountSubmit');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

    fetch(API + '/api/tid/accounts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization:'Bearer ' + token},
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