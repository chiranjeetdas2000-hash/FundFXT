// ========== AUTH CHECK (No Static Page Access) ==========
const token = localStorage.getItem('fundfxt_token');

if (!token) {
    // Agar token nahi hai, seedha Login par bhejo
    window.location.href = '/auth.html';
}

// ========== MOBILE SIDEBAR TOGGLE ==========
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ========== LOGOUT ==========
function handleLogout() {
    localStorage.removeItem('fundfxt_token');
    window.location.href = '/auth.html';
}

// ========== FETCH USER DATA (Profile) ==========
async function fetchUserProfile() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/user/profile', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('sidebar-user-name').innerText = data.user.legal_name || 'User';
            document.getElementById('header-user-name').innerText = data.user.legal_name || 'User';
            document.getElementById('sidebar-kyc-status').innerText = data.user.kyc_status || 'Pending';
        }
    } catch (error) {
        console.error('Profile fetch error:', error);
    }
}

// ========== FETCH ACCOUNTS (Dynamic Cards) ==========
async function fetchAccounts() {
    const container = document.getElementById('accounts-container');
    
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/accounts', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        // Agar koi account nahi hai
        if (!data.accounts || data.accounts.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <h3>No Accounts Yet</h3>
                    <p>Buy your first challenge to get started on your trading journey!</p>
                    <button class="btn" onclick="window.location.href='/marketplace.html'">Buy New Challenge</button>
                </div>
            `;
            return;
        }

        // Accounts ko render karo
        container.innerHTML = data.accounts.map(account => {
            const statusClass = account.status === 'Active' ? 'active' : 'inactive';
            return `
                <div class="account-card" onclick="window.location.href='/account-dashboard.html?acc=${account.account_id}'">
                    <span class="status ${statusClass}">${account.status}</span>
                    <h3>Account: ${account.account_id}</h3>
                    <p>Type: ${account.account_type}</p>
                    <p>Balance: $${account.balance}</p>
                </div>
            `;
        }).join('');

    } catch (error) {
        container.innerHTML = `<div class="empty-state">Error loading accounts. Please try again later.</div>`;
        console.error('Accounts fetch error:', error);
    }
}

// ========== INITIALIZE PAGE ==========
document.addEventListener('DOMContentLoaded', () => {
    fetchUserProfile();
    fetchAccounts();
});
