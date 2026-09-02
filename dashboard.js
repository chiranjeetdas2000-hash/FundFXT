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
        const status = account.status || 'Active';
        const balance = account.balance || '$5,000.00';
        const equity = account.equity || '$5,000.00';
        const profit = account.current_crra || '+$0.00';

        return `
            <div class="account-card">
                <h2>${accNum}</h2>
                <div class="sub">Phase 1 Challenge</div>
                <div class="account-info-grid">
                    <p>Starting Balance <strong>${balance}</strong></p>
                    <p>Current Equity <strong>${equity}</strong></p>
                    <p>Status <strong style="color:${status === 'Active' ? 'var(--green)' : 'var(--red)'}">${status}</strong></p>
                </div>
                <div class="profit-line" style="color: var(--green);">Profit: ${profit}</div>
                <button class="view-btn">View Account</button>
            </div>
        `;
    }).join('');
}

// INITIALIZE
document.addEventListener('DOMContentLoaded', () => {
    showSection('home');
    fetchProfile();
    fetchAccounts();
});