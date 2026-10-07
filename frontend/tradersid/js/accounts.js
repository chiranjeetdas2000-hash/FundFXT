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
    body.innerHTML = '<div class="empty"><div class="empty-text">Loading...</div></div>';
    fetch(API + '/api/tid/accounts/' + accountId + '/trades', {headers:{Authorization:'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success) throw new Error('Load failed');
        renderTrades(d.trades || []);
      })
      .catch(function(){
        body.innerHTML = '<div class="empty"><div class="empty-text">Unable to load trades.</div></div>';
      });
  }

  function renderTrades(trades){
    var body = $('tradesListBody');
    if(!body) return;
    if(!trades.length){
      body.innerHTML = '<div class="empty"><div class="empty-text">No trades yet.</div></div>';
      return;
    }
    var rows = '';
    var i;
    for(i = 0; i < trades.length; i++){
      var t = trades[i];
      rows += '<tr>';
      rows += '<td>' + esc(t.symbol) + '</td>';
      rows += '<td>' + esc(t.direction) + '</td>';
      rows += '<td>' + (Number(t.pips) || 0) + '</td>';
      rows += '<td>' + ((Number(t.profit_cents) || 0) / 100) + '</td>';
      rows += '<td><button class="trade-del" data-id="' + t.id + '" style="background:none;border:0;color:#EF4444;cursor:pointer;font-size:11px;font-weight:700">DEL</button></td>';
      rows += '</tr>';
    }
    body.innerHTML = '<table><thead><tr><th>Symbol</th><th>Dir</th><th>Pips</th><th>P/L</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

    var delBtns = body.querySelectorAll('.trade-del');
    for(i = 0; i < delBtns.length; i++){
      delBtns[i].addEventListener('click', function(){
        var tradeId = this.getAttribute('data-id');
        if(!confirm('Delete this trade?')) return;
        fetch(API + '/api/tid/accounts/' + currentTradesAccountId + '/trades/' + tradeId, {method:'DELETE', headers:{Authorization:'Bearer ' + token}})
          .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
          .then(function(x){
            if(!x.ok || !x.data.success) throw new Error(x.data.error || 'Delete failed');
            toast('Trade deleted');
            loadTrades(currentTradesAccountId);
            loadAccounts();
          })
          .catch(function(e){ toast(e.message || 'Delete failed'); });
      });
    }
  }

  var tradesListClose = $('tradesListClose');
  if(tradesListClose) tradesListClose.addEventListener('click', closeTradesModal);
  if(tradesListModal) tradesListModal.addEventListener('click', function(e){ if(e.target === tradesListModal) closeTradesModal(); });
  var openAddTradeBtn = $('openAddTradeBtn');
  if(openAddTradeBtn) openAddTradeBtn.addEventListener('click', function(){ if(typeof openTradeForm === 'function') openTradeForm(currentTradesAccountId); });
  var openBulkImportBtn = $('openBulkImportBtn');
  if(openBulkImportBtn) openBulkImportBtn.addEventListener('click', function(){ if(typeof openBulkImport === 'function') openBulkImport(currentTradesAccountId); });

  var tradeModal = $('tradeModal');
  var tradeForm = $('tradeForm');

  window.openTradeForm = function(accountId){
    if(!tradeModal) return;
    var hid = $('tradeAccountId');
    if(hid) hid.value = accountId;
    if(tradeForm) tradeForm.reset();
    var errEl = $('tradeError');
    if(errEl) errEl.classList.remove('show');
    tradeModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  function closeTradeForm(){
    if(tradeModal) tradeModal.classList.remove('open');
    document.body.style.overflow = '';
  }

  var tradeModalClose = $('tradeModalClose');
  if(tradeModalClose) tradeModalClose.addEventListener('click', closeTradeForm);
  var tradeCancel = $('tradeCancel');
  if(tradeCancel) tradeCancel.addEventListener('click', closeTradeForm);
  if(tradeModal) tradeModal.addEventListener('click', function(e){ if(e.target === tradeModal) closeTradeForm(); });

  if(tradeForm) tradeForm.addEventListener('submit', function(e){
    e.preventDefault();
    var errEl = $('tradeError');
    if(errEl) errEl.classList.remove('show');
    var accId = $('tradeAccountId') ? $('tradeAccountId').value : null;
    if(!accId){ if(errEl){ errEl.textContent = 'Missing account'; errEl.classList.add('show'); } return; }
    var symbol = $('tradeSymbol') ? $('tradeSymbol').value.trim().toUpperCase() : '';
    if(!symbol){ if(errEl){ errEl.textContent = 'Symbol required'; errEl.classList.add('show'); } return; }
    var payload = {
      symbol: symbol,
      direction: $('tradeDirection') ? $('tradeDirection').value : 'BUY',
      entry_price: $('tradeEntry') && $('tradeEntry').value ? Number($('tradeEntry').value) : null,
      exit_price: $('tradeExit') && $('tradeExit').value ? Number($('tradeExit').value) : null,
      lot_size: $('tradeLot') && $('tradeLot').value ? Number($('tradeLot').value) : null,
      pips: $('tradePips') && $('tradePips').value ? Number($('tradePips').value) : null,
      profit_cents: Math.round(Number($('tradeProfit') ? $('tradeProfit').value : 0) * 100),
      status: $('tradeStatus') ? $('tradeStatus').value : 'CLOSED',
      opened_at: $('tradeOpened') && $('tradeOpened').value ? $('tradeOpened').value : null,
      closed_at: $('tradeClosed') && $('tradeClosed').value ? $('tradeClosed').value : null,
      notes: $('tradeNotes') ? $('tradeNotes').value.trim() : null
    };
    var btn = $('tradeSubmit');
    if(btn){ btn.disabled = true; btn.textContent = 'Saving...'; }
    fetch(API + '/api/tid/accounts/' + accId + '/trades', {
      method: 'POST',
      headers: {'Content-Type':'application/json', Authorization:'Bearer ' + token},
      body: JSON.stringify(payload)
    })
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
      .then(function(x){
        if(!x.ok || !x.data.success) throw new Error(x.data.error || 'Create failed');
        toast('Trade added');
        closeTradeForm();
        loadTrades(currentTradesAccountId);
        loadAccounts();
      })
      .catch(function(err){
        if(errEl){ errEl.textContent = err.message || 'Create failed'; errEl.classList.add('show'); }
      })
      .then(function(){
        if(btn){ btn.disabled = false; btn.textContent = 'Add Trade'; }
      });
  });

  var bulkImportModal = $('bulkImportModal');
  var bulkImportFile = $('bulkImportFile');
  var bulkImportPreview = $('bulkImportPreview');
  var bulkImportError = $('bulkImportError');
  var parsedTrades = [];

  window.openBulkImport = function(accountId){
    if(!bulkImportModal) return;
    var hid = $('tradesListAccountId');
    if(hid) hid.value = accountId;
    parsedTrades = [];
    if(bulkImportFile) bulkImportFile.value = '';
    if(bulkImportPreview) bulkImportPreview.textContent = '';
    if(bulkImportError) bulkImportError.classList.remove('show');
    bulkImportModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  function closeBulkImport(){
    if(bulkImportModal) bulkImportModal.classList.remove('open');
    document.body.style.overflow = '';
    parsedTrades = [];
  }

  function parseCSVLine(line){
    var out = [];
    var cur = '';
    var inQ = false;
    for(var k = 0; k < line.length; k++){
      var ch = line[k];
      if(ch === '"'){ inQ = !inQ; continue; }
      if(ch === ',' && !inQ){ out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function normalizeHeader(h){
    return String(h || '').toLowerCase().trim().replace(/\s+/g, '_');
  }

  function parseCSV(text){
    var lines = text.split(/\r?\n/).filter(function(l){ return l.trim().length > 0; });
    if(lines.length < 2) return { trades: [], error: 'CSV must have header + at least one row' };
    var headers = parseCSVLine(lines[0]).map(normalizeHeader);
    var trades = [];
    var errs = [];
    for(var i = 1; i < lines.length; i++){
      var cells = parseCSVLine(lines[i]);
      var row = {};
      for(var h = 0; h < headers.length; h++){
        row[headers[h]] = cells[h] != null ? cells[h] : '';
      }
      var profitVal = row.profit_usd || row.profit || row.pnl || '0';
      var trade = {
        symbol: row.symbol || '',
        direction: (row.direction || 'BUY').toUpperCase(),
        entry_price: row.entry_price ? Number(row.entry_price) : null,
        exit_price: row.exit_price ? Number(row.exit_price) : null,
        lot_size: row.lot_size ? Number(row.lot_size) : null,
        pips: row.pips ? Number(row.pips) : null,
        profit_cents: Math.round((Number(profitVal) || 0) * 100),
        status: (row.status || 'CLOSED').toUpperCase(),
        opened_at: row.opened_at || null,
        closed_at: row.closed_at || null,
        notes: row.notes || null
      };
      if(!trade.symbol) errs.push('Row ' + (i + 1) + ': missing symbol');
      else trades.push(trade);
    }
    return { trades: trades, error: errs.length ? errs.slice(0, 3).join('; ') : null };
  }

  if(bulkImportFile) bulkImportFile.addEventListener('change', function(){
    var f = this.files && this.files[0];
    if(!f) return;
    if(bulkImportPreview) bulkImportPreview.textContent = 'Reading...';
    var reader = new FileReader();
    reader.onload = function(e){
      var parsed = parseCSV(String(e.target.result || ''));
      parsedTrades = parsed.trades || [];
      if(parsed.error){
        if(bulkImportPreview) bulkImportPreview.textContent = 'Issues: ' + parsed.error;
      } else if(!parsedTrades.length){
        if(bulkImportPreview) bulkImportPreview.textContent = 'No valid trades found';
      } else {
        if(bulkImportPreview) bulkImportPreview.textContent = 'Ready to import: ' + parsedTrades.length + ' trades';
      }
    };
    reader.onerror = function(){
      if(bulkImportPreview) bulkImportPreview.textContent = 'Failed to read file';
    };
    reader.readAsText(f);
  });

  var bulkImportCloseBtn = $('bulkImportClose');
  if(bulkImportCloseBtn) bulkImportCloseBtn.addEventListener('click', closeBulkImport);
  var bulkImportCancelBtn = $('bulkImportCancel');
  if(bulkImportCancelBtn) bulkImportCancelBtn.addEventListener('click', closeBulkImport);
  if(bulkImportModal) bulkImportModal.addEventListener('click', function(e){ if(e.target === bulkImportModal) closeBulkImport(); });

  var bulkImportSubmitBtn = $('bulkImportSubmit');
  if(bulkImportSubmitBtn) bulkImportSubmitBtn.addEventListener('click', function(){
    if(bulkImportError) bulkImportError.classList.remove('show');
    if(!parsedTrades.length){
      if(bulkImportError){ bulkImportError.textContent = 'Upload a valid CSV first'; bulkImportError.classList.add('show'); }
      return;
    }
    var accId = $('tradesListAccountId') ? $('tradesListAccountId').value : null;
    if(!accId){
      if(bulkImportError){ bulkImportError.textContent = 'Missing account'; bulkImportError.classList.add('show'); }
      return;
    }
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Importing...';
    fetch(API + '/api/tid/accounts/' + accId + '/trades/bulk', {
      method: 'POST',
      headers: {'Content-Type':'application/json', Authorization:'Bearer ' + token},
      body: JSON.stringify({ trades: parsedTrades })
    })
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
      .then(function(x){
        if(!x.ok || !x.data.success) throw new Error(x.data.error || 'Import failed');
        toast('Imported ' + x.data.inserted_count + ' trades');
        closeBulkImport();
        loadTrades(currentTradesAccountId);
        loadAccounts();
      })
      .catch(function(e){
        if(bulkImportError){ bulkImportError.textContent = e.message || 'Import failed'; bulkImportError.classList.add('show'); }
      })
      .then(function(){
        btn.disabled = false;
        btn.textContent = 'Import Trades';
      });
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