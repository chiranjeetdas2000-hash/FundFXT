// ========== AUTH CHECK ==========
const token = localStorage.getItem('fundfxt_token');
if (!token) window.location.href = '/auth.html';

// ========== SIDEBAR TOGGLE ==========
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function handleLogout() { localStorage.removeItem('fundfxt_token'); window.location.href = '/auth.html'; }

// ========== DYNAMIC TICKER ==========
function initTicker() {
    const ticker = document.getElementById('ticker');
    const tickerAff = document.getElementById('ticker-affiliate');
    const tickerHTML = `
        <div class="ticker-item">EURUSD <span class="up">1.08745 ▲ 0.32%</span></div>
        <div class="ticker-item">XAUUSD <span class="down">2,384.67 ▼ 0.41%</span></div>
        <div class="ticker-item">GBPUSD <span class="up">1.26981 ▲ 0.18%</span></div>
    `;
    if (ticker) ticker.innerHTML = tickerHTML;
    if (tickerAff) tickerAff.innerHTML = tickerHTML;
}

// ========== SECTION SWITCHING LOGIC (SPA) ==========
function showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
    
    // Show selected section
    document.getElementById('view-' + sectionName).style.display = 'block';
    
    // Update active menu
    document.querySelectorAll('.sidebar nav a').forEach(link => link.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar nav a[data-section="${sectionName}"]`);
    if (activeLink) activeLink.classList.add('active');
    
    // If Account Dashboard is opened, initialize charts
    if (sectionName === 'account') {
        initAccountDashboard();
    }
}

// ========== FETCH PROFILE (Dashboard + Settings) ==========
async function fetchProfile() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/user/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const user = data.user || {}; 
        
        const nameEl = document.getElementById('header-name');
        const sbNameEl = document.getElementById('sb-name');
        const sbKycEl = document.getElementById('sb-kyc');
        const pName = document.getElementById('p-name');
        const pEmail = document.getElementById('p-email');
        const pPhone = document.getElementById('p-phone');
        const setName = document.getElementById('set-name');
        const setEmail = document.getElementById('set-email');
        const setPhone = document.getElementById('set-phone');
        const sumName = document.getElementById('sum-name');

        // Update UI elements
        if (nameEl) nameEl.innerText = user.legal_name || 'Trader';
        if (sbNameEl) sbNameEl.innerText = user.legal_name || 'Trader';
        if (sbKycEl) sbKycEl.innerText = user.kyc_status || 'Pending';
        if (pName) pName.innerText = user.legal_name || 'Trader';
        if (pEmail) pEmail.innerText = user.email || 'trader@fundfxt.com';
        if (pPhone) pPhone.innerText = user.phone || '+91 0000000000';
        
        if (setName) setName.value = user.legal_name || '';
        if (setEmail) setEmail.value = user.email || '';
        if (setPhone) setPhone.value = user.phone || '';
        if (sumName) sumName.innerText = user.legal_name || 'User';
    } catch (e) { console.error("Profile fetch error:", e); }
}

// ========== FETCH ACCOUNTS (User Dashboard) ==========
async function fetchAccounts() {
    const container = document.getElementById('accounts-container');
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/accounts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.accounts || data.accounts.length === 0) {
            container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--muted);">No accounts yet. Buy your first challenge!</div>`;
            return;
        }
        
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

// ========== OPEN ACCOUNT DASHBOARD ==========
function openAccount(accountId) {
    document.getElementById('acc-id-display').innerText = accountId;
    // TODO: Backend se specific account ka data fetch karke UI update karna hai
    showSection('account');
}

// ========== ACCOUNT DASHBOARD CHARTS & TABLE ==========
let equityChartInstance = null;
let monthlyChartInstance = null;

function initAccountDashboard() {
    const tradeBody = document.getElementById('trade-history-body');
    if (!tradeBody) return; 

    // Dummy Trades Data (Backend API se aayega)
    tradeBody.innerHTML = `
        <tr><td>31 Jan 2025, 10:45:32</td><td>EURUSD</td><td style="color: var(--primary);">Long</td><td>1.00</td><td class="green">+$750</td></tr>
        <tr><td>31 Jan 2025, 09:15:18</td><td>XAUUSD</td><td style="color: var(--danger);">Short</td><td>0.30</td><td class="red">-$120</td></tr>
        <tr><td>30 Jan 2025, 16:22:10</td><td>EURUSD</td><td style="color: var(--primary);">Long</td><td>0.40</td><td class="green">+$560</td></tr>
    `;

    // Equity Chart (Avoid duplication)
    if (equityChartInstance) equityChartInstance.destroy();
    const equityCtx = document.getElementById('equityChart');
    if (equityCtx) {
        equityChartInstance = new Chart(equityCtx, {
            type: 'line',
            data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'], datasets: [{ label: 'Equity', data: [22000, 23000, 24000, 25000, 26250], borderColor: '#00b56a', backgroundColor: 'rgba(0,181,106,0.1)', fill: true, tension: 0.4 }] },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#333' } }, y: { grid: { color: '#333' } } } }
        });
    }

    // Monthly P/L Chart
    if (monthlyChartInstance) monthlyChartInstance.destroy();
    const monthlyCtx = document.getElementById('monthlyChart');
    if (monthlyCtx) {
        monthlyChartInstance = new Chart(monthlyCtx, {
            type: 'bar',
            data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'], datasets: [{ label: 'P/L', data: [-500, 1200, 800, 1500, 2000], backgroundColor: function(context) { return context.raw >= 0 ? '#00b56a' : '#ff4444'; } }] },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#333' } }, y: { grid: { color: '#333' } } } }
        });
    }
}

// ========== SETTINGS UPDATE ==========
async function updateProfile() {
    const name = document.getElementById('set-name').value;
    const email = document.getElementById('set-email').value;
    const phone = document.getElementById('set-phone').value;
    const address = document.getElementById('set-address').value;

    try {
        const response = await fetch('https://fundfxt.onrender.com/api/user/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ legal_name: name, email: email, phone: phone, address: address })
        });
        const data = await response.json();
        if (data.success) alert('Profile updated successfully!');
        else alert(data.error || 'Update failed!');
    } catch (e) { alert('Server connection error!'); }
}

// ========== INITIALIZE PAGE ==========
document.addEventListener('DOMContentLoaded', () => {
    initTicker();
    fetchProfile();
    fetchAccounts();
    // By default dashboard section visible hai
    showSection('dashboard'); 
});
