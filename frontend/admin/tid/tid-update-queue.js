(function(){
  'use strict';
  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('fundfxt_admin_token');

  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function fmtDate(s){ if(!s) return '—'; try{ return new Date(s).toLocaleString('en-IN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(_){ return '—'; } }

  function setError(msg){
    var e = $('errBox'); if(!e) return;
    if(msg){ e.textContent = msg; e.classList.add('show'); }
    else { e.textContent = ''; e.classList.remove('show'); }
  }

  function api(path, opts){
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function(res){
      return res.json().then(function(data){
        if(!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
        return data;
      });
    });
  }

  window.loadUpdateQueue = async function(){
    var list = $('updateQueueList');
    if(!list) return;
    list.innerHTML = '<div class="loading">Loading update queue…</div>';
    try {
      var d = await api('/api/admin/tid/update-queue');
      var items = d.items || [];
      if(!items.length){
        list.innerHTML = '<div class="empty">No pending update requests.</div>';
        return;
      }
      var html = '<div class="table-wrap"><table><thead><tr><th>Account</th><th>TID</th><th>User</th><th>Requested</th><th>Attempts</th><th>Action</th></tr></thead><tbody>';
      items.forEach(function(it){
        var label;
        if(String(it.account_category || '').toUpperCase() === 'BROKER'){
          label = (it.broker_name || 'Broker') + (it.broker_account_id ? ' · ' + it.broker_account_id : '');
        } else {
          label = (it.firm_name || 'Firm') + ' · ' + (it.account_type || 'CHALLENGE');
        }
        html += '<tr>';
        html += '<td><b>' + esc(label) + '</b></td>';
        html += '<td>' + esc(it.tid || '—') + '</td>';
        html += '<td>' + esc(it.legal_name || '—') + '</td>';
        html += '<td>' + fmtDate(it.requested_at) + '</td>';
        html += '<td>' + (Number(it.attempts) || 0) + '</td>';
        html += '<td><button class="btn sm" onclick="openUpdateItem(' + it.account_id + ')">Review</button> <button class="btn sm secondary" onclick="dismissUpdate(' + it.account_id + ')">Dismiss</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      list.innerHTML = html;
    } catch(e){
      list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  };

  window.openUpdateItem = function(accountId){
    if(typeof window.openAccount === 'function'){
      window.openAccount(accountId);
    } else {
      setError('Account detail unavailable');
    }
  };

  window.dismissUpdate = async function(accountId){
    if(!confirm('Dismiss this update request? It will be removed from the queue.')) return;
    try {
      await api('/api/admin/tid/update-queue/' + accountId + '/dismiss', { method: 'POST' });
      loadUpdateQueue();
    } catch(e){
      setError(e.message);
    }
  };

  var origShowView = window.showView;
  window.showView = function(view){
    if(view === 'updatequeue'){
      document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
      var el = document.getElementById('view-updatequeue');
      if(el) el.classList.add('active');
      document.querySelectorAll('.nav button[data-view]').forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-view') === view);
      });
      setError('');
      loadUpdateQueue();
      if(window.closeDrawer) window.closeDrawer();
      return;
    }
    if(typeof origShowView === 'function') return origShowView(view);
  };
})();