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
    // Hide all sections
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    // Show selected section
    const section = document.getElementById('view-' + sectionName);
    if (section) section.classList.add('active');

    // Update sidebar active state
    document.querySelectorAll('.sidebar nav a').forEach(link => link.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar nav a[onclick="showSection('${sectionName}')"]`);
    if (activeLink) activeLink.classList.add('active');
    
    // Mobile close sidebar
    document.getElementById('sidebar').classList.remove('open');

    // Load data based on section
    if (sectionName === 'home') loadHomeData();
    if (sectionName === 'orders') fetchUserOrders();
    if (sectionName === 'withdraw') loadWithdrawForm();
    if (sectionName === 'affiliate') fetchAffiliateStats();
    if (sectionName === 'certificates') fetchCertificates();
}

// USER DROPDOWN & NOTIFICATION TOGGLES
function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('active');
}

function toggleNotifications() {
    alert('Notifications panel coming soon!');
}

// ========== LOAD HOME DATA ==========
async function loadHomeData() {
    fetchProfile();
    fetchAccounts();
}

// ========== FETCH PROFILE ==========
async function fetchProfile() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/user/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const user = data || {};

        document.getElementById('header-user-name').innerText = user.legal_name || 'Trader';
        document.getElementById('profile-name').innerText = user.legal_name || 'Trader';
        document.getElementById('profile-email').innerText = user.email || 'trader@fundfxt.com';
        document.getElementById('profile-phone').innerText = user.phone || '+91 0000000000';
        document.getElementById('profile-date').innerText = new Date().getFullYear();
        document.getElementById('aff-code').innerText = user.affiliate_code || 'AFF-PENDING';
    } catch (error) {
        console.error('Profile fetch error:', error);
    }
}

// ========== FETCH ACCOUNTS ==========
async function fetchAccounts() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/accounts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        const container = document.getElementById('accounts-container');
        const emptyState = document.getElementById('empty-state');

        // Update Summary
        const totalAccounts = data.accounts ? data.accounts.length : 0;
        const activeAccounts = data.accounts ? data.accounts.filter(a => a.status === 'ACTIVE').length : 0;
        const passedAccounts = data.accounts ? data.accounts.filter(a => a.status === 'PASSED').length : 0;
        const failedAccounts = data.accounts ? data.accounts.filter(a => ['BREACHED','EXPIRED','CLOSED'].includes(a.status)).length : 0;
        const totalProfit = data.accounts ? data.accounts.reduce((sum, a) => sum + (a.equity_cents - a.initial_balance_cents), 0) / 100 : 0;

        document.getElementById('total-accounts').innerText = totalAccounts;
        document.getElementById('active-accounts').innerText = activeAccounts;
        document.getElementById('passed-accounts').innerText = passedAccounts;
        document.getElementById('failed-accounts').innerText = failedAccounts;
        document.getElementById('total-profit').innerText = '$' + totalProfit.toFixed(2);

        // Render Cards
        if (!data.accounts || data.accounts.length === 0) {
            emptyState.style.display = 'block';
            container.innerHTML = '';
            return;
        }
        
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
    } catch (error) {
        console.error('Accounts fetch error:', error);
    }
}

// ========== FETCH ORDERS ==========
async function fetchUserOrders() {
    try {
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
    } catch (error) {
        console.error('Orders fetch error:', error);
    }
}

// ========== FETCH AFFILIATE STATS ==========
async function fetchAffiliateStats() {
    try {
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
    } catch (error) {
        console.error('Affiliate fetch error:', error);
    }
}

// ========== FETCH CERTIFICATES ==========
async function fetchCertificates() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/certificates/my', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const container = document.getElementById('certificates-container');
        if (data.success && data.certificates.length > 0) {
            container.innerHTML = data.certificates.map(c => `
                <div style="border: 1px solid var(--border); border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                    <strong>${c.achievement}</strong> - ${new Date(c.issued_on).toLocaleDateString()}
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Certificates fetch error:', error);
    }
}

// ========== WITHDRAWAL FUNCTIONS ==========
async function loadWithdrawForm() {
    const select = document.getElementById('withdraw-account-select');
    select.innerHTML = '<option value="">-- Select Account --</option>';
    document.getElementById('withdraw-rules').style.display = 'none';
    document.getElementById('withdraw-form').style.display = 'none';

    try {
        const response = await fetch('https://fundfxt.onrender.com/api/accounts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.success && data.accounts.length > 0) {
            data.accounts.forEach(account => {
                const option = document.createElement('option');
                option.value = account.id;
                option.textContent = `${account.account_code} (${account.status})`;
                select.appendChild(option);
            });
        } else {
            select.innerHTML = '<option value="">No accounts found. Buy a challenge!</option>';
        }
    } catch (error) {
        console.error('Withdraw form load error:', error);
    }
}

async function onWithdrawAccountChange() {
    const accountId = document.getElementById('withdraw-account-select').value;
    const rulesDiv = document.getElementById('withdraw-rules');
    const formDiv = document.getElementById('withdraw-form');

    if (!accountId) {
        rulesDiv.style.display = 'none';
        formDiv.style.display = 'none';
        return;
    }

    try {
        const accountsRes = await fetch('https://fundfxt.onrender.com/api/accounts', { headers: { 'Authorization': `Bearer ${token}` } });
        const accountsData = await accountsRes.json();
        const account = accountsData.accounts.find(a => a.id == accountId);

        const configRes = await fetch(`https://fundfxt.onrender.com/api/challenges/${account.challenge_model}`);
        const configData = await configRes.json();

        if (configData.success) {
            const config = configData.config;
            const profit = (account.equity_cents - account.initial_balance_cents) / 100;
            
            rulesDiv.style.display = 'block';
            rulesDiv.innerHTML = `
                <p><strong>Model:</strong> ${config.display_name}</p>
                <p><strong>Profit Available:</strong> $${profit.toFixed(2)}</p>
                <p><strong>Max Payouts:</strong> ${config.max_payout_count || 'Unlimited'}</p>
                <p><strong>Payout Period:</strong> ${config.payout_period_days ? `Every ${config.payout_period_days} days` : 'End of Challenge'}</p>
                <hr style="border-color: var(--border); margin: 15px 0;">
                <p style="color: ${profit > 0 ? 'var(--green)' : 'var(--red)'}; font-weight: 700;">
                    ${profit > 0 ? '✓ Eligible for withdrawal' : '✗ No profit available yet'}
                </p>
            `;

            if (profit > 0) {
                formDiv.style.display = 'block';
                document.getElementById('withdraw-amount').placeholder = `Max: $${profit.toFixed(2)}`;
                document.getElementById('withdraw-amount').max = profit.toFixed(2);
            } else {
                formDiv.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Withdraw change error:', error);
    }
}

async function submitWithdrawRequest() {
    const account_id = document.getElementById('withdraw-account-select').value;
    const amount = document.getElementById('withdraw-amount').value;
    const method = document.getElementById('withdraw-method').value;
    const address = document.getElementById('withdraw-address').value;
    const msg = document.getElementById('withdraw-message');

    if (!account_id || !amount || !method || !address) {
        msg.style.display = 'block';
        msg.style.color = 'var(--red)';
        msg.innerText = 'Please fill all fields.';
        return;
    }

    try {
        const response = await fetch('https://fundfxt.onrender.com/api/withdrawals/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ 
                account_id, 
                amount_cents: Math.round(parseFloat(amount) * 100), 
                method, 
                payment_address: address 
            })
        });
        const data = await response.json();

        if (data.success) {
            msg.style.display = 'block';
            msg.style.color = 'var(--green)';
            msg.innerHTML = `Withdrawal request submitted!<br>Request ID: <strong>${data.request_ref}</strong><br>Admin will review it shortly.`;
            document.getElementById('withdraw-amount').value = '';
            document.getElementById('withdraw-address').value = '';
            loadWithdrawForm();
        } else {
            msg.style.display = 'block';
            msg.style.color = 'var(--red)';
            msg.innerText = data.error || 'Failed to submit request.';
        }
    } catch (error) {
        console.error('Withdraw submit error:', error);
        msg.style.display = 'block';
        msg.style.color = 'var(--red)';
        msg.innerText = 'Server connection error.';
    }
}

// INITIALIZE
document.addEventListener('DOMContentLoaded', () => {
    showSection('home');
});
