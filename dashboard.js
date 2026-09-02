// ========== AUTH CHECK ==========
const token = localStorage.getItem('fundfxt_token');
if (!token) window.location.href = '/auth.html';

// ========== SIDEBAR TOGGLE ==========
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ========== LOGOUT (FIXED - Ab auth.html par jayega) ==========
function handleLogout() {
    localStorage.removeItem('fundfxt_token');
    window.location.href = '/auth.html';
}

// ========== SECTION SWITCHING ==========
function showSection(sectionName) {
    document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
    document.getElementById('view-' + sectionName).style.display = 'block';
    
    document.querySelectorAll('.sidebar nav a').forEach(link => link.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar nav a[data-section="${sectionName}"]`);
    if (activeLink) activeLink.classList.add('active');

    if (sectionName === 'account') initAccountDashboard();
}

// ========== TICKER ==========
function initTicker() {
    const ticker = document.getElementById('ticker');
    const tickerAff = document.getElementById('ticker-affiliate');
    const tickerHTML = `<div class="ticker-item">EURUSD <span class="up">1.08745 ▲ 0.32%</span></div>
                        <div class="ticker-item">XAUUSD <span class="down">2,384.67 ▼ 0.41%</span></div>
                        <div class="ticker-item">GBPUSD <span class="up">1.26981 ▲ 0.18%</span></div>`;
    if (ticker) ticker.innerHTML = tickerHTML;
    if (tickerAff) tickerAff.innerHTML = tickerHTML;
}

// ========== FETCH USER PROFILE (Dynamic - No Hardcoded Data) ==========
async function fetchProfile() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/user/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const user = data.user || {};

        // Sidebar & Header
        document.getElementById('sb-name').innerText = user.legal_name || 'Trader';
        document.getElementById('sb-kyc').innerText = user.kyc_status || 'Pending';
        document.getElementById('header-name').innerText = user.legal_name || 'Trader';
        document.getElementById('p-kyc').innerText = user.kyc_status || 'Pending';

        // Profile Card
        document.getElementById('p-name').innerText = user.legal_name || 'Trader';
        document.getElementById('p-email').innerText = user.email || 'trader@fundfxt.com';
        document.getElementById('p-phone').innerText = user.phone || '+91 0000000000';

        // Settings Page
        document.getElementById('set-name').value = user.legal_name || '';
        document.getElementById('set-email').value = user.email || '';
        document.getElementById('set-phone').value = user.phone || '';
        document.getElementById('set-kyc').value = user.kyc_status || 'Pending';

        // Affiliate Code
        document.getElementById('aff-code').innerText = user.affiliate_code || 'N/A';
        
    } catch (e) { console.error("Profile fetch error:", e); }
}

// ========== FETCH ACCOUNTS (Dynamic - Buy First Challenge / Show Accounts) ==========
async function fetchAccounts() {
    const container = document.getElementById('accounts-container');
    const buyFirst = document.getElementById('buy-first-challenge');
    
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/accounts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!data.accounts || data.accounts.length === 0) {
            container.innerHTML = '';
            buyFirst.style.display = 'block';
            return;
        }

        buyFirst.style.display = 'none';
        
        container.innerHTML = data.accounts.map(account => {
            const accNum = account.account_code || account.account_id || 'N/A';
            const accType = account.account_type || 'Challenge';
            const status = account.status || 'Active';
            const statusClass = status === 'Active' ? 'status-active' : 'status-inactive';
            
            return `
                <div class="account-card" onclick="openAccount('${accNum}')">
                    <div class="icon"><i class="fa-solid fa-wallet"></i></div>
                    <h4>Account Number</h4>
                    <div class="num">${accNum}</div>
                    <h4>Type: ${accType}</h4>
                    <div style="margin-top: 15px;"><span class="status ${statusClass}">${status}</span></div>
                </div>
            `;
        }).join('');
    } catch (e) { console.error("Accounts fetch error:", e); }
}

// ========== FETCH PAYMENTS (Placeholder + Dynamic Logic) ==========
async function fetchPayments() {
    const tbody = document.getElementById('payments-body');
    const noPayments = document.getElementById('no-payments');
    
    try {
        // Backend mein /api/payments add karna hoga
        const response = await fetch('https://fundfxt.onrender.com/api/payments', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!data.payments || data.payments.length === 0) {
            tbody.innerHTML = '';
            noPayments.style.display = 'block';
            return;
        }

        noPayments.style.display = 'none';
        tbody.innerHTML = data.payments.map(pay => `
            <tr>
                <td>${pay.date}</td>
                <td>${pay.order_id}</td>
                <td>$${pay.amount}</td>
                <td>${pay.status}</td>
                <td><button class="btn-outline" style="padding: 5px 10px; font-size: 12px;">Receipt</button></td>
            </tr>
        `).join('');
    } catch (e) {
        // Agar backend ready nahi hai, toh empty state
        tbody.innerHTML = '';
        noPayments.style.display = 'block';
    }
}

// ========== OPEN ACCOUNT DASHBOARD ==========
function openAccount(accountId) {
    // Abhi ke liye section nahi hai, par account details URL mein daal kar
    // Account Dashboard bana sakte hain. Abhi dashboard par hi rehne do.
    alert('Opening Account: ' + accountId + ' (Backend pending)');
}

// ========== SETTINGS UPDATE ==========
async function updateProfile() {
    const name = document.getElementById('set-name').value;
    const phone = document.getElementById('set-phone').value;

    try {
        const response = await fetch('https://fundfxt.onrender.com/api/user/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ legal_name: name, phone: phone })
        });
        const data = await response.json();
        if (data.success) {
            alert('Profile updated successfully!');
            fetchProfile(); // UI refresh
        } else {
            alert(data.error || 'Update failed!');
        }
    } catch (e) { alert('Server connection error!'); }
}

// ========== INITIALIZE PAGE ==========
document.addEventListener('DOMContentLoaded', () => {
    initTicker();
    fetchProfile();
    fetchAccounts();
    fetchPayments();
    showSection('dashboard'); 
});
