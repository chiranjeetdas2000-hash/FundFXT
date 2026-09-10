/* ============================================================
   FUNDFXT — USER DASHBOARD SCRIPT
   File: dashboard.js
   Purpose: Handles all user dashboard features
   ============================================================ */

/* ------------------------------------------------------------
   1. GLOBAL CONFIG & UTILITIES
   ------------------------------------------------------------ */
const API = 'https://fundfxt.onrender.com';
const token = localStorage.getItem('fundfxt_token');

// Redirect if not logged in
if (!token) window.location.href = '/auth.html';

// Shortcut for document.getElementById
const $ = (id) => document.getElementById(id);

// Convert cents to formatted dollar string
const money = (c) =>
  '$' + (Number(c || 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Escape HTML to prevent XSS
const esc = (v) =>
  String(v ?? '—').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));

// Central API helper with auth header
async function api(path, opt = {}) {
  const r = await fetch(API + path, {
    ...opt,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opt.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

/* ------------------------------------------------------------
   2. AUTH & NAVIGATION
   ------------------------------------------------------------ */
function handleLogout() {
  localStorage.removeItem('fundfxt_token');
  localStorage.removeItem('fundfxt_selected_account');
  location.href = '/auth.html';
}

function toggleSidebar() {
  $('sidebar')?.classList.toggle('open');
}

function toggleUserDropdown() {
  $('userDropdown')?.classList.toggle('active');
}

function toggleNotifications() {
  const p = $('notificationPanel');
  if (!p) return;
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
  if (p.style.display === 'block') fetchNotifications();
}

// Main section switcher
function showSection(name) {
  // Hide all sections
  document.querySelectorAll('.view-section').forEach((s) => s.classList.remove('active'));
  $('view-' + name)?.classList.add('active');

  // Update active sidebar link
  document.querySelectorAll('.sidebar nav a').forEach((a) => a.classList.remove('active'));
  document.querySelector(`.sidebar nav a[onclick="showSection('${name}')"]`)?.classList.add('active');

  // Close mobile sidebar
  $('sidebar')?.classList.remove('open');

  // Load data based on section
  if (name === 'home') loadHomeData();
  if (name === 'orders') fetchUserOrders();
  if (name === 'withdraw') loadWithdrawForm();
  if (name === 'affiliate') fetchAffiliateStats();
  if (name === 'certificates') fetchCertificates();
  if (name === 'support') fetchSupportTickets();
}

/* ------------------------------------------------------------
   3. PROFILE
   ------------------------------------------------------------ */
async function fetchProfile() {
  try {
    const d = await api('/api/user/profile');

    // Basic profile fields
    $('header-user-name').textContent = d.legal_name || 'Trader';
    $('profile-name').textContent = d.legal_name || 'Trader';
    $('profile-email').textContent = d.email || 'trader@fundfxt.com';
    $('profile-phone').textContent = d.phone || '+91 0000000000';
    $('profile-date').textContent = new Date().getFullYear();

    // Affiliate code
    const affEl = $('aff-code');
    if (affEl) {
      affEl.textContent = d.affiliate_code || 'AFF-PENDING';
    }
  } catch (e) {
    console.error('Profile fetch:', e);
  }
}

/* ------------------------------------------------------------
   4. ACCOUNTS
   ------------------------------------------------------------ */
function accountCard(a) {
  const p = a.account_profile || {};
  const r = p.rules || {};
  const initial = Number(a.initial_balance_cents || 0);
  const balance = Number(a.balance_cents || 0);
  const equity = Number(a.equity_cents || balance);
  const profit = balance - initial;

  const target = Number(r.profitTargetCents || 0);
  const progress = target
    ? Math.max(0, Math.min(100, (Math.max(0, profit) / target) * 100))
    : 0;

  const daily = Number(r.dailyDrawdownCents || 0);
  const dailyUsed = Math.max(0, Number(a.day_start_balance_cents || initial) - balance);
  const dailyRemaining = daily ? Math.max(0, daily - dailyUsed) : null;

  const max = Number(r.maxDrawdownCents || 0);
  const maxUsed = Math.max(0, initial - equity);
  const maxRemaining = max ? Math.max(0, max - maxUsed) : null;

  const status = a.status || 'ACTIVE';
  const code = a.account_code || 'N/A';

  return `
    <div class="account-card" data-account-code="${esc(code)}">
      <h2>${esc(code)}</h2>
      <div class="sub">${esc(p.displayName || p.model || a.challenge_model || 'Trading Account').replace(/_/g, ' ')}</div>

      <div class="account-info-grid">
        <p>Type <strong>${esc(p.accountType || 'Trading Account')}</strong></p>
        <p>Phase <strong>${esc(p.phase || '—')}</strong></p>
        <p>Funding <strong>${esc(p.fundingModel || '—')}</strong></p>
        <p>Direct Funded <strong>${p.isDirectFunded ? 'Yes' : 'No'}</strong></p>
        <p>Balance <strong>${money(balance)}</strong></p>
        <p>Equity <strong>${money(equity)}</strong></p>
        <p>Status <strong style="color:${status === 'ACTIVE' ? 'var(--green)' : 'var(--red)'}">${esc(status)}</strong></p>
        <p>Profit <strong style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${profit >= 0 ? '+' : ''}${money(profit)}</strong></p>
      </div>

      <div style="margin:12px 0;font-size:11px;color:var(--text-muted)">
        <div style="display:flex;justify-content:space-between">
          <span>Target progress</span>
          <b>${target ? progress.toFixed(1) + '%' : 'Not configured'}</b>
        </div>
        <div style="height:7px;background:#2a2a2a;border-radius:10px;overflow:hidden;margin-top:6px">
          <i style="display:block;width:${progress}%;height:100%;background:var(--green);border-radius:10px"></i>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;font-size:10px;color:var(--text-muted);margin-bottom:12px">
        <span>Remaining Daily DD: <b>${dailyRemaining == null ? '—' : money(dailyRemaining)}</b></span>
        <span>Remaining Max DD: <b>${maxRemaining == null ? '—' : money(maxRemaining)}</b></span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="view-btn account-dashboard-link" data-account="${esc(code)}" type="button">Dashboard</button>
        <button class="view-btn terminal-link" data-account="${esc(code)}" type="button">Open Terminal</button>
      </div>
    </div>
  `;
}

async function fetchAccounts() {
  const container = $('accounts-container');
  const empty = $('empty-state');
  if (!container) return;

  container.innerHTML = '<div class="account-loading-card"><div class="dash-spinner"></div>Loading accounts…</div>';

  try {
    const d = await api('/api/accounts');
    const accounts = d.accounts || [];

    const active = accounts.filter((a) => a.status === 'ACTIVE').length;
    const passed = accounts.filter((a) => a.status === 'PASSED').length;
    const failed = accounts.filter((a) => ['BREACHED', 'EXPIRED', 'CLOSED'].includes(a.status)).length;
    const totalProfit = accounts.reduce((s, a) => s + (Number(a.balance_cents || 0) - Number(a.initial_balance_cents || 0)), 0) / 100;

    $('total-accounts').textContent = accounts.length;
    $('active-accounts').textContent = active;
    $('passed-accounts').textContent = passed;
    $('failed-accounts').textContent = failed;
    $('total-profit').textContent = (totalProfit >= 0 ? '+' : '') + '$' + totalProfit.toFixed(2);

    if (!accounts.length) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    container.innerHTML = accounts.map(accountCard).join('');

    container.querySelectorAll('.account-dashboard-link').forEach((b) => {
      b.onclick = () => {
        b.disabled = true;
        location.href = '/account-dashboard.html?account_code=' + encodeURIComponent(b.dataset.account);
      };
    });

    container.querySelectorAll('.terminal-link').forEach((b) => {
      b.onclick = () => {
        b.disabled = true;
        location.href = '/trading-terminal.html?account_code=' + encodeURIComponent(b.dataset.account);
      };
    });
  } catch (e) {
    container.innerHTML = '<div class="account-error-card">Unable to load accounts. ' + esc(e.message) + '</div>';
    console.error('Accounts fetch:', e);
  }
}

async function loadHomeData() {
  await Promise.all([fetchProfile(), fetchAccounts(), fetchNotifications()]);
}

/* ------------------------------------------------------------
   5. ORDERS
   ------------------------------------------------------------ */
async function fetchUserOrders() {
  try {
    const d = await api('/api/orders');
    const tbody = $('ordersTableBody');
    const empty = $('ordersEmptyState');

    if (!d.success || !d.orders?.length) {
      empty.style.display = 'block';
      tbody.innerHTML = '';
      return;
    }

    empty.style.display = 'none';
    tbody.innerHTML = d.orders
      .map(
        (o) => `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:12px;color:var(--green)">${esc(o.order_ref)}</td>
          <td style="padding:12px">${esc(String(o.model || '').replace(/_/g, ' ').toUpperCase())}</td>
          <td style="padding:12px">${money(o.original_amount_cents)}</td>
          <td style="padding:12px;color:var(--green)">-${money(o.discount_amount_cents)}</td>
          <td style="padding:12px;font-weight:600">${money(o.final_amount_cents)}</td>
          <td style="padding:12px">${esc(String(o.status || '').replace(/_/g, ' '))}</td>
          <td style="padding:12px">${o.created_at ? new Date(o.created_at).toLocaleDateString() : '—'}</td>
        </tr>
      `
      )
      .join('');
  } catch (e) {
    console.error('Orders:', e);
  }
}

/* ------------------------------------------------------------
   6. AFFILIATE
   ------------------------------------------------------------ */
async function fetchAffiliateStats() {
  try {
    const d = await api('/api/affiliate/stats');

    $('aff-total-referrals').textContent = d.total_referrals || 0;
    $('aff-total-sales').textContent = d.total_sales || 0;
    $('aff-total-earnings').textContent = money(d.total_earnings_cents);
    $('aff-pending-earnings').textContent = money(d.pending_earnings_cents);

    // Update affiliate code if available
    if (d.affiliate_code && $('aff-code')) {
      $('aff-code').textContent = d.affiliate_code;
    }
  } catch (e) {
    console.error('Affiliate:', e);
  }
}

async function requestAffiliatePayout() {
  const amount = $('aff-payout-amount')?.value;
  const msg = $('aff-payout-message');

  if (!amount || Number(amount) < 100) {
    msg.style.display = 'block';
    msg.style.color = 'var(--red)';
    msg.textContent = 'Minimum payout is $100.00';
    return;
  }

  try {
    const d = await api('/api/affiliate/payout/request', {
      method: 'POST',
      body: JSON.stringify({ amount_cents: Math.round(Number(amount) * 100) }),
    });

    msg.style.display = 'block';
    msg.style.color = d.success ? 'var(--green)' : 'var(--red)';
    msg.textContent = d.success ? 'Payout requested: ' + d.request_ref : d.error || 'Failed';

    if (d.success) {
      $('aff-payout-amount').value = '';
      fetchAffiliateStats();
    }
  } catch (e) {
    msg.style.display = 'block';
    msg.style.color = 'var(--red)';
    msg.textContent = e.message;
  }
}

/* ------------------------------------------------------------
   7. CERTIFICATES
   ------------------------------------------------------------ */
async function fetchCertificates() {
  const c = $('certificates-container');
  if (!c) return;

  try {
    const d = await api('/api/certificates/my');
    c.innerHTML =
      d.success && d.certificates?.length
        ? d.certificates
            .map(
              (x) => `
              <div style="border:1px solid var(--border);border-radius:8px;padding:15px;margin-bottom:10px">
                <strong>${esc(x.achievement)}</strong><br>
                <span style="color:var(--text-muted);font-size:12px">
                  Account: ${esc(x.account_code || 'N/A')} · 
                  Issued: ${x.issued_on ? new Date(x.issued_on).toLocaleDateString() : '—'}
                </span>
              </div>
            `
            )
            .join('')
        : '<div style="text-align:center;padding:30px;color:var(--text-muted)">No certificates yet.</div>';
  } catch (e) {
    console.error('Certificates:', e);
  }
}

/* ------------------------------------------------------------
   8. WITHDRAWAL
   ------------------------------------------------------------ */
async function loadWithdrawForm() {
  const s = $('withdraw-account-select');
  if (!s) return;

  s.innerHTML = '<option value="">-- Select Account --</option>';

  try {
    const d = await api('/api/accounts');
    (d.accounts || []).forEach((a) => {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = `${a.account_code} (${a.status})`;
      s.appendChild(o);
    });
  } catch (e) {
    console.error('Withdraw accounts:', e);
  }
}

async function onWithdrawAccountChange() {
  const id = $('withdraw-account-select').value;
  const rd = $('withdraw-rules');
  const fd = $('withdraw-form');

  if (!id) {
    rd.style.display = 'none';
    fd.style.display = 'none';
    return;
  }

  try {
    const d = await api('/api/accounts');
    const a = (d.accounts || []).find((x) => String(x.id) === String(id));
    if (!a) return;

    const p = a.account_profile || {};
    const r = p.rules || {};
    const profit = (Number(a.balance_cents || 0) - Number(a.initial_balance_cents || 0)) / 100;

    rd.style.display = 'block';
    rd.innerHTML = `
      <p><strong>Model:</strong> ${esc(p.displayName || a.challenge_model)}</p>
      <p><strong>Profit Available:</strong> $${profit.toFixed(2)}</p>
      <p><strong>Daily DD Remaining:</strong> ${r.dailyDrawdownRemainingCents == null ? '—' : money(r.dailyDrawdownRemainingCents)}</p>
      <p><strong>Maximum DD Remaining:</strong> ${r.maxDrawdownRemainingCents == null ? '—' : money(r.maxDrawdownRemainingCents)}</p>
    `;

    fd.style.display = profit > 0 ? 'block' : 'none';
    if (profit > 0) {
      $('withdraw-amount').max = profit.toFixed(2);
      $('withdraw-amount').placeholder = 'Max: $' + profit.toFixed(2);
    }
  } catch (e) {
    console.error('Withdraw:', e);
  }
}

async function submitWithdrawRequest() {
  const msg = $('withdraw-message');
  const account_id = $('withdraw-account-select').value;
  const amount = $('withdraw-amount').value;
  const method = $('withdraw-method').value;
  const address = $('withdraw-address').value;

  if (!account_id || !amount || !method || !address) {
    msg.style.display = 'block';
    msg.style.color = 'var(--red)';
    msg.textContent = 'Please fill all fields.';
    return;
  }

  try {
    const d = await api('/api/withdrawals/request', {
      method: 'POST',
      body: JSON.stringify({
        account_id,
        amount_cents: Math.round(parseFloat(amount) * 100),
        method,
        payment_address: address,
      }),
    });

    msg.style.display = 'block';
    msg.style.color = d.success ? 'var(--green)' : 'var(--red)';
    msg.textContent = d.success
      ? 'Withdrawal request submitted! Reference: ' + d.request_ref
      : d.error || 'Failed to submit request.';

    if (d.success) {
      $('withdraw-amount').value = '';
      $('withdraw-address').value = '';
      loadWithdrawForm();
    }
  } catch (e) {
    msg.style.display = 'block';
    msg.style.color = 'var(--red)';
    msg.textContent = e.message;
  }
}

/* ------------------------------------------------------------
   9. SUPPORT TICKETS
   ------------------------------------------------------------ */
async function fetchSupportTickets() {
  const l = $('tickets-list');
  if (!l) return;

  try {
    const d = await api('/api/support/tickets');
    l.innerHTML =
      d.success && d.tickets?.length
        ? d.tickets
            .map(
              (t) => `
              <div style="padding:10px;border-bottom:1px solid var(--border)">
                <strong>${esc(t.title)}</strong><br>
                <span style="font-size:12px;color:var(--text-muted)">
                  ${t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                </span>
              </div>
            `
            )
            .join('')
        : '<p style="color:var(--text-muted)">No tickets yet.</p>';
  } catch (e) {
    console.error('Tickets:', e);
  }
}

async function createSupportTicket() {
  const subject = $('ticket-subject')?.value;
  const message = $('ticket-message')?.value;
  const msg = $('ticket-submit-message') || $('ticket-message');

  if (!subject || !message) {
    if (msg) {
      msg.style.display = 'block';
      msg.style.color = 'var(--red)';
      msg.textContent = 'Please fill all fields.';
    }
    return;
  }

  try {
    const d = await api('/api/support/ticket', {
      method: 'POST',
      body: JSON.stringify({ subject, message }),
    });

    if (msg) {
      msg.style.display = 'block';
      msg.style.color = d.success ? 'var(--green)' : 'var(--red)';
      msg.textContent = d.success ? 'Ticket created: ' + d.ticket_ref : d.error || 'Failed';
    }

    if (d.success) {
      $('ticket-subject').value = '';
      $('ticket-message').value = '';
      fetchSupportTickets();
    }
  } catch (e) {
    if (msg) {
      msg.style.display = 'block';
      msg.style.color = 'var(--red)';
      msg.textContent = e.message;
    }
  }
}

/* ------------------------------------------------------------
   10. NOTIFICATIONS
   ------------------------------------------------------------ */
let notificationUnread = 0;

async function fetchNotifications() {
  try {
    const d = await api('/api/notifications');
    notificationUnread = Number(d.unreadCount || 0);

    const badge = $('notificationBadge');
    if (badge) {
      badge.textContent = notificationUnread;
      badge.style.display = notificationUnread ? 'block' : 'none';
    }

    const list = $('notificationList');
    if (list) {
      list.innerHTML = d.notifications?.length
        ? d.notifications
            .map(
              (n) => `
              <div style="padding:10px;border-bottom:1px solid #2a2a2a;cursor:pointer" onclick="markNotificationRead(${n.id})">
                <b>${esc(n.title)}</b>
                <div style="font-size:12px;color:#94A3B8">${esc(n.message)}</div>
                <small style="color:#666">${n.created_at ? new Date(n.created_at).toLocaleString() : '—'}</small>
              </div>
            `
            )
            .join('')
        : '<p style="color:#94A3B8;text-align:center;padding:15px">No notifications yet</p>';
    }
  } catch (e) {
    console.error('Notifications:', e);
  }
}

async function markNotificationRead(id) {
  try {
    await api('/api/notifications/' + id + '/read', { method: 'POST' });
    fetchNotifications();
  } catch (e) {
    console.error(e);
  }
}

async function markAllNotificationsRead() {
  try {
    await api('/api/notifications/read-all', { method: 'POST' });
    fetchNotifications();
  } catch (e) {
    console.error(e);
  }
}

/* ------------------------------------------------------------
   11. UI HELPERS (BUSY STATE, SPINNER)
   ------------------------------------------------------------ */
function installDashboardUI() {
  // Remove duplicate bell icon
  const firstBell = document.querySelector('.header-right .bell-icon');
  if (firstBell) firstBell.remove();

  // Inject custom CSS for loading/busy states
  const style = document.createElement('style');
  style.textContent = `
    .account-loading-card,.account-error-card{
      padding:25px;text-align:center;color:var(--text-muted);
      grid-column:1/-1;background:var(--bg-card);
      border:1px solid var(--border);border-radius:12px;
    }
    .dash-spinner{
      width:28px;height:28px;border:3px solid #28313a;
      border-top-color:var(--green);border-radius:50%;
      margin:0 auto 10px;animation:dashspin .7s linear infinite;
    }
    @keyframes dashspin{to{transform:rotate(360deg)}}
    button.fx-busy{opacity:.65;pointer-events:none;position:relative}
    button.fx-busy:after{
      content:'';display:inline-block;width:12px;height:12px;
      margin-left:7px;border:2px solid currentColor;
      border-top-color:transparent;border-radius:50%;
      vertical-align:-2px;animation:dashspin .7s linear infinite;
    }
  `;
  document.head.appendChild(style);

  // Auto busy state on button click
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || b.matches('.menu-toggle,.notification-container button')) return;
      b.classList.add('fx-busy');
      setTimeout(() => b.classList.remove('fx-busy'), 6000);
    },
    true
  );
}

/* ------------------------------------------------------------
   12. INITIALIZATION
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  installDashboardUI();
  showSection('home');
  loadHomeData();
});
