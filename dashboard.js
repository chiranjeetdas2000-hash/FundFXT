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

<!-- WITHDRAWAL SECTION (FULLY FUNCTIONAL) -->
<div id="view-withdraw" class="view-section">
    <h1>Request Withdrawal</h1>
    <p style="color: var(--text-muted); margin-bottom: 20px;">Select an account, review rules, and submit your payout request.</p>

    <!-- Step 1: Select Account -->
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
        <h3 style="margin-bottom: 15px;">1. Select Trading Account</h3>
        <select id="withdraw-account-select" onchange="onWithdrawAccountChange()" style="width: 100%; padding: 12px; background: #0a0e14; border: 1px solid var(--border); border-radius: 8px; color: #fff;">
            <option value="">-- Select Account --</option>
        </select>
    </div>

    <!-- Step 2: Display Rules -->
    <div id="withdraw-rules" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; display: none;">
        <h3 style="margin-bottom: 15px;">2. Account Rules</h3>
        <div id="withdraw-rules-content"></div>
    </div>

    <!-- Step 3: Withdrawal Form -->
    <div id="withdraw-form" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; display: none;">
        <h3 style="margin-bottom: 15px;">3. Payment Details</h3>
        
        <label style="display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 13px;">Amount (USD)</label>
        <input type="number" id="withdraw-amount" placeholder="Enter amount" style="width: 100%; padding: 12px; background: #0a0e14; border: 1px solid var(--border); border-radius: 8px; color: #fff; margin-bottom: 15px;">

        <label style="display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 13px;">Withdrawal Method</label>
        <select id="withdraw-method" style="width: 100%; padding: 12px; background: #0a0e14; border: 1px solid var(--border); border-radius: 8px; color: #fff; margin-bottom: 15px;">
            <option value="UPI">UPI (India)</option>
            <option value="BANK">Bank Transfer</option>
            <option value="CRYPTO">Crypto (USDT/BTC)</option>
        </select>

        <label style="display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 13px;">Payment Address / Details</label>
        <input type="text" id="withdraw-address" placeholder="Enter UPI ID / Bank Account / Crypto Wallet" style="width: 100%; padding: 12px; background: #0a0e14; border: 1px solid var(--border); border-radius: 8px; color: #fff; margin-bottom: 20px;">

        <button class="btn" onclick="submitWithdrawRequest()" style="width: 100%; background: var(--green); color: white; padding: 15px; font-weight: 600;">Submit Withdrawal Request</button>
        <div id="withdraw-message" style="margin-top: 10px; display: none;"></div>
    </div>
</div>

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

// ========== FETCH DASHBOARD (Main Function) ==========
async function fetchDashboard() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/dashboard/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.success) {
            const { totalAccounts, activeAccounts, passedAccounts, failedAccounts, totalProfit } = data.stats;

            // Update Summary Cards
            document.getElementById('total-accounts').innerText = totalAccounts;
            document.getElementById('active-accounts').innerText = activeAccounts;
            document.getElementById('passed-accounts').innerText = passedAccounts;
            document.getElementById('failed-accounts').innerText = failedAccounts;
            document.getElementById('total-profit').innerText = '$' + totalProfit;

            // Update Account Cards Grid
            const container = document.getElementById('accounts-container');
            const emptyState = document.getElementById('empty-state');
            
            if (totalAccounts === 0) {
                emptyState.style.display = 'block';
                container.innerHTML = '';
            } else {
                emptyState.style.display = 'none';
                container.innerHTML = data.accounts.map(account => {
                    const accNum = account.account_code || 'N/A';
                    const status = account.status || 'ACTIVE';
                    const balance = (account.balance_cents / 100).toFixed(2);
                    const equity = (account.equity_cents / 100).toFixed(2);
                    const profit = ((account.equity_cents - account.initial_balance_cents) / 100).toFixed(2);

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

            // Update Recent Activity (Dynamic from orders)
            const recentActivity = data.recentActivity || [];
            const activityList = document.querySelector('.activity-list');
            if (activityList) {
                if (recentActivity.length === 0) {
                    activityList.innerHTML = '<h2 style="margin-bottom: 15px;">Recent Activity</h2><p style="color: var(--text-muted);">No recent activity.</p>';
                } else {
                    activityList.innerHTML = '<h2 style="margin-bottom: 15px;">Recent Activity</h2>' + recentActivity.map(order => `
                        <div class="activity-item">
                            <div class="activity-icon"><i class="fa-solid fa-file-invoice" style="color: var(--blue);"></i></div>
                            <div class="activity-text"><h5>${order.order_ref}</h5><p>${order.status.replace(/_/g, ' ')} • ${new Date(order.created_at).toLocaleDateString()}</p></div>
                        </div>
                    `).join('');
                }
            }
        }
    } catch (error) {
        console.error('Dashboard fetch error:', error);
    }
}

// ========== FETCH USER ORDERS (For Order History Section) ==========
async function fetchUserOrders() {
    const response = await fetch('https://fundfxt.onrender.com/api/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();

    const tbody = document.getElementById('ordersTableBody');
    const emptyState = document.getElementById('ordersEmptyState');

    if (!data.success || !data.orders || data.orders.length === 0) {
        emptyState.style.display = 'block';
        tbody.innerHTML = '';
        return;
    }

    emptyState.style.display = 'none';
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
            <td style="padding: 12px; font-family: monospace; color: var(--green);">${order.order_ref}</td>
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

    document.getElementById('aff-total-referrals').innerText = data.total_referrals;
    document.getElementById('aff-total-sales').innerText = data.total_sales;
    document.getElementById('aff-total-earnings').innerText = '$' + (data.total_earnings_cents / 100).toFixed(2);
    document.getElementById('aff-pending-earnings').innerText = '$' + (data.pending_earnings_cents / 100).toFixed(2);
}

// INITIALIZE
document.addEventListener('DOMContentLoaded', () => {
    showSection('home');
    fetchProfile();
    fetchDashboard(); // Main function jo saara data le aayega
    fetchAffiliateStats();
});
