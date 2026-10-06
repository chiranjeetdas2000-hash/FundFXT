(function(){
  'use strict';
  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('fundfxt_admin_token');

  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function fmtDate(s){ if(!s) return '—'; try{ return new Date(s).toLocaleString('en-IN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(_){ return '—'; } }
  function fmtBytes(b){ var n=Number(b||0); if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
  function setError(msg){
    var e = $('errBox'); if(!e) return;
    if(msg){ e.textContent = msg; e.classList.add('show'); }
    else { e.textContent = ''; e.classList.remove('show'); }
  }
  async function api(path, opts){
    opts = opts || {};
    var res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var data = {};
    try { data = await res.json(); } catch(_){}
    if(!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  window.loadPaymentRequests = async function(){
    var list = $('paymentList');
    if(!list) return;
    var detailWrap = $('paymentDetailWrap');
    var listWrap = $('paymentListWrap');
    if(detailWrap) detailWrap.classList.add('hidden');
    if(listWrap) listWrap.classList.remove('hidden');
    list.innerHTML = '<div class="loading">Loading payment requests…</div>';
    try {
      var d = await api('/api/admin/tid/payment-requests');
      if(!d.accounts.length){
        list.innerHTML = '<div class="empty">No payment requests.</div>';
        return;
      }
      var html = '<div class="table-wrap"><table><thead><tr><th>Req No</th><th>TID</th><th>Account</th><th>Status</th><th>Fee</th><th>Created</th><th>Action</th></tr></thead><tbody>';
      d.accounts.forEach(function(a){
        var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
        var accLabel;
        if(isBroker){
          var mode = String(a.broker_account_mode || '').toUpperCase() === 'DEMO' ? 'Demo' : 'Real';
          accLabel = (a.broker_name || 'Broker') + ' · ' + mode;
        } else {
          accLabel = (a.firm_name || 'Firm') + ' · $' + (Number(a.account_size_cents||0)/100).toLocaleString('en-US');
        }
        var badge = 'none';
        if(a.verification_status === 'PAID_PENDING') badge = 'approved';
        else if(a.verification_status === 'PAID_REQUESTED') badge = 'pending';
        else if(a.verification_status === 'LINK_SENT') badge = 'pending';
        var feeStr = '$' + (Number(a.verification_fee_cents||0)/100).toFixed(0);
        html += '<tr>';
        html += '<td><b style="font-family:Consolas,monospace">' + esc(a.payment_request_no || '—') + '</b></td>';
        html += '<td>' + esc(a.tid||'—') + '</td>';
        html += '<td>' + esc(accLabel) + '</td>';
        html += '<td><span class="badge ' + badge + '">' + esc(a.verification_status) + '</span></td>';
        html += '<td>' + feeStr + '</td>';
        html += '<td>' + fmtDate(a.created_at) + '</td>';
        html += '<td><button class="btn sm" onclick="openPayment(' + a.id + ')">Review</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  };

  window.openPayment = async function(id){
    try {
      var d = await api('/api/admin/tid/accounts/' + id);
      var a = d.account;
      var files = d.files || [];
      var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
      var accLabel;
      if(isBroker){
        var mode = String(a.broker_account_mode || '').toUpperCase() === 'DEMO' ? 'Demo' : 'Real';
        accLabel = (a.broker_name || 'Broker') + ' · ' + mode + ' · ID: ' + (a.broker_account_id || '—');
      } else {
        accLabel = (a.firm_name || 'Firm') + ' · $' + (Number(a.account_size_cents||0)/100).toLocaleString('en-US');
      }
      var status = String(a.verification_status || '').toUpperCase();
      var badge = (status === 'PAID_PENDING') ? 'approved' : 'pending';
      var feeStr = '$' + (Number(a.verification_fee_cents||0)/100).toFixed(0);

      var p = [];
      p.push('<div class="top"><div><div class="eyebrow">Payment Review</div>');
      p.push('<h1>' + esc(a.payment_request_no || 'No Request') + '</h1>');
      p.push('<p>' + esc(a.tid||'—') + ' · ' + esc(a.legal_name||'—') + '</p></div>');
      p.push('<button class="btn secondary" onclick="loadPaymentRequests()">← Back</button></div>');

      p.push('<div class="panel">');
      p.push('<div class="detail-card">');
      p.push('<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge ' + badge + '">' + esc(status) + '</span></span></div>');
      p.push('<div class="detail-row"><span class="detail-label">Request No</span><span class="detail-value">' + esc(a.payment_request_no || '—') + '</span></div>');
      p.push('<div class="detail-row"><span class="detail-label">User</span><span class="detail-value">' + esc(a.legal_name || '—') + '</span></div>');
      p.push('<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">' + esc(a.email || '—') + '</span></div>');
      p.push('<div class="detail-row"><span class="detail-label">Account</span><span class="detail-value">' + esc(accLabel) + '</span></div>');
      p.push('<div class="detail-row"><span class="detail-label">Fee</span><span class="detail-value">' + feeStr + '</span></div>');
      var linkShow = a.payment_ref ? '<a href="' + esc(a.payment_ref) + '" target="_blank" style="color:#76e5b5">Link saved</a>' : '—';
      p.push('<div class="detail-row"><span class="detail-label">Payment Link</span><span class="detail-value">' + linkShow + '</span></div>');
      p.push('<div class="detail-row"><span class="detail-label">Transaction ID</span><span class="detail-value">' + esc(a.transaction_id || '—') + '</span></div>');
      p.push('</div>');

      if(files.length){
        p.push('<h3 style="margin:16px 0 10px;font-size:13.5px">Uploaded Files (' + files.length + ')</h3>');
        files.forEach(function(f){
          p.push('<div class="file-row"><div><b>' + esc(f.file_type) + '</b>');
          p.push('<div class="meta">' + fmtBytes(f.file_size) + ' · ' + esc(f.mime_type||'') + ' · ' + fmtDate(f.uploaded_at) + '</div></div>');
          p.push('<button class="btn sm secondary" onclick="viewFile(' + f.id + ')">View</button></div>');
        });
      }

      if(status === 'PAID_REQUESTED' || status === 'AWAITING_PAYMENT'){
        p.push('<h3 style="margin:20px 0 10px;font-size:13.5px">Step 1 — Save Payment Link</h3>');
        p.push('<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">');
        p.push('<input class="input" id="payLinkInput" type="url" placeholder="https://razorpay.me/@..." style="flex:1;min-width:240px">');
        p.push('<button class="btn" onclick="savePaymentLink(' + a.id + ')">Save & Notify</button>');
        p.push('</div>');
        p.push('<p style="color:var(--muted);font-size:11.5px;margin-top:8px">Saving will send you a ready-to-forward email.</p>');
      } else if(status === 'LINK_SENT'){
        p.push('<h3 style="margin:20px 0 10px;font-size:13.5px">Step 2 — Mark as Paid</h3>');
        p.push('<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">');
        p.push('<input class="input" id="txnIdInput" type="text" placeholder="Transaction ID (UPI/Razorpay ref)" style="flex:1;min-width:240px">');
        p.push('<button class="btn" onclick="markPaid(' + a.id + ')">Mark Paid</button>');
        p.push('</div>');
      } else if(status === 'PAID_PENDING'){
        p.push('<h3 style="margin:20px 0 10px;font-size:13.5px">Step 3 — Set Metrics & Verify</h3>');
        p.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">');
        p.push('<input class="input" id="vmTrades" type="number" min="0" placeholder="Total Trades">');
        p.push('<input class="input" id="vmWins" type="number" min="0" placeholder="Wins">');
        p.push('<input class="input" id="vmLosses" type="number" min="0" placeholder="Losses">');
        p.push('<input class="input" id="vmProfit" type="number" step="0.01" placeholder="Profit %">');
        p.push('<input class="input" id="vmBestWin" type="number" step="0.01" placeholder="Best Win ($)">');
        p.push('<input class="input" id="vmWorstLoss" type="number" step="0.01" placeholder="Worst Loss ($)">');
        p.push('</div>');
        p.push('<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">');
        p.push('<button class="btn" onclick="verifyPaymentWithMetrics(' + a.id + ')">✓ Verify</button>');
        p.push('<button class="btn red" onclick="rejectPayment(' + a.id + ')">✕ Reject</button>');
        p.push('</div>');
      }

      p.push('</div>');
      $('paymentDetailWrap').innerHTML = p.join('');
      $('paymentDetailWrap').classList.remove('hidden');
      $('paymentListWrap').classList.add('hidden');
    } catch(e){ setError(e.message); }
  };

  window.savePaymentLink = async function(id){
    var input = $('payLinkInput');
    var link = input ? input.value.trim() : '';
    if(!link){ alert('Enter payment link first'); return; }
    if(!/^https?:\/\//i.test(link)){ alert('Link must start with http:// or https://'); return; }
    try {
      await api('/api/admin/tid/accounts/' + id + '/save-payment-link', { method:'POST', body:{ payment_link: link } });
      alert('Payment link saved. Check your email for the ready-to-forward template.');
      loadPaymentRequests();
    } catch(e){ setError(e.message); }
  };

  window.markPaid = async function(id){
    var el = $('txnIdInput');
    var txn = el ? el.value.trim() : '';
    if(!txn){ if(!confirm('No transaction ID entered. Mark as paid anyway?')) return; }
    try {
      await api('/api/admin/tid/accounts/' + id + '/mark-paid', { method:'POST', body:{ transaction_id: txn } });
      alert('Marked as paid');
      openPayment(id);
    } catch(e){ setError(e.message); }
  };

  window.verifyPaymentWithMetrics = async function(id){
    function n(elId){ var el = $(elId); return el ? Number(el.value) || 0 : 0; }
    var payload = {
      total_trades: n('vmTrades'),
      total_wins: n('vmWins'),
      total_losses: n('vmLosses'),
      profit_bps: Math.round(n('vmProfit') * 100),
      biggest_win_cents: Math.round(n('vmBestWin') * 100),
      biggest_loss_cents: Math.round(n('vmWorstLoss') * 100)
    };
    if(!confirm('Verify this account with the entered metrics?')) return;
    try {
      await api('/api/admin/tid/accounts/' + id + '/verify', { method:'POST', body: payload });
      alert('Account verified');
      loadPaymentRequests();
    } catch(e){ setError(e.message); }
  };

  window.rejectPayment = async function(id){
    var reason = prompt('Rejection reason:');
    if(reason === null) return;
    try {
      await api('/api/admin/tid/accounts/' + id + '/reject', { method:'POST', body:{ reason: reason } });
      alert('Rejected');
      loadPaymentRequests();
    } catch(e){ setError(e.message); }
  };

  var origShowView = window.showView;
  window.showView = function(view){
    if(view === 'payments'){
      document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
      var el = document.getElementById('view-payments');
      if(el) el.classList.add('active');
      document.querySelectorAll('.nav button[data-view]').forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-view') === view);
      });
      setError('');
      loadPaymentRequests();
      if(window.closeDrawer) window.closeDrawer();
      return;
    }
    if(typeof origShowView === 'function') return origShowView(view);
  };
})();