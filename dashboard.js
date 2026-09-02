// ================================================================
//  DATA
// ================================================================
const mockAccounts = [{
    accountId: "ACC-123456",
    type: "Phase 1",
    status: "Active",
    balance: 25000,
    equity: 25250,
    dailyDrawdown: 1850,
    maxDrawdown: 4250,
    tradesToday: "2/3",
    consistency: 35,
    chart: [25000, 25240, 25120, 25620, 25550, 26150, 26600, 27150, 26820, 27650, 28200, 27950, 28600, 29150,
        28900, 29700, 30200, 30650, 31050
    ]
}, {
    accountId: "ACC-123457",
    type: "Phase 2",
    status: "Active",
    balance: 50000,
    equity: 50780,
    dailyDrawdown: 3300,
    maxDrawdown: 7400,
    tradesToday: "1/5",
    consistency: 42,
    chart: [50000, 50300, 50100, 50650, 50900, 50700, 51200, 51800, 51550, 52300, 52800, 52500, 53400, 53800,
        54200, 54050, 54800, 55300, 55780
    ]
}, {
    accountId: "ACC-123458",
    type: "Funded Trader",
    status: "Active",
    balance: 100000,
    equity: 101250,
    dailyDrawdown: 5200,
    maxDrawdown: 8900,
    tradesToday: "2/8",
    consistency: 28,
    chart: [100000, 100450, 100900, 100600, 101300, 101750, 101500, 102200, 102850, 102500, 103200, 103850,
        103100, 103900, 104400, 103800, 102900, 101700, 101250
    ]
}];

const mockTrades = {
    "ACC-123456": [
        { symbol: "EURUSD", side: "Buy", lots: "0.50", entry: "1.08245", current: "1.08420", pl: 87.50,
            status: "Open" },
        { symbol: "XAUUSD", side: "Sell", lots: "0.30", entry: "2,034.50", current: "2,028.10", pl: 192.00,
            status: "Open" },
        { symbol: "GBPUSD", side: "Buy", lots: "0.20", entry: "1.26820", current: "1.26690", pl: -26.00,
            status: "Open" },
        { symbol: "EURUSD", side: "Sell", lots: "0.40", entry: "1.08580", current: "1.08720", pl: -56.00,
            status: "Open" }
    ],
    "ACC-123457": [
        { symbol: "XAUUSD", side: "Buy", lots: "0.50", entry: "2,018.20", current: "2,025.80", pl: 380.00,
            status: "Open" },
        { symbol: "EURUSD", side: "Buy", lots: "0.70", entry: "1.07840", current: "1.08130", pl: 203.00,
            status: "Open" }
    ],
    "ACC-123458": [
        { symbol: "GBPUSD", side: "Sell", lots: "1.00", entry: "1.27150", current: "1.26910", pl: 240.00,
            status: "Open" },
        { symbol: "XAUUSD", side: "Buy", lots: "0.80", entry: "2,012.00", current: "2,009.20", pl: -224.00,
            status: "Open" },
        { symbol: "EURUSD", side: "Buy", lots: "0.60", entry: "1.08000", current: "1.08310", pl: 186.00,
            status: "Open" }
    ]
};

// ================================================================
//  STATE
// ================================================================
let accounts = [];
let selectedAccount = null;
let chart = null;
let lineSeries = null;
const money = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
    .format(n);

// ================================================================
//  HELPERS
// ================================================================
async function fetchAccounts() {
    try { return mockAccounts; } catch (_) { return mockAccounts; }
}

async function fetchTrades(accountId) {
    return mockTrades[accountId] || [];
}

async function fetchEquityData(accountId) {
    const a = mockAccounts.find(x => x.accountId === accountId);
    return a ? a.chart : [];
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}
// make globally accessible for inline onclick
window.showToast = showToast;

// ================================================================
//  NAVIGATION
// ================================================================
const pageMap = {
    dashboard: { title: "Account Dashboard", chip: true },
    accounts: { title: "My Accounts", chip: false },
    affiliate: { title: "Affiliate Program", chip: false },
    payout: { title: "Payout", chip: false },
    settings: { title: "Settings", chip: false }
};

function navigateTo(page) {
    // hide all sections
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('section-' + page);
    if (target) target.classList.add('active');

    // nav active
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');

    // update title
    const info = pageMap[page];
    if (info) {
        document.getElementById('pageTitle').textContent = info.title;
        const chip = document.getElementById('accountChip');
        if (info.chip && selectedAccount) {
            chip.innerHTML = `${selectedAccount.accountId} <span class="copy">⧉</span>`;
            chip.style.display = 'block';
        } else {
            chip.style.display = 'none';
        }
    }

    // close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');

    // refresh chart if dashboard
    if (page === 'dashboard' && selectedAccount) {
        setTimeout(() => updateChart(selectedAccount.accountId), 100);
    }
}

// ================================================================
//  DASHBOARD: STATS
// ================================================================
function renderStats(account) {
    const cards = [
        ["▣", "Account Balance", money(account.balance), "white", "Balance"],
        ["◉", "Current Equity", money(account.equity), "green", "Live equity"],
        ["◔", "Available Daily DD", money(account.dailyDrawdown), "yellow", "Remaining"],
        ["◉", "Available Max DD", money(account.maxDrawdown), "red-text", "Remaining"],
        ["⇄", "Trades Today", account.tradesToday, "green", "Trade limit"],
        ["◌", "Consistency Score", account.consistency + "%", "green", "Performance ratio"]
    ];
    document.getElementById("statsGrid").innerHTML = cards.map((c, i) =>
        `<article class="stat-card">
              <div class="stat-top"><span class="stat-icon ${i===3?'red':i===2?'yellow':''}">${c[0]}</span><span>${c[1]}</span></div>
              <div class="stat-value ${c[3]}">${c[2]}</div>
              <div class="stat-sub">${c[4]}</div>
            </article>`
    ).join("");
}

// ================================================================
//  DASHBOARD: ACCOUNTS LIST
// ================================================================
function renderAccounts() {
    const container = document.getElementById("accountList");
    container.innerHTML = accounts.map(a =>
        `<div class="account-card ${a.accountId===selectedAccount?.accountId?'selected':''}" data-id="${a.accountId}">
              <div class="account-card-top">
                <div><div class="account-id">${a.accountId}</div><div class="account-type">${a.type}</div></div>
                <span class="badge">${a.status}</span>
              </div>
              <div class="account-row"><span>Balance</span><strong>${money(a.balance)}</strong></div>
              <div class="account-row"><span>Equity</span><strong class="green">${money(a.equity)}</strong></div>
            </div>`
    ).join("");
    container.querySelectorAll(".account-card").forEach(el => {
        el.addEventListener("click", () => {
            selectAccount(el.dataset.id);
            navigateTo('dashboard');
        });
    });
}

// ================================================================
//  DASHBOARD: TRADES
// ================================================================
function renderTrades(trades) {
    const filter = document.getElementById("symbolFilter").value;
    const visible = filter === "all" ? trades : trades.filter(t => t.symbol === filter);
    const tbody = document.getElementById("tradesBody");
    if (!visible.length) {
        tbody.innerHTML =
            `<tr><td colspan="8" style="text-align:center;color:#8e99a7;padding:30px">No active trades found.</td></tr>`;
        return;
    }
    tbody.innerHTML = visible.map((t, idx) =>
        `<tr>
              <td><strong>${t.symbol}</strong></td>
              <td><span class="side ${t.side==='Buy'?'buy':'sell'}">${t.side}</span></td>
              <td>${t.lots}</td><td>${t.entry}</td><td>${t.current}</td>
              <td class="${t.pl>=0?'pl-positive':'pl-negative'}">${t.pl>=0?'+':''}${money(t.pl)}</td>
              <td><span class="badge">${t.status}</span></td>
              <td class="actions-cell">
                <button class="tiny-btn" onclick="showToast('Modify order selected')">Modify</button>
                <button class="tiny-btn" onclick="closeTrade('${selectedAccount?.accountId}',${idx})">Close</button>
                <button class="tiny-btn" onclick="showToast('Partial close panel opened')">Partial</button>
              </td>
            </tr>`
    ).join("");
}

// ================================================================
//  CHART
// ================================================================
function initChart() {
    const el = document.getElementById("equityChart");
    chart = LightweightCharts.createChart(el, {
        width: el.clientWidth,
        height: 260,
        layout: { background: { color: "transparent" }, textColor: "#84909e", fontSize: 11 },
        grid: { vertLines: { color: "rgba(255,255,255,.04)" }, horzLines: { color: "rgba(255,255,255,.06)" } },
        rightPriceScale: { borderColor: "rgba(255,255,255,.08)" },
        timeScale: { borderColor: "rgba(255,255,255,.08)", timeVisible: false },
        crosshair: { vertLine: { color: "rgba(0,181,106,.25)" }, horzLine: { color: "rgba(0,181,106,.25)" } }
    });
    lineSeries = chart.addAreaSeries({
        lineColor: "#19d987",
        topColor: "rgba(0,181,106,.30)",
        bottomColor: "rgba(0,181,106,0)",
        lineWidth: 2
    });
    window.addEventListener("resize", () => chart.applyOptions({ width: el.clientWidth }));
}

async function updateChart(accountId) {
    if (!chart || !lineSeries) return;
    const values = await fetchEquityData(accountId);
    const range = document.getElementById("chartRange").value;
    const source = range === "7" ? values.slice(-7) : range === "30" ? values.slice(-12) : values;
    const data = source.map((v, i) => ({ time: 1704067200 + i * 86400, value: v }));
    lineSeries.setData(data);
    chart.timeScale().fitContent();
}

// ================================================================
//  SELECT ACCOUNT
// ================================================================
async function selectAccount(id) {
    selectedAccount = accounts.find(a => a.accountId === id);
    if (!selectedAccount) return;
    // update chip
    const chip = document.getElementById('accountChip');
    chip.innerHTML = `${selectedAccount.accountId} <span class="copy">⧉</span>`;
    chip.style.display = 'block';
    renderStats(selectedAccount);
    renderAccounts();
    await updateChart(id);
    const trades = await fetchTrades(id);
    renderTrades(trades);
    // also update accounts table in "My Accounts" page
    renderAccountsTable();
    // update payout account dropdown
    populatePayoutAccounts();
}

// ================================================================
//  CLOSE TRADE (global for inline onclick)
// ================================================================
async function closeTrade(accountId, idx) {
    if (!accountId) return;
    const trade = mockTrades[accountId]?.[idx];
    if (!trade) return;
    showToast(`${trade.symbol} position closed (demo)`);
    mockTrades[accountId].splice(idx, 1);
    const trades = await fetchTrades(accountId);
    renderTrades(trades);
}
window.closeTrade = closeTrade;

// ================================================================
//  ACCOUNTS TABLE (My Accounts page)
// ================================================================
function renderAccountsTable() {
    const tbody = document.getElementById("accountsTableBody");
    tbody.innerHTML = accounts.map(a =>
        `<tr>
              <td><strong>${a.accountId}</strong></td>
              <td>${a.type}</td>
              <td><span class="badge">${a.status}</span></td>
              <td>${money(a.balance)}</td>
              <td class="green">${money(a.equity)}</td>
              <td class="yellow">${money(a.dailyDrawdown)}</td>
              <td>${money(a.maxDrawdown)}</td>
              <td>${a.tradesToday}</td>
              <td>${a.consistency}%</td>
              <td><button class="ghost-btn" style="font-size:11px;padding:5px 12px;" onclick="selectAccount('${a.accountId}');navigateTo('dashboard');">View</button></td>
            </tr>`
    ).join("");
}

// ================================================================
//  PAYOUT: populate account dropdown
// ================================================================
function populatePayoutAccounts() {
    const sel = document.getElementById("payoutAccount");
    sel.innerHTML = accounts.map(a =>
        `<option value="${a.accountId}" ${a.accountId===selectedAccount?.accountId?'selected':''}>${a.accountId} (${money(a.equity)})</option>`
    ).join("");
}

// ================================================================
//  SETTINGS: toggle switches
// ================================================================
function initToggles() {
    document.querySelectorAll('[data-toggle]').forEach(btn => {
        btn.addEventListener('click', function() {
            this.classList.toggle('active');
            const name = this.dataset.toggle || 'toggle';
            showToast(`${name} ${this.classList.contains('active')?'enabled':'disabled'}`);
        });
    });
}

// ================================================================
//  BOOT
// ================================================================
(async function boot() {
    accounts = await fetchAccounts();
    selectedAccount = accounts[0] || null;
    initChart();
    initToggles();

    // ── navigation clicks ──
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', function() {
            const page = this.dataset.page;
            if (page) navigateTo(page);
        });
    });

    // ── View All Accounts button ──
    document.getElementById('viewAllAccountsBtn').addEventListener('click', () => navigateTo('accounts'));

    // ── chart range ──
    document.getElementById('chartRange').addEventListener('change', () => {
        if (selectedAccount) updateChart(selectedAccount.accountId);
    });

    // ── symbol filter ──
    document.getElementById('symbolFilter').addEventListener('change', async () => {
        if (selectedAccount) {
            const trades = await fetchTrades(selectedAccount.accountId);
            renderTrades(trades);
        }
    });

    // ── refresh trades ──
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        if (selectedAccount) {
            const trades = await fetchTrades(selectedAccount.accountId);
            renderTrades(trades);
            showToast('Trade data refreshed');
        }
    });

    // ── copy account id ──
    document.querySelector('.copy')?.addEventListener('click', () => {
        if (selectedAccount) {
            navigator.clipboard?.writeText(selectedAccount.accountId);
            showToast('Account ID copied!');
        }
    });

    // ── copy referral link ──
    document.getElementById('copyReferralBtn')?.addEventListener('click', () => {
        const link = document.getElementById('referralLink').textContent;
        navigator.clipboard?.writeText(link);
        showToast('Referral link copied!');
    });

    // ── payout request ──
    document.getElementById('requestPayoutBtn')?.addEventListener('click', () => {
        const amt = document.getElementById('payoutAmount').value;
        const method = document.getElementById('payoutMethod').value;
        const acc = document.getElementById('payoutAccount').value;
        if (!amt || +amt <= 0) { showToast('Please enter a valid amount'); return; }
        showToast(`Payout request of $${amt} via ${method} from ${acc} submitted (demo)`);
    });

    // ── hamburger ──
    document.getElementById('hamburger').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('overlay').classList.toggle('show');
    });
    document.getElementById('overlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('show');
    });

    // ── load initial ──
    if (selectedAccount) {
        await selectAccount(selectedAccount.accountId);
        renderAccountsTable();
        populatePayoutAccounts();
        navigateTo('dashboard');
    }
})();

// ========== NEW: PACKAGE STATE & CHECKOUT LOGIC ==========
let selectedPackage = { name: '', price: 0 };
let basePrice = 0;
let discountAmount = 0;
let finalPrice = 0;

// 1. Package select karne ka function
function selectPackage(name, price) {
    selectedPackage = { name, price };
    basePrice = price;
    discountAmount = 0;
    finalPrice = price;

    // UI Update
    document.getElementById('checkout-package-name').innerText = 'Package: ' + name;
    document.getElementById('base-price').innerText = '$' + price;
    document.getElementById('discount-amount').innerText = '-$0';
    document.getElementById('final-price').innerText = '$' + price;
    document.getElementById('commission-note').innerText = '';

    showSection('checkout');
}

// 2. User details fetch (Simulated API call for now)
function fetchCheckoutDetails() {
    const email = document.getElementById('checkout-email').value;
    
    if (!email) {
        alert('Please enter your email!');
        return;
    }

    // TODO: Yahan backend API call hogi: /api/checkout/get-user-data
    // Abhi ke liye static masked data dikha rahe hain.
    document.getElementById('checkout-name').value = 'Chiranjeet Das';
    document.getElementById('checkout-phone').value = '98****03';
    document.getElementById('checkout-address').value = 'Mall Road Kankwari... 201014';
}

// 3. Affiliate Code verify aur Discount apply karna
function verifyAffiliateCode() {
    const code = document.getElementById('affiliate-code').value;
    const msgEl = document.getElementById('affiliate-msg');
    
    if (!code) {
        msgEl.style.color = 'var(--danger)';
        msgEl.innerText = 'Please enter an affiliate code!';
        return;
    }

    // Logic: Hardcoded Discounts (Backend yahan verify karega)
    if (selectedPackage.name === 'Direct Funded 5K' && code) {
        discountAmount = 5;
        finalPrice = basePrice - discountAmount;
        msgEl.style.color = 'var(--primary)';
        msgEl.innerText = 'Code verified! $5 discount applied.';
        document.getElementById('commission-note').innerText = 'Affiliate Commission: $2';
    } else if (selectedPackage.name === 'Two Step Challenge 5K' && code) {
        discountAmount = 9;
        finalPrice = basePrice - discountAmount;
        msgEl.style.color = 'var(--primary)';
        msgEl.innerText = 'Code verified! $9 discount applied.';
        document.getElementById('commission-note').innerText = 'Affiliate Commission: $5';
    } else {
        discountAmount = 0;
        finalPrice = basePrice;
        msgEl.style.color = 'var(--danger)';
        msgEl.innerText = 'Invalid or unverified code.';
        document.getElementById('commission-note').innerText = '';
    }

    // Update Summary
    document.getElementById('discount-amount').innerText = '-$' + discountAmount;
    document.getElementById('final-price').innerText = '$' + finalPrice;
}

// 4. Payment Button (Razorpay integration yahan hoga)
function makePayment() {
    if (!selectedPackage.name) {
        alert('Please select a package first!');
        return;
    }

    alert('Redirecting to Razorpay for payment of $' + finalPrice + '...');
    // TODO: Yahan Razorpay ka order create karke checkout khulega.
    // Payment success hone ke baad backend Account allot karega aur Support ko email bhejega.
}
