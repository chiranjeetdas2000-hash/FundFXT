(function(){
  'use strict';
  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('fundfxt_admin_token');
  if(!token){ location.href = '/admin/login.html'; return; }

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
    if(res.status === 401 || res.status === 403){
      if(!opts.noRedirect && path.indexOf('/admin/tid/overview') !== -1){
        localStorage.removeItem('fundfxt_admin_token');
        location.href = '/admin/login.html';
        throw new Error('unauth');
      }
    }
    var data = {};
    try { data = await res.json(); } catch(_){}
    if(!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  var sidebar = document.getElementById('adminSidebar');
  var menuToggle = document.getElementById('menuToggle');
  var sidebarClose = document.getElementById('sidebarClose');
  var drawerBackdrop = document.getElementById('drawerBackdrop');

  function openDrawer(){
    if(sidebar) sidebar.classList.add('open');
    if(drawerBackdrop) drawerBackdrop.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer(){
    if(sidebar) sidebar.classList.remove('open');
    if(drawerBackdrop) drawerBackdrop.classList.remove('show');
    document.body.style.overflow = '';
  }
  if(menuToggle) menuToggle.addEventListener('click', openDrawer);
  if(sidebarClose) sidebarClose.addEventListener('click', closeDrawer);
  if(drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeDrawer(); });
  window.closeDrawer = closeDrawer;

  window.showView = function(view){
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
    var el = document.getElementById('view-' + view);
    if(el) el.classList.add('active');
    document.querySelectorAll('.nav button[data-view]').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-view') === view); });
    setError('');
    if(view === 'overview') loadOverview();
    else if(view === 'kyc') loadKycQueue();
    else if(view === 'accounts') loadAccountQueue();
    else if(view === 'users') loadUsers();
    else if(view === 'payments') loadPaymentRequests();
    if(window.closeDrawer) window.closeDrawer();
  };

  // ---------- OVERVIEW ----------
  async function loadOverview(){
    try {
      var d = await api('/api/admin/tid/overview');
      $('ovUsers').textContent = d.counts.total_users;
      $('ovKyc').textContent = d.counts.kyc_pending;
      $('ovAccounts').textContent = d.counts.accounts_pending;
      $('ovFiles').textContent = d.counts.files_pending;
    } catch(e){ setError(e.message); }
  }

  // ---------- KYC ----------
  async function loadKycQueue(){
    $('kycDetailWrap').classList.add('hidden');
    $('kycListWrap').classList.remove('hidden');
    var list = $('kycList');
    list.innerHTML = '<div class="loading">Loading KYC queue…</div>';
    try {
      var d = await api('/api/admin/tid/kyc/pending');
      if(!d.submissions.length){ list.innerHTML = '<div class="empty">No pending KYC submissions.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>TID</th><th>Name</th><th>Country</th><th>ID Type</th><th>Submitted</th><th>Action</th></tr></thead><tbody>';
      d.submissions.forEach(function(s){
        html += '<tr><td>' + s.id + '</td><td><b>' + esc(s.tid||'—') + '</b></td><td>' + esc(s.legal_name||'—') + '</td><td>' + esc(s.country) + '</td><td>' + esc(s.id_type) + '</td><td>' + fmtDate(s.created_at) + '</td><td><button class="btn sm" onclick="openKyc(' + s.id + ')">Review</button></td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  window.openKyc = async function(id){
    try {
      var d = await api('/api/admin/tid/kyc/' + id);
      var k = d.kyc;
      var html = '<div class="top"><div><div class="eyebrow">KYC Review</div><h1>Submission #' + k.id + '</h1><p>' + esc(k.tid||'—') + ' · ' + esc(k.legal_name||'—') + '</p></div><button class="btn secondary" onclick="loadKycQueue()">← Back</button></div>';
      html += '<div class="panel">';
      html += '<div class="detail-card">';
      html += '<div class="detail-row"><span class="detail-label">TID</span><span class="detail-value">' + esc(k.tid||'—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Legal Name</span><span class="detail-value">' + esc(k.legal_name||'—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">' + esc(k.email||'—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Country</span><span class="detail-value">' + esc(k.country) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">ID Type</span><span class="detail-value">' + esc(k.id_type) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Address Type</span><span class="detail-value">' + esc(k.address_type) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">IP Address</span><span class="detail-value">' + esc(k.ip_address||'—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Timezone</span><span class="detail-value">' + esc(k.timezone||'—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Device FP</span><span class="detail-value">' + esc(k.device_fingerprint||'—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Submitted</span><span class="detail-value">' + fmtDate(k.created_at) + '</span></div>';
      html += '</div>';
      html += '<h3 style="margin:16px 0 10px;font-size:13.5px;letter-spacing:.02em">Documents</h3>';
      html += '<div id="kycFiles">Loading…</div>';
      html += '<div id="kycDuplicates" style="margin-top:16px"></div>';
      html += '<div class="actions-row"><button class="btn" onclick="approveKyc(' + k.id + ')">✓ Approve</button><button class="btn red" onclick="rejectKyc(' + k.id + ')">✕ Reject</button></div>';
      html += '</div>';
      $('kycDetailWrap').innerHTML = html;
      $('kycDetailWrap').classList.remove('hidden');
      $('kycListWrap').classList.add('hidden');
      loadKycFiles(k.id_file_id, k.selfie_file_id, k.address_file_id);
      loadKycDuplicates(k.id);
    } catch(e){ setError(e.message); }
  };

  async function loadKycFiles(idFileId, selfieFileId, addressFileId){
    var wrap = $('kycFiles'); if(!wrap) return;
    var files = [
      { id: idFileId, label: 'Identity Document' },
      { id: selfieFileId, label: 'Selfie with ID' },
      { id: addressFileId, label: 'Address Proof' }
    ];
    var html = '';
    for(var i=0;i<files.length;i++){
      var f = files[i];
      if(!f.id){ html += '<div class="file-row"><span>'+f.label+'</span><span style="color:var(--muted)">Missing</span></div>'; continue; }
      html += '<div class="file-row"><div><b>'+f.label+'</b><div class="meta">File #'+f.id+'</div></div><button class="btn sm secondary" onclick="viewFile('+f.id+')">View File</button></div>';
    }
    wrap.innerHTML = html;
  }

  async function loadKycDuplicates(id){
    var wrap = document.getElementById('kycDuplicates');
    if(!wrap) return;
    wrap.innerHTML = '<div style="color:var(--muted);font-size:12px">Checking for duplicates…</div>';
    try {
      var d = await api('/api/admin/tid/kyc/' + id + '/duplicates');
      if(!d.matches || !d.matches.length){ wrap.innerHTML = ''; return; }
      var html = '<div style="padding:14px;border:1px solid rgba(255,176,32,.4);background:rgba(255,176,32,.08);border-radius:12px">';
      html += '<div style="font-weight:800;color:#ffc94d;margin-bottom:10px;font-size:13px">⚠️ ' + d.matches.length + ' Duplicate Match' + (d.matches.length>1?'es':'') + ' Found</div>';
      d.matches.forEach(function(m){
        html += '<div style="padding:10px;background:var(--surface3);border-radius:9px;margin-bottom:8px;font-size:12.5px">';
        html += '<div><b>' + (m.tid||'—') + '</b> · ' + (m.legal_name||'—') + '</div>';
        html += '<div style="color:var(--muted);font-size:11px;margin-top:3px">' + (m.email||'') + '</div>';
        html += '<div style="color:#ffc94d;font-size:11px;margin-top:4px">Match: ' + ((m.match_reasons||[]).join(' · ')) + '</div>';
        html += '<div style="color:var(--muted);font-size:10.5px;margin-top:3px">Status: ' + (m.status||'') + ' · ' + fmtDate(m.created_at) + '</div>';
        html += '</div>';
      });
      html += '</div>';
      wrap.innerHTML = html;
    } catch(e){
      wrap.innerHTML = '<div style="color:var(--red);font-size:12px">Duplicate check failed: ' + esc(e.message) + '</div>';
    }
  }

  async function loadKycDuplicates(id){
    var wrap = document.getElementById('kycDuplicates');
    if(!wrap) return;
    wrap.innerHTML = '<div style="color:var(--muted);font-size:12px">Checking for duplicates…</div>';
    try {
      var d = await api('/api/admin/tid/kyc/' + id + '/duplicates');
      if(!d.matches || !d.matches.length){ wrap.innerHTML = ''; return; }
      var html = '<div style="padding:14px;border:1px solid rgba(255,176,32,.4);background:rgba(255,176,32,.08);border-radius:12px">';
      html += '<div style="font-weight:800;color:#ffc94d;margin-bottom:10px;font-size:13px">⚠️ ' + d.matches.length + ' Duplicate Match' + (d.matches.length>1?'es':'') + ' Found</div>';
      d.matches.forEach(function(m){
        html += '<div style="padding:10px;background:var(--surface3);border-radius:9px;margin-bottom:8px;font-size:12.5px">';
        html += '<div><b>' + (m.tid||'—') + '</b> · ' + (m.legal_name||'—') + '</div>';
        html += '<div style="color:var(--muted);font-size:11px;margin-top:3px">' + (m.email||'') + '</div>';
        html += '<div style="color:#ffc94d;font-size:11px;margin-top:4px">Match: ' + ((m.match_reasons||[]).join(' · ')) + '</div>';
        html += '<div style="color:var(--muted);font-size:10.5px;margin-top:3px">Status: ' + (m.status||'') + ' · ' + fmtDate(m.created_at) + '</div>';
        html += '</div>';
      });
      html += '</div>';
      wrap.innerHTML = html;
    } catch(e){
      wrap.innerHTML = '<div style="color:var(--red);font-size:12px">Duplicate check failed: ' + esc(e.message) + '</div>';
    }
  }

  window.viewFile = async function(id){
    try {
      var d = await api('/api/admin/tid/files/' + id + '/url');
      window.open(d.url, '_blank');
    } catch(e){ setError(e.message); }
  };

  window.approveKyc = async function(id){
    if(!confirm('Approve this KYC submission?')) return;
    try { await api('/api/admin/tid/kyc/' + id + '/approve', { method: 'POST' }); alert('Approved'); loadKycQueue(); }
    catch(e){ setError(e.message); }
  };

  window.rejectKyc = async function(id){
    var reason = prompt('Rejection reason (visible to user):');
    if(reason === null) return;
    try { await api('/api/admin/tid/kyc/' + id + '/reject', { method: 'POST', body: { reason: reason } }); alert('Rejected'); loadKycQueue(); }
    catch(e){ setError(e.message); }
  };

  // ---------- ACCOUNTS ----------
  async function loadAccountQueue(){
    $('accountDetailWrap').classList.add('hidden');
    $('accountListWrap').classList.remove('hidden');
    var list = $('accountList');
    list.innerHTML = '<div class="loading">Loading account queue…</div>';
    try {
      var d = await api('/api/admin/tid/accounts/pending');
      if(!d.accounts.length){ list.innerHTML = '<div class="empty">No pending accounts.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>TID</th><th>Firm</th><th>Size</th><th>Type</th><th>Files</th><th>Created</th><th>Action</th></tr></thead><tbody>';
      d.accounts.forEach(function(a){
        html += '<tr><td>' + a.id + '</td><td><b>' + esc(a.tid||'—') + '</b></td><td>' + esc(a.firm_name) + '</td><td>$' + (Number(a.account_size_cents||0)/100).toLocaleString('en-US') + '</td><td>' + esc(a.account_type) + '</td><td>' + (a.files_count||0) + '</td><td>' + fmtDate(a.created_at) + '</td><td><button class="btn sm" onclick="openAccount(' + a.id + ')">Review</button></td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  window.openAccount = async function(id){
    try {
      var d = await api('/api/admin/tid/accounts/' + id);
      var a = d.account, files = d.files || [];
      var html = '<div class="top"><div><div class="eyebrow">Account Review</div><h1>' + esc(a.firm_name) + '</h1><p>' + esc(a.tid||'—') + ' · ' + esc(a.legal_name||'—') + '</p></div><button class="btn secondary" onclick="loadAccountQueue()">← Back</button></div>';
      html += '<div class="panel">';
      html += '<div class="detail-card">';
      html += '<div class="detail-row"><span class="detail-label">User</span><span class="detail-value">' + esc(a.tid||'—') + ' · ' + esc(a.legal_name||'—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Firm</span><span class="detail-value">' + esc(a.firm_name) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">$' + (Number(a.account_size_cents||0)/100).toLocaleString('en-US') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">' + esc(a.account_type) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">' + esc(a.status) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Verification</span><span class="detail-value">' + esc(a.verification_status) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">' + fmtDate(a.created_at) + '</span></div>';
      html += '</div>';
      html += '<h3 style="margin:16px 0 10px;font-size:13.5px">Uploaded Files (' + files.length + ')</h3>';
      if(files.length){
        files.forEach(function(f){
          html += '<div class="file-row"><div><b>' + esc(f.file_type) + '</b><div class="meta">' + fmtBytes(f.file_size) + ' · ' + esc(f.mime_type||'') + ' · ' + fmtDate(f.uploaded_at) + '</div></div><button class="btn sm secondary" onclick="viewFile(' + f.id + ')">View</button></div>';
        });
      } else {
        html += '<div class="empty">No files uploaded.</div>';
      }
      html += '<div class="actions-row"><button class="btn" onclick="verifyAccount(' + a.id + ')">✓ Verify Account</button><button class="btn red" onclick="rejectAccount(' + a.id + ')">✕ Reject</button></div>';
      html += '</div>';
      $('accountDetailWrap').innerHTML = html;
      $('accountDetailWrap').classList.remove('hidden');
      $('accountListWrap').classList.add('hidden');
    } catch(e){ setError(e.message); }
  };

  window.verifyAccount = async function(id){
    if(!confirm('Mark this account as VERIFIED? Files will be approved.')) return;
    try { await api('/api/admin/tid/accounts/' + id + '/verify', { method: 'POST' }); alert('Verified'); loadAccountQueue(); }
    catch(e){ setError(e.message); }
  };

  window.rejectAccount = async function(id){
    var reason = prompt('Rejection reason:');
    if(reason === null) return;
    try { await api('/api/admin/tid/accounts/' + id + '/reject', { method: 'POST', body: { reason: reason } }); alert('Rejected'); loadAccountQueue(); }
    catch(e){ setError(e.message); }
  };

  // ---------- PAYMENT REQUESTS ----------
  async function loadPaymentRequests(){
    $('paymentDetailWrap').classList.add('hidden');
    $('paymentListWrap').classList.remove('hidden');
    var list = $('paymentList');
    list.innerHTML = '<div class="loading">Loading payment requests…</div>';
    try {
      var d = await api('/api/admin/tid/accounts/payment-requests');
      if(!d.accounts.length){ list.innerHTML = '<div class="empty">No payment requests.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>Req No</th><th>TID</th><th>Account</th><th>Status</th><th>Fee</th><th>Created</th><th>Action</th></tr></thead><tbody>';
      d.accounts.forEach(function(a){
        var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
        var accLabel = isBroker
          ? (a.broker_name || 'Broker') + ' · ' + (String(a.broker_account_mode || '').toUpperCase() === 'DEMO' ? 'Demo' : 'Real')
          : (a.firm_name || 'Firm') + ' · 
  async function loadUsers(){
    var list = $('usersList');
    list.innerHTML = '<div class="loading">Loading users…</div>';
    try {
      var search = $('userSearch').value.trim();
      var d = await api('/api/admin/tid/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
      if(!d.users.length){ list.innerHTML = '<div class="empty">No users found.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>TID</th><th>Name</th><th>Email</th><th>Rank</th><th>Verified</th><th>Joined</th></tr></thead><tbody>';
      d.users.forEach(function(u){
        html += '<tr><td>' + u.id + '</td><td><b>' + esc(u.tid||'—') + '</b></td><td>' + esc(u.legal_name||'—') + '</td><td>' + esc(u.email||'—') + '</td><td>' + esc(u.current_rank||'ROOKIE') + '</td><td>' + (u.email_verified?'✅':'—') + '</td><td>' + fmtDate(u.created_at) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  // ---------- INIT ----------
  loadOverview();
})(); + (Number(a.account_size_cents||0)/100).toLocaleString('en-US');
        var badge = (a.verification_status === 'PAID_PENDING') ? 'approved' : (a.verification_status === 'PAID_REQUESTED' || a.verification_status === 'LINK_SENT') ? 'pending' : 'none';
        html += '<tr><td><b style="font-family:Consolas,monospace">' + esc(a.payment_request_no || '—') + '</b></td><td>' + esc(a.tid||'—') + '</td><td>' + esc(accLabel) + '</td><td><span class="badge ' + badge + '">' + esc(a.verification_status) + '</span></td><td>
  async function loadUsers(){
    var list = $('usersList');
    list.innerHTML = '<div class="loading">Loading users…</div>';
    try {
      var search = $('userSearch').value.trim();
      var d = await api('/api/admin/tid/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
      if(!d.users.length){ list.innerHTML = '<div class="empty">No users found.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>TID</th><th>Name</th><th>Email</th><th>Rank</th><th>Verified</th><th>Joined</th></tr></thead><tbody>';
      d.users.forEach(function(u){
        html += '<tr><td>' + u.id + '</td><td><b>' + esc(u.tid||'—') + '</b></td><td>' + esc(u.legal_name||'—') + '</td><td>' + esc(u.email||'—') + '</td><td>' + esc(u.current_rank||'ROOKIE') + '</td><td>' + (u.email_verified?'✅':'—') + '</td><td>' + fmtDate(u.created_at) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  // ---------- INIT ----------
  loadOverview();
})(); + (Number(a.verification_fee_cents||0)/100).toFixed(0) + '</td><td>' + fmtDate(a.created_at) + '</td><td><button class="btn sm" onclick="openPayment(' + a.id + ')">Review</button></td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  window.openPayment = async function(id){
    try {
      var d = await api('/api/admin/tid/accounts/' + id);
      var a = d.account, files = d.files || [];
      var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
      var accLabel = isBroker
        ? (a.broker_name || 'Broker') + ' · ' + (String(a.broker_account_mode || '').toUpperCase() === 'DEMO' ? 'Demo' : 'Real') + ' · ID: ' + (a.broker_account_id || '—')
        : (a.firm_name || 'Firm') + ' · 
  async function loadUsers(){
    var list = $('usersList');
    list.innerHTML = '<div class="loading">Loading users…</div>';
    try {
      var search = $('userSearch').value.trim();
      var d = await api('/api/admin/tid/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
      if(!d.users.length){ list.innerHTML = '<div class="empty">No users found.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>TID</th><th>Name</th><th>Email</th><th>Rank</th><th>Verified</th><th>Joined</th></tr></thead><tbody>';
      d.users.forEach(function(u){
        html += '<tr><td>' + u.id + '</td><td><b>' + esc(u.tid||'—') + '</b></td><td>' + esc(u.legal_name||'—') + '</td><td>' + esc(u.email||'—') + '</td><td>' + esc(u.current_rank||'ROOKIE') + '</td><td>' + (u.email_verified?'✅':'—') + '</td><td>' + fmtDate(u.created_at) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  // ---------- INIT ----------
  loadOverview();
})(); + (Number(a.account_size_cents||0)/100).toLocaleString('en-US');
      var status = String(a.verification_status || '').toUpperCase();
      var badge = (status === 'PAID_PENDING') ? 'approved' : 'pending';

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
      p.push('<div class="detail-row"><span class="detail-label">Fee</span><span class="detail-value">
  async function loadUsers(){
    var list = $('usersList');
    list.innerHTML = '<div class="loading">Loading users…</div>';
    try {
      var search = $('userSearch').value.trim();
      var d = await api('/api/admin/tid/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
      if(!d.users.length){ list.innerHTML = '<div class="empty">No users found.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>TID</th><th>Name</th><th>Email</th><th>Rank</th><th>Verified</th><th>Joined</th></tr></thead><tbody>';
      d.users.forEach(function(u){
        html += '<tr><td>' + u.id + '</td><td><b>' + esc(u.tid||'—') + '</b></td><td>' + esc(u.legal_name||'—') + '</td><td>' + esc(u.email||'—') + '</td><td>' + esc(u.current_rank||'ROOKIE') + '</td><td>' + (u.email_verified?'✅':'—') + '</td><td>' + fmtDate(u.created_at) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  // ---------- INIT ----------
  loadOverview();
})(); + (Number(a.verification_fee_cents||0)/100).toFixed(0) + '</span></div>');
      var linkShow = a.payment_ref ? '<a href="' + esc(a.payment_ref) + '" target="_blank" style="color:#76e5b5">' + esc(String(a.payment_ref).substring(0,60)) + '</a>' : '—';
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
        p.push('<input class="input" id="payLinkInput" type="url" placeholder="https://razorpay.me/@..." style="flex:1;min-width:240px" value="' + esc(a.payment_ref || '') + '">');
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
    var txn = $('txnIdInput') ? $('txnIdInput').value.trim() : '';
    if(!txn){ if(!confirm('No transaction ID entered. Mark as paid anyway?')) return; }
    try {
      await api('/api/admin/tid/accounts/' + id + '/mark-paid', { method:'POST', body:{ transaction_id: txn } });
      alert('Marked as paid');
      openPayment(id);
    } catch(e){ setError(e.message); }
  };

  window.verifyPaymentWithMetrics = async function(id){
    var n = function(elId){ var el = $(elId); return el ? Number(el.value) || 0 : 0; };
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

  // ---------- USERS ----------
  async function loadUsers(){
    var list = $('usersList');
    list.innerHTML = '<div class="loading">Loading users…</div>';
    try {
      var search = $('userSearch').value.trim();
      var d = await api('/api/admin/tid/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
      if(!d.users.length){ list.innerHTML = '<div class="empty">No users found.</div>'; return; }
      var html = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>TID</th><th>Name</th><th>Email</th><th>Rank</th><th>Verified</th><th>Joined</th></tr></thead><tbody>';
      d.users.forEach(function(u){
        html += '<tr><td>' + u.id + '</td><td><b>' + esc(u.tid||'—') + '</b></td><td>' + esc(u.legal_name||'—') + '</td><td>' + esc(u.email||'—') + '</td><td>' + esc(u.current_rank||'ROOKIE') + '</td><td>' + (u.email_verified?'✅':'—') + '</td><td>' + fmtDate(u.created_at) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){ list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  // ---------- INIT ----------
  loadOverview();
})();