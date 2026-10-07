(function(){
  'use strict';
  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('tid_token');
  if(!token) return;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function fmtMoney(cents){ var n = Number(cents || 0) / 100; if(n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'; if(n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; return '$' + n.toFixed(0); }
  function fmtNum(v){ return Number(v || 0).toLocaleString('en-US'); }

  function groupFirms(accounts){
    var map = {};
    var i;
    for(i = 0; i < accounts.length; i++){
      var a = accounts[i];
      var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
      var name = isBroker ? (a.broker_name || 'Broker') : (a.firm_name || 'Firm');
      var key = (isBroker ? 'B::' : 'F::') + name;
      if(!map[key]){
        map[key] = { type: isBroker ? 'BROKER' : 'PROP_FIRM', name: name, accounts: [], totalScore: 0, scoredCount: 0 };
      }
      var g = map[key];
      g.accounts.push(a);
      var sc = Number(a.account_score) || 0;
      if(sc > 0){ g.totalScore += sc; g.scoredCount += 1; }
    }
    var out = [];
    for(var k in map){
      if(map.hasOwnProperty(k)){
        var item = map[k];
        item.accountCount = item.accounts.length;
        item.score = item.scoredCount > 0 ? Math.round(item.totalScore / item.scoredCount) : 0;
        delete item.totalScore;
        delete item.scoredCount;
        out.push(item);
      }
    }
    out.sort(function(a, b){ return b.score - a.score; });
    return out;
  }

  function renderFirmCard(firm){
    var accs = firm.accounts;
    var totalTrades = 0;
    var totalPips = 0;
    var i;
    for(i = 0; i < accs.length; i++){
      totalTrades += Number(accs[i].total_trades) || 0;
      totalPips += Number(accs[i].total_pips) || 0;
    }
    var pipsColor = totalPips >= 0 ? '#10B981' : '#EF4444';
    var pipsSign = totalPips >= 0 ? '+' : '';

    var h = '';
    h += '<div class="firm-card" data-name="' + esc(firm.name) + '" data-type="' + esc(firm.type) + '">';
    h += '<div class="firm-head">';
    h += '<div>';
    h += '<div class="firm-name">' + esc(firm.name) + '</div>';
    h += '<div class="firm-type">' + esc(firm.type === 'BROKER' ? 'Broker' : 'Prop Firm') + ' · ' + firm.accountCount + (firm.accountCount === 1 ? ' account' : ' accounts') + '</div>';
    h += '</div>';
    h += '<div class="firm-score">';
    h += '<div class="firm-score-val">' + firm.score + '</div>';
    h += '<div class="firm-score-lbl">SCORE</div>';
    h += '</div>';
    h += '</div>';

    h += '<div class="firm-meta">';
    h += '<div class="firm-meta-item"><b>' + totalTrades + '</b><span>Trades</span></div>';
    h += '<div class="firm-meta-item"><b style="color:' + pipsColor + '">' + pipsSign + totalPips.toFixed(0) + '</b><span>Net Pips</span></div>';
    h += '<div class="firm-meta-item"><b>' + firm.accountCount + '</b><span>Accounts</span></div>';
    h += '</div>';

    h += '<div class="firm-accounts">';
    for(i = 0; i < accs.length; i++){
      var a = accs[i];
      var isBroker = String(a.account_category || '').toUpperCase() === 'BROKER';
      var sub = isBroker
        ? ('ID: ' + (a.broker_account_id || '—') + ' · ' + (String(a.broker_account_mode || '').toUpperCase() === 'DEMO' ? 'Demo' : 'Real'))
        : ('$' + ((Number(a.account_size_cents) || 0) / 100).toLocaleString('en-US') + ' · ' + (a.account_type || ''));
      var wl = (Number(a.total_wins) || 0) + '/' + ((Number(a.total_wins) || 0) + (Number(a.total_losses) || 0));
      h += '<div class="firm-account" data-id="' + a.id + '">';
      h += '<div class="fa-left">';
      h += '<div class="fa-sub">' + esc(sub) + '</div>';
      h += '<div class="fa-stats">';
      h += '<span>' + (Number(a.total_trades) || 0) + ' trades</span>';
      h += '<span>·</span>';
      h += '<span>' + wl + ' W/L</span>';
      h += '<span>·</span>';
      h += '<span>' + (a.account_score || 0) + ' score</span>';
      h += '</div>';
      h += '</div>';
      h += '<button class="fa-open" data-id="' + a.id + '">Open →</button>';
      h += '</div>';
    }
    h += '</div>';

    h += '<div class="firm-actions">';
    h += '<button class="btn btn-ghost firm-add-btn" data-name="' + esc(firm.name) + '" data-type="' + esc(firm.type) + '">+ Add ' + esc(firm.name) + ' Account</button>';
    h += '</div>';

    h += '</div>';
    return h;
  }

  function renderAll(firms){
    var container = $('accountsList');
    if(!container) return;
    if(!firms.length){
      container.innerHTML = '<div class="empty"><div class="empty-title">No accounts yet</div><div class="empty-text">Add your first firm or broker account to start building your verified record.</div></div>';
      var ac = $('accountsCount'); if(ac) ac.textContent = '0 accounts';
      return;
    }
    var totalAccs = 0;
    var i;
    for(i = 0; i < firms.length; i++) totalAccs += firms[i].accountCount;
    var acEl = $('accountsCount');
    if(acEl) acEl.textContent = totalAccs + (totalAccs === 1 ? ' account' : ' accounts') + ' · ' + firms.length + (firms.length === 1 ? ' firm' : ' firms');

    var html = '<div class="firms-grid">';
    for(i = 0; i < firms.length; i++){
      html += renderFirmCard(firms[i]);
    }
    html += '</div>';
    container.innerHTML = html;

    var opens = container.querySelectorAll('.fa-open');
    for(i = 0; i < opens.length; i++){
      opens[i].addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-id');
        window.location.href = '/tradersid/account.html?id=' + id;
      });
    }

    var cards = container.querySelectorAll('.firm-card');
    for(i = 0; i < cards.length; i++){
      cards[i].addEventListener('click', function(e){
        if(e.target.tagName === 'BUTTON') return;
        window.location.href = '/tradersid/firm.html?type=' + encodeURIComponent(this.getAttribute('data-type')) + '&name=' + encodeURIComponent(this.getAttribute('data-name'));
      });
    }

    var addBtns = container.querySelectorAll('.firm-add-btn');
    for(i = 0; i < addBtns.length; i++){
      addBtns[i].addEventListener('click', function(e){
        e.stopPropagation();
        if(typeof window.openAccountModal === 'function'){
          window.openAccountModal();
          setTimeout(function(){
            var firmInput = document.getElementById('acctFirm');
            var brokerInput = document.getElementById('acctBrokerName');
            var name = this.getAttribute('data-name');
            var type = this.getAttribute('data-type');
            if(type === 'BROKER' && brokerInput){ brokerInput.value = name; }
            else if(firmInput){ firmInput.value = name; }
            var radioBroker = document.querySelector('input[name="acctCategory"][value="BROKER"]');
            var radioFirm = document.querySelector('input[name="acctCategory"][value="PROP_FIRM"]');
            if(type === 'BROKER' && radioBroker){ radioBroker.checked = true; radioBroker.dispatchEvent(new Event('change')); }
            else if(radioFirm){ radioFirm.checked = true; radioFirm.dispatchEvent(new Event('change')); }
          }.bind(this), 100);
        }
      });
    }
  }

  window.loadFirmCards = function(){
    var container = $('accountsList');
    if(!container) return;
    container.innerHTML = '<div class="loading-firms">Loading accounts…</div>';
    fetch(API + '/api/tid/firms', {headers: {Authorization: 'Bearer ' + token}})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.success || !d.rows) throw new Error('Failed');
        var firms = groupFirms(d.rows);
        renderAll(firms);
      })
      .catch(function(e){
        container.innerHTML = '<div class="empty"><div class="empty-title">Unable to load</div><div class="empty-text">' + esc(e.message) + '</div></div>';
      });
  };

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(function(){
      if(typeof window.loadFirmCards === 'function'){
        window.loadFirmCards();
      }
    }, 400);
  });
})();
