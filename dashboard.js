// AUTH CHECK
const token = localStorage.getItem('fundfxt_token');
if (!token) window.location.href = '/auth.html';

// LOGOUT
function handleLogout() {
    localStorage.removeItem('fundfxt_token');
    window.location.href = '/auth.html';
}

// SIDEBAR TOGGLE (Mobile)
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// SECTION SWITCHING
function showSection(sectionName) {
    if (sectionName === 'orders') fetchUserOrders(); // <--- Ye line add karo
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.getElementById('view-' + sectionName).classList.add('active');

    document.querySelectorAll('.sidebar nav a').forEach(link => link.classList.remove('active'));
    document.querySelector(`.sidebar nav a[onclick="showSection('${sectionName}')"]`)?.classList.add('active');
    
    // Mobile close sidebar on click
    document.getElementById('sidebar').classList.remove('open');
}

// USER DROPDOWN & NOTIFICATION TOGGLES
function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('active');
}

function toggleNotifications() {
    alert('Notifications panel coming soon!');
}

// BACKEND DATA FETCH (Profile & Accounts)
async function fetchProfile() {
    const response = await fetch('https://fundfxt.onrender.com/api/user/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    const user = data || {};

    document.getElementById('header-user-name').innerText = user.legal_name || 'Trader';
    document.getElementById('profile-name').innerText = user.legal_name || 'Trader';
    document.getElementById('profile-email').innerText = user.email || 'trader@fundfxt.com';
    document.getElementById('profile-phone').innerText = user.phone || '+91 0000000000';
    document.getElementById('aff-code').innerText = user.affiliate_code || 'AFF-PENDING';
}

// ========== FETCH ACCOUNTS ==========
async function fetchAccounts() {
    const container = document.getElementById('accounts-container');
    const emptyState = document.getElementById('empty-state');
    
    const response = await fetch('https://fundfxt.onrender.com/api/accounts', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    
    if (!data.accounts || data.accounts.length === 0) {
        emptyState.style.display = 'block';
        container.innerHTML = '';
        return;
    }
    
    emptyState.style.display = 'none';
    
    container.innerHTML = data.accounts.map(account => {
        const accNum = account.account_code || 'N/A';
        const status = account.status || 'ACTIVE';
        // Convert cents to dollars
        const balance = (account.balance_cents / 100).toFixed(2) || '0.00';
        const equity = (account.equity_cents / 100).toFixed(2) || '0.00';
        const profit = ((account.equity_cents - account.initial_balance_cents) / 100).toFixed(2) || '0.00';

        return `
            <div class="account-card">
                <h2>${accNum}</h2>
                <div class="sub">Phase 1 Challenge</div>
                <div class="account-info-grid">
                    <p>Starting Balance <strong>$${balance}</strong></p>
                    <p>Current Equity <strong>$${equity}</strong></p>
                    <p>Status <strong style="color:${status === 'ACTIVE' ? 'var(--green)' : 'var(--red)'}">${status}</strong></p>
                </div>
                <div class="profit-line" style="color: ${profit.startsWith('-') ? 'var(--red)' : 'var(--green)'};">Profit: $${profit}</div>
                <button class="view-btn" onclick="window.location.href='terminal.html?account_code=${encodeURIComponent(accNum)}'">Open Terminal</button>
            </div>
        `;
    }).join('');
}

// ========== FETCH AFFILIATE STATS ==========
async function fetchAffiliateStats() {
    const response = await fetch('https://fundfxt.onrender.com/api/affiliate/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.error) {
        console.warn('Affiliate stats error:', data.error);
        return;
    }

    // Update the affiliate section placeholders
    const totalEarnings = (data.total_earnings_cents / 100).toFixed(2);
    const pendingEarnings = (data.pending_earnings_cents / 100).toFixed(2);
    const totalReferrals = data.total_referrals;
    const totalSales = data.total_sales;

    document.getElementById('aff-total-referrals').innerText = totalReferrals;
    document.getElementById('aff-total-sales').innerText = totalSales;
    document.getElementById('aff-total-earnings').innerText = '$' + totalEarnings;
    document.getElementById('aff-pending-earnings').innerText = '$' + pendingEarnings;
}

// INITIALIZE
document.addEventListener('DOMContentLoaded', () => {
    showSection('home');
    fetchProfile();
    fetchAccounts();
    fetchAffiliateStats();  // Added to load stats on page load
});

// ========== FETCH MY ORDERS ==========
async function fetchUserOrders() {
    try {
        // API call
        const response = await fetch('https://fundfxt.onrender.com/api/orders', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        // Get elements (use correct ID)
        const tbody = document.getElementById('ordersTableBody');
        const emptyState = document.getElementById('ordersEmptyState'); // ✅ FIXED: "ordersEmptyState" (not "ordersEmpty")

        // Handle error
        if (!data.success) {
            console.error('API error:', data.error);
            if (emptyState) emptyState.style.display = 'block';
            if (tbody) tbody.innerHTML = '';
            return;
        }

        // Handle empty orders
        if (!data.orders || data.orders.length === 0) {
            if (emptyState) emptyState.style.display = 'block';
            if (tbody) tbody.innerHTML = '';
            return;
        }

        // Show orders
        if (emptyState) emptyState.style.display = 'none';

        // Status color mapping
        const statusColors = {
            'REQUESTED': '#FFB020',
            'READ': '#4A90E2',
            'PAYMENT_LINK_SENT': '#4A90E2',
            'PAYMENT_DONE': '#FFB020',
            'PAYMENT_APPROVED': '#00B56A',
            'ACCOUNT_CREATED': '#00B56A',
            'ACCOUNT_PROVIDED': '#00B56A',
            'REJECTED': '#FF4444'
        };

        tbody.innerHTML = data.orders.map(order => `
            <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 12px; font-family: monospace; color: var(--green);"><strong>${order.order_ref}</strong></td>
                <td style="padding: 12px;">${order.model.replace(/_/g, ' ').toUpperCase()}</td>
                <td style="padding: 12px;">$${(order.original_amount_cents / 100).toFixed(2)}</td>
                <td style="padding: 12px; color: var(--green);">-$${(order.discount_amount_cents / 100).toFixed(2)}</td>
                <td style="padding: 12px; font-weight: 600;">$${(order.final_amount_cents / 100).toFixed(2)}</td>
                <td style="padding: 12px;">
                    <span style="background: ${statusColors[order.status] || '#333'}20; color: ${statusColors[order.status] || '#fff'}; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase;">
                        ${order.status.replace(/_/g, ' ')}
                    </span>
                </td>
                <td style="padding: 12px;">${new Date(order.created_at).toLocaleDateString()}</td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Fetch user orders error:', error);
    }
}
