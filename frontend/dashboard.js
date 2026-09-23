const API = 'https://fundfxt.onrender.com';
const token = localStorage.getItem('fundfxt_token');

if (!token) {
    location.href = '/auth.html';
}

const $ = (id) => document.getElementById(id);

const money = (cents) => {
    return '$' + (Number(cents || 0) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

const esc = (value) => {
    return String(value ?? '—').replace(/[&<>"']/g, (match) => {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[match];
    });
};

function displayPhase(account) {
    return account.phase || account.profile?.phase || '—';
}

function phaseKey(account) {
    const raw = String(account.phase || account.profile?.phase || '').toUpperCase();
    if (raw === 'PHASE_1') return 'phase-1';
    if (raw === 'PHASE_2') return 'phase-2';
    if (raw === 'FUNDED') return 'funded';
    return 'unknown';
}

async function api(path, options = {}) {
    const response = await fetch(API + path, {
        ...options,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }

    return data;
}

function closeMenu() {
    $('drawer').classList.remove('open');
    $('overlay').classList.remove('show');
    document.body.style.overflow = '';
}

$('menu').addEventListener('click', () => {
    const isOpen = $('drawer').classList.toggle('open');
    $('overlay').classList.toggle('show', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
});

$('overlay').addEventListener('click', closeMenu);

document.querySelectorAll('.nav a[data-view]').forEach((link) => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.view').forEach((view) => {
            view.classList.remove('active');
        });

        $(link.dataset.view).classList.add('active');

        document.querySelectorAll('.nav a').forEach((item) => {
            item.classList.remove('active');
        });

        link.classList.add('active');
        closeMenu();

        if (link.dataset.view === 'orders') {
            loadOrders();
        }

        if (link.dataset.view === 'certificates') {
            loadCerts();
        }

        if (link.dataset.view === 'affiliate') {
            loadAffiliate();
        }

        if (link.dataset.view === 'support') {
            loadTickets();
        }

        if (link.dataset.view === 'wallet') {
            loadWallet();
        }
    });
});

$('logout').addEventListener('click', () => {
    localStorage.removeItem('fundfxt_token');
    localStorage.removeItem('fundfxt_selected_account');
    location.href = '/auth.html';
});

let accounts = [];

function normalizeAccount(account) {
    const profile = account.account_profile || {};
    const rules = profile.rules || {};
    const initial = Number(account.initial_balance_cents ?? account.account_size_cents ?? 0);
    const balance = Number(account.balance_cents ?? initial);
    const equity = Number(account.equity_cents ?? balance);
    const size = initial || Number(account.account_size_cents || 0);
    const model = String(account.challenge_model || profile.model || '').toLowerCase();

    const target = Number(
        rules.profitTargetCents
        ?? account.profit_target_cents
        ?? account.target_profit_cents
        ?? (size && model.includes('5k') && String(account.phase || profile.phase || '').toUpperCase() !== 'FUNDED' ? size * 0.08 : 0)
    );

    const daily = Number(
        rules.dailyDrawdownCents
        ?? account.daily_drawdown_cents
        ?? (size && model.includes('5k') ? size * 0.05 : 0)
    );

    const max = Number(
        rules.maxDrawdownCents
        ?? account.max_drawdown_cents
        ?? (size && model.includes('5k') ? size * 0.08 : 0)
    );

    return {
        ...account,
        profile,
        rules,
        initial,
        balance,
        equity,
        target,
        daily,
        max
    };
}

function render() {
    const normalized = accounts.map(normalizeAccount);

    $('total').textContent = normalized.length;
    $('active').textContent = normalized.filter((account) => account.status === 'ACTIVE').length;
    $('passed').textContent = normalized.filter((account) => account.status === 'PASSED').length;
    $('failed').textContent = normalized.filter((account) => {
        return ['BREACHED', 'EXPIRED', 'CLOSED'].includes(account.status);
    }).length;

    $('accounts').innerHTML = normalized.length
        ? normalized.map((account) => {
            const progress = account.target
                ? Math.max(
                    0,
                    Math.min(
                        100,
                        ((account.balance - account.initial) / account.target) * 100
                    )
                )
                : 0;

            return `
                <article class="panel account tilt-card" data-tilt>
                    <h2>${esc(account.account_code)}</h2>
                    <div class="account-badges">
                        <span class="pill">${esc(account.status || 'ACTIVE')}</span>
                        <span class="pill phase ${phaseKey(account)}">${esc(displayPhase(account))}</span>
                    </div>
                    <div class="account-values">
                        <div>
                            <span>Balance</span>
                            <b>${money(account.balance)}</b>
                        </div>
                        <div>
                            <span>Equity</span>
                            <b>${money(account.equity)}</b>
                        </div>
                        <div>
                            <span>Model</span>
                            <b>${esc(account.challenge_model || account.profile.model || 'Trading')}</b>
                        </div>
                        <div>
                            <span>Target</span>
                            <b>${account.target ? money(account.target) : '—'}</b>
                        </div>
                    </div>
                    <div class="progress-label">
                        Profit target progress ${account.target ? progress.toFixed(1) + '%' : '—'}
                    </div>
                    <div class="actions">
                        <button class="btn" type="button" data-account-overview="${encodeURIComponent(account.account_code)}">Overview</button>
                        <button class="btn" type="button" data-account-terminal="${encodeURIComponent(account.account_code)}">Terminal</button>
                    </div>
                </article>
            `;
        }).join('')
        : '<div class="empty">No trading accounts yet.<br><br><a class="btn primary" href="/buy-challenge.html">Buy a challenge</a></div>';

    $('ruleAccounts').innerHTML = normalized.map((account) => {
        return `
            <article class="rule-card tilt-card" data-tilt>
                <b>${esc(account.account_code)}</b>
                <p>Profit target: ${account.target ? money(account.target) : '—'} · Daily DD: ${account.daily ? money(account.daily) : '—'} · Max DD: ${account.max ? money(account.max) : '—'}</p>
                <button class="btn rule-button" type="button" data-account-overview="${encodeURIComponent(account.account_code)}">Open full rules</button>
            </article>
        `;
    }).join('');

    bindAccountActions();
    bindTiltCards();
}

function bindAccountActions() {
    document.querySelectorAll('[data-account-overview]').forEach((button) => {
        button.addEventListener('click', () => {
            const accountCode = decodeURIComponent(button.dataset.accountOverview);
            location.href = '/account-dashboard.html?account_code=' + encodeURIComponent(accountCode);
        });
    });

    document.querySelectorAll('[data-account-terminal]').forEach((button) => {
        button.addEventListener('click', () => {
            const accountCode = decodeURIComponent(button.dataset.accountTerminal);
            location.href = '/trading-terminal.html?account_code=' + encodeURIComponent(accountCode);
        });
    });
}

async function load() {
    try {
        const profile = await api('/api/user/profile');
        $('topName').textContent = profile.legal_name || 'Trader';
        $('heroName').textContent = profile.legal_name || 'Trader';
        accounts = (await api('/api/accounts')).accounts || [];
        render();
        loadAffiliate();
    } catch (error) {
        $('accounts').innerHTML = '<div class="empty">Unable to load dashboard.</div>';
    }
}

async function loadOrders() {
    try {
        const data = await api('/api/orders');
        $('orderRows').innerHTML = (data.orders || []).map((order) => {
            return `
                <tr>
                    <td>${esc(order.request_ref || order.id)}</td>
                    <td>${esc(order.model)}</td>
                    <td>${money(order.original_amount_cents)}</td>
                    <td>${money(order.discount_amount_cents)}</td>
                    <td>${money(order.final_amount_cents)}</td>
                    <td>${esc(order.status)}</td>
                    <td>${order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}</td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="7">No orders.</td></tr>';
    } catch (error) {
        $('orderRows').innerHTML = '<tr><td colspan="7">Unable to load orders.</td></tr>';
    }
}

async function loadCerts() {
    try {
        const data = await api('/api/certificates/my');
        $('certs').innerHTML = (data.certificates || []).map((certificate) => {
            return `
                <div class="certificate-row">
                    <b>${esc(certificate.achievement)}</b>
                    <br>
                    <small>${esc(certificate.account_code)} · ${certificate.issued_on ? new Date(certificate.issued_on).toLocaleDateString() : '—'}</small>
                </div>
            `;
        }).join('') || 'No certificates yet.';
    } catch (error) {
        $('certs').textContent = error.message;
    }
}

let affiliateWalletPage = 1;
const affiliateWalletFilters = { order_id: '', sale_status: '', commission_status: '' };
let walletPassbookPage = 1;
let walletTransferPage = 1;
const walletPassbookFilters = { txn_type: '', source: '' };


async function loadWallet() {
    try {
        const data = await api('/api/user/wallet');
        const w = data.wallet || {};
        
        $('walletBalance').textContent = money(w.balance_cents || 0);
        $('walletTotalReceived').textContent = money(w.total_received_cents || 0);
        $('walletTotalWithdrawn').textContent = money(w.total_withdrawn_cents || 0);
        renderWithdrawalCooldown(w.next_withdrawal_at, w.days_until_next_withdrawal);
        
        await loadWalletPassbook(1);
        await loadAffiliateTransfers(1);
    } catch (error) {
        console.error('Wallet load error:', error);
    }
}

async function loadWalletPassbook(page) {
    try {
        walletPassbookPage = Math.max(Number(page) || 1, 1);
        const params = new URLSearchParams({ page: String(walletPassbookPage), limit: '15' });
        if (walletPassbookFilters.txn_type) params.set('txn_type', walletPassbookFilters.txn_type);
        if (walletPassbookFilters.source) params.set('source', walletPassbookFilters.source);
        
        const data = await api('/api/user/wallet/passbook?' + params.toString());
        const rows = Array.isArray(data.transactions) ? data.transactions : [];
        
        $('walletPassbookRows').innerHTML = rows.length ? rows.map(txn => {
            const isCredit = String(txn.txn_type || '').toUpperCase() === 'CREDIT';
            const date = txn.created_at ? new Date(txn.created_at).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '—';
            return '<tr>' +
                '<td>' + date + '</td>' +
                '<td><span class="txn-type ' + (isCredit ? 'txn-credit' : 'txn-debit') + '">' + (isCredit ? 'CREDIT' : 'DEBIT') + '</span></td>' +
                '<td>' + esc(txn.source || '—') + '</td>' +
                '<td>' + esc(txn.description || '—') + '</td>' +
                '<td class="' + (isCredit ? 'amount-credit' : 'amount-debit') + '">' + (isCredit ? '+' : '−') + money(txn.amount_cents || 0) + '</td>' +
                '<td class="balance-cell">' + money(txn.balance_after_cents || 0) + '</td>' +
                '</tr>';
        }).join('') : '<tr><td colspan="6">No transactions yet.</td></tr>';
        
        $('walletPassbookPageLabel').textContent = 'Page ' + (data.page || 1) + ' of ' + Math.max(data.total_pages || 1, 1);
        $('walletPassbookPrev').disabled = (data.page || 1) <= 1;
        $('walletPassbookNext').disabled = !data.total_pages || (data.page || 1) >= data.total_pages;
    } catch (error) {
        console.error('Passbook error:', error);
        $('walletPassbookRows').innerHTML = '<tr><td colspan="6">Unable to load passbook.</td></tr>';
    }
}

async function loadAffiliateTransfers(page) {
    try {
        walletTransferPage = Math.max(Number(page) || 1, 1);
        const params = new URLSearchParams({ page: String(walletTransferPage), limit: '15' });
        const data = await api('/api/user/wallet/affiliate-transfers?' + params.toString());
        const rows = Array.isArray(data.transfers) ? data.transfers : [];
        
        const pending = rows.find(t => String(t.status).toUpperCase() === 'PENDING');
        if (pending) {
            $('walletPendingSection').style.display = 'block';
            $('walletPendingBody').innerHTML = 
                '<p><b>' + money(pending.amount_cents) + '</b> · ' + esc(pending.transfer_ref) + '</p>' +
                '<p class="sub">Requested: ' + new Date(pending.requested_at).toLocaleString() + '</p>' +
                '<p class="sub">Reason: ' + esc(pending.reason || '—') + '</p>' +
                '<span class="status-badge status-pending">PENDING</span>';
        } else {
            $('walletPendingSection').style.display = 'none';
        }
        
        $('walletTransferRows').innerHTML = rows.length ? rows.map(t => {
            const status = String(t.status || '').toUpperCase();
            const badgeClass = status === 'APPROVED' ? 'status-paid' : status === 'REJECTED' ? 'status-rejected' : 'status-pending';
            return '<tr>' +
                '<td>' + (t.requested_at ? new Date(t.requested_at).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '—') + '</td>' +
                '<td>' + money(t.amount_cents || 0) + '</td>' +
                '<td><span class="status-badge ' + badgeClass + '">' + status + '</span></td>' +
                '<td>' + esc(t.reason || '—') + '</td>' +
                '<td>' + esc(t.rejection_reason || '—') + '</td>' +
                '</tr>';
        }).join('') : '<tr><td colspan="5">No affiliate transfer requests yet.</td></tr>';
        
        $('walletTransferPageLabel').textContent = 'Page ' + (data.page || 1) + ' of ' + Math.max(data.total_pages || 1, 1);
        $('walletTransferPrev').disabled = (data.page || 1) <= 1;
        $('walletTransferNext').disabled = !data.total_pages || (data.page || 1) >= data.total_pages;
    } catch (error) {
        console.error('Transfers error:', error);
    }
}

async function loadAffiliate(page = affiliateWalletPage) {
    try {
        affiliateWalletPage = Math.max(Number(page) || 1, 1);
        const params = new URLSearchParams({ page: String(affiliateWalletPage), limit: '15' });
        Object.entries(affiliateWalletFilters).forEach(([key, value]) => { if (value) params.set(key, value); });

        const data = await api('/api/affiliate/wallet?' + params.toString());
        const code = data.affiliate_code || 'Unavailable';
        $('affCode').textContent = code;

        $('copyCode').onclick = async () => {
            try {
                await navigator.clipboard.writeText(code);
                $('copyCode').textContent = 'Copied';
                setTimeout(() => $('copyCode').textContent = 'Copy', 1500);
            } catch (error) { $('copyCode').textContent = 'Copy failed'; }
        };

        $('shareCode').onclick = async () => {
            const shareText = 'Join FundFXT with my referral code: ' + code;
            try {
                if (navigator.share) await navigator.share({ title: 'FundFXT Referral', text: shareText });
                else {
                    await navigator.clipboard.writeText(shareText);
                    $('shareCode').textContent = 'Copied';
                    setTimeout(() => $('shareCode').textContent = 'Share', 1500);
                }
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    $('shareCode').textContent = 'Share failed';
                    setTimeout(() => $('shareCode').textContent = 'Share', 1500);
                }
            }
        };

        $('affRef').textContent = Number(data.total_referrals || 0);
        $('affSales').textContent = Number(data.total_sales || 0);
        $('affEarn').textContent = money(data.total_earnings_cents || 0);

        const walletBalance = Number(data.wallet_balance_cents || 0);
        const pendingWithdrawal = Number(data.pending_withdrawal_cents || 0);
        $('affPending').textContent = money(walletBalance);
        $('affWalletBalance').textContent = money(walletBalance);
        $('affWalletEarned').textContent = money(data.total_earnings_cents || 0);
        $('affWalletPending').textContent = money(pendingWithdrawal);
        $('affPendingHint').textContent = walletBalance < 10000
            ? 'You need ' + money(10000 - walletBalance) + ' more to request payout'
            : 'Minimum payout threshold reached';
        $('affAmount').max = (walletBalance / 100).toFixed(2);

        const totalPages = Number(data.total_pages || 0);
        const currentPage = Number(data.page || 1);
        $('affiliatePageLabel').textContent = 'Page ' + currentPage + ' of ' + Math.max(totalPages, 1);
        $('affiliatePageSummary').textContent = data.total_count
            ? data.total_count + ' wallet transaction' + (data.total_count === 1 ? '' : 's')
            : 'No wallet transactions';
        $('affiliatePrev').disabled = currentPage <= 1;
        $('affiliateNext').disabled = !totalPages || currentPage >= totalPages;

        const rows = Array.isArray(data.transactions) ? data.transactions : [];
        $('affiliateRows').innerHTML = rows.length ? rows.map((txn) => {
            const isCredit = String(txn.txn_type || '').toUpperCase() === 'CREDIT';
            const status = String(txn.commission_status || 'EARNED').toUpperCase();
            const statusLabel = !isCredit && status === 'PAID' ? 'WITHDRAWN' : status;
            const statusClass = !isCredit && status === 'PAID'
                ? 'status-withdrawn'
                : status === 'PENDING'
                    ? 'status-pending'
                    : status === 'PAID'
                        ? 'status-paid'
                        : 'status-earned';
            const date = txn.created_at ? new Date(txn.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
            return '<tr>' +
                '<td>' + date + '</td>' +
                '<td><span class="txn-type ' + (isCredit ? 'txn-credit' : 'txn-debit') + '">' + (isCredit ? 'CREDIT' : 'DEBIT') + '</span></td>' +
                '<td class="passbook-description">' + esc(txn.description || '—') + (txn.customer_email ? '<small class="passbook-email">' + esc(txn.customer_email) + '</small>' : '') + '</td>' +
                '<td class="mono-cell">' + esc(txn.order_id || '—') + '</td>' +
                '<td>' + esc(txn.sale_status || '—') + '</td>' +
                '<td><span class="status-badge ' + statusClass + '">' + esc(statusLabel) + '</span></td>' +
                '<td class="' + (isCredit ? 'amount-credit' : 'amount-debit') + '">' + (isCredit ? '+' : '−') + money(txn.amount_cents) + '</td>' +
                '<td class="balance-cell">' + money(txn.balance_after_cents) + '</td>' +
                '</tr>';
        }).join('') : '<tr><td colspan="8" class="empty-cell">No wallet transactions found.</td></tr>';
    } catch (error) {
        $('affCode').textContent = 'Unavailable';
        $('affiliateRows').innerHTML = '<tr><td colspan="8" class="empty-cell">Unable to load wallet passbook.</td></tr>';
    }
}

$('affWithdraw').addEventListener('click', () => {
    $('affAmount').focus();
    $('affAmount').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('affiliateApplyFilters').addEventListener('click', () => {
    affiliateWalletFilters.order_id = $('affiliateOrderFilter').value.trim();
    affiliateWalletFilters.sale_status = $('affiliateSaleStatusFilter').value;
    affiliateWalletFilters.commission_status = $('affiliateCommissionStatusFilter').value;
    loadAffiliate(1);
});
$('affiliateClearFilters').addEventListener('click', () => {
    affiliateWalletFilters.order_id = '';
    affiliateWalletFilters.sale_status = '';
    affiliateWalletFilters.commission_status = '';
    $('affiliateOrderFilter').value = '';
    $('affiliateSaleStatusFilter').value = '';
    $('affiliateCommissionStatusFilter').value = '';
    loadAffiliate(1);
});
$('affiliatePrev').addEventListener('click', () => { if (affiliateWalletPage > 1) loadAffiliate(affiliateWalletPage - 1); });
$('affiliateNext').addEventListener('click', () => { loadAffiliate(affiliateWalletPage + 1); });

// Wallet pagination
document.getElementById('walletPassbookPrev')?.addEventListener('click', () => {
    if (walletPassbookPage > 1) loadWalletPassbook(walletPassbookPage - 1);
});
document.getElementById('walletPassbookNext')?.addEventListener('click', () => {
    loadWalletPassbook(walletPassbookPage + 1);
});
document.getElementById('walletTransferPrev')?.addEventListener('click', () => {
    if (walletTransferPage > 1) loadAffiliateTransfers(walletTransferPage - 1);
});
document.getElementById('walletTransferNext')?.addEventListener('click', () => {
    loadAffiliateTransfers(walletTransferPage + 1);
});

// Wallet filters
document.getElementById('walletFilterType')?.addEventListener('change', (e) => {
    walletPassbookFilters.txn_type = e.target.value;
    loadWalletPassbook(1);
});
document.getElementById('walletFilterSource')?.addEventListener('change', (e) => {
    walletPassbookFilters.source = e.target.value;
    loadWalletPassbook(1);
});

// Move Affiliate Balance
document.getElementById('walletMoveAffiliateBtn')?.addEventListener('click', async () => {
    const amountStr = prompt('Enter amount to transfer (USD, min $10):');
    if (!amountStr) return;
    const amountDollars = parseFloat(amountStr);
    if (isNaN(amountDollars) || amountDollars < 10) {
        alert('Minimum transfer is $10.00');
        return;
    }
    const amountCents = Math.round(amountDollars * 100);
    try {
        const result = await api('/api/user/wallet/request-affiliate-transfer', {
            method: 'POST',
            body: JSON.stringify({ amount_cents: amountCents, reason: 'Move from affiliate earnings' })
        });
        alert('Transfer requested: ' + result.transfer_ref);
        await loadWallet();
    } catch (error) {
        alert('Error: ' + error.message);
    }
});

// Wallet withdrawal modal
const walletWithdrawModal = $('walletWithdrawModal');
const walletWithdrawNewTab = $('walletWithdrawNewTab');
const walletWithdrawHistoryTab = $('walletWithdrawHistoryTab');
const walletWithdrawNewPanel = $('walletWithdrawNewPanel');
const walletWithdrawHistoryPanel = $('walletWithdrawHistoryPanel');

function setWalletWithdrawTab(tab) {
    const history = tab === 'history';
    walletWithdrawNewTab.classList.toggle('active', !history);
    walletWithdrawHistoryTab.classList.toggle('active', history);
    walletWithdrawNewTab.setAttribute('aria-selected', String(!history));
    walletWithdrawHistoryTab.setAttribute('aria-selected', String(history));
    walletWithdrawNewPanel.classList.toggle('active', !history);
    walletWithdrawHistoryPanel.classList.toggle('active', history);
    walletWithdrawHistoryPanel.hidden = !history;
    walletWithdrawNewPanel.hidden = history;
}

function openWalletWithdrawModal() {
    if (!walletWithdrawModal) return;
    renderWithdrawalMethodFields();
    setWalletWithdrawTab('new');
    walletWithdrawModal.classList.add('show');
    walletWithdrawModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function closeWalletWithdrawModal() {
    if (!walletWithdrawModal) return;
    walletWithdrawModal.classList.remove('show');
    walletWithdrawModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

document.getElementById('walletWithdrawBtn')?.addEventListener('click', openWalletWithdrawModal);
document.getElementById('walletWithdrawClose')?.addEventListener('click', closeWalletWithdrawModal);
walletWithdrawModal?.addEventListener('click', (event) => {
    if (event.target === walletWithdrawModal) closeWalletWithdrawModal();
});
walletWithdrawNewTab?.addEventListener('click', () => setWalletWithdrawTab('new'));
walletWithdrawHistoryTab?.addEventListener('click', () => {
    setWalletWithdrawTab('history');
    loadWithdrawalHistory();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && walletWithdrawModal?.classList.contains('show')) {
        closeWalletWithdrawModal();
    }
});


async function loadTickets() {
    try {
        const data = await api('/api/support/tickets');
        $('tickets').innerHTML = (data.tickets || []).map((ticket) => {
            return `
                <div class="ticket-row">
                    <b>${esc(ticket.title || ticket.subject)}</b>
                    <br>
                    <small>${ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '—'}</small>
                </div>
            `;
        }).join('') || 'No tickets yet.';
    } catch (error) {
        $('tickets').textContent = 'Unable to load tickets.';
    }
}

$('affPayout').addEventListener('click', async () => {
    const amount = Number($('affAmount').value);

    if (amount < 100) {
        $('affMsg').textContent = 'Minimum payout is $100.';
        return;
    }

    try {
        const data = await api('/api/affiliate/payout/request', {
            method: 'POST',
            body: JSON.stringify({
                amount_cents: Math.round(amount * 100)
            })
        });

        $('affMsg').textContent = data.success
            ? 'Payout requested: ' + data.request_ref
            : data.error || 'Failed';

        if (data.success) {
            loadAffiliate();
        }
    } catch (error) {
        $('affMsg').textContent = error.message;
    }
});

let withdrawalHistoryPage = 1;

function renderWithdrawalMethodFields() {
    const method = $('wMethod')?.value || 'UPI';
    if (!$('wDetails')) return;
    const minimum = method === 'UPI' ? '$10.00' : '$25.00';
    $('wDetails').innerHTML = (method === 'UPI'
        ? '<input id="wUpiId" placeholder="UPI ID (e.g. name@upi)">'
        : '<input id="wWalletAddress" placeholder="Crypto wallet address"><input id="wNetwork" placeholder="Network (e.g. TRC20)">') +
        '<small class="sub">Minimum: ' + minimum + '</small>';
}

function renderWithdrawalCooldown(nextWithdrawalAt, daysUntilNextWithdrawal) {
    const banner = $('wCooldown');
    if (!banner) return;
    if (nextWithdrawalAt && Number(daysUntilNextWithdrawal || 0) > 0) {
        const date = new Date(nextWithdrawalAt);
        banner.textContent = 'Next withdrawal available: ' + (Number.isNaN(date.getTime()) ? nextWithdrawalAt : date.toLocaleString());
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
        banner.textContent = '';
    }
}

function renderWithdrawalHistory(rows) {
    const body = $('wHistoryRows');
    if (!body) return;
    body.innerHTML = rows.length
        ? rows.map((row) => `<tr><td><b>${esc(row.request_ref)}</b></td><td>${money(row.amount_cents)}</td><td>${esc(row.method)}</td><td><span class="badge ${row.status === 'APPROVED' ? 'green' : row.status === 'REJECTED' ? 'red' : 'yellow'}">${esc(row.status)}</span></td><td>${row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td><td>${esc(row.admin_note || '—')}</td></tr>`).join('')
        : '<tr><td colspan="6">No withdrawal requests found.</td></tr>';
}

async function loadWithdrawalHistory() {
    try {
        const status = $('wHistoryStatus')?.value || '';
        const params = new URLSearchParams({ page: String(withdrawalHistoryPage), limit: '10' });
        if (status) params.set('status', status);
        const data = await api('/api/user/wallet/withdrawals?' + params.toString());
        renderWithdrawalHistory(Array.isArray(data.withdrawals) ? data.withdrawals : []);
        const total = Number(data.pagination?.total || 0);
        const limit = Number(data.pagination?.limit || 10);
        const pages = Math.max(1, Math.ceil(total / limit));
        $('wHistoryPageLabel').textContent = `Page ${withdrawalHistoryPage} of ${pages}`;
        $('wHistoryPrev').disabled = withdrawalHistoryPage <= 1;
        $('wHistoryNext').disabled = withdrawalHistoryPage >= pages;
    } catch (error) {
        $('wHistoryRows').innerHTML = `<tr><td colspan="6">${esc(error.message)}</td></tr>`;
    }
}

$('wMethod').addEventListener('change', renderWithdrawalMethodFields);
$('wHistoryStatus').addEventListener('change', () => { withdrawalHistoryPage = 1; loadWithdrawalHistory(); });
$('wHistoryRefresh').addEventListener('click', loadWithdrawalHistory);
$('wHistoryPrev').addEventListener('click', () => { if (withdrawalHistoryPage > 1) { withdrawalHistoryPage--; loadWithdrawalHistory(); } });
$('wHistoryNext').addEventListener('click', () => { withdrawalHistoryPage++; loadWithdrawalHistory(); });

$('wSubmit').addEventListener('click', async () => {
    try {
        const amountCents = Math.round(Number($('wAmount').value) * 100);
        if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Enter a valid withdrawal amount');
        const method = $('wMethod').value;
        const details = method === 'UPI'
            ? { upi_id: $('wUpiId').value.trim() }
            : { wallet_address: $('wWalletAddress').value.trim(), network: $('wNetwork').value.trim() };
        if (method === 'UPI' && !details.upi_id) throw new Error('Enter your UPI ID');
        if (method === 'CRYPTO' && (!details.wallet_address || !details.network)) throw new Error('Enter wallet address and network');
        const data = await api('/api/user/wallet/withdrawals/request', {
            method: 'POST',
            body: JSON.stringify({ amount_cents: amountCents, method, details })
        });
        $('wMsg').textContent = data.success ? 'Request submitted: ' + data.request_ref : data.error || 'Failed';
        if (data.success) {
            $('wAmount').value = '';
            renderWithdrawalMethodFields();
            withdrawalHistoryPage = 1;
            loadWithdrawalHistory();
            loadWallet();
        }
    } catch (error) {
        $('wMsg').textContent = error.message;
    }
});

$('ticketSubmit').addEventListener('click', async () => {
    try {
        const data = await api('/api/support/ticket', {
            method: 'POST',
            body: JSON.stringify({
                subject: $('ticketSubject').value,
                message: $('ticketMessage').value
            })
        });

        $('ticketMsg').textContent = data.success
            ? 'Ticket created: ' + data.ticket_ref
            : data.error || 'Failed';

        if (data.success) {
            loadTickets();
        }
    } catch (error) {
        $('ticketMsg').textContent = error.message;
    }
});

function bindTiltCards() {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
        if (card.dataset.tiltBound === 'true') {
            return;
        }

        card.dataset.tiltBound = 'true';

        card.addEventListener('pointermove', (event) => {
            if (
                window.innerWidth <= 800
                || window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ) {
                return;
            }

            const rect = card.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width;
            const y = (event.clientY - rect.top) / rect.height;
            const rotateY = (x - 0.5) * 7;
            const rotateX = (0.5 - y) * 7;

            card.style.setProperty(
                '--rx',
                rotateX.toFixed(2) + 'deg'
            );
            card.style.setProperty(
                '--ry',
                rotateY.toFixed(2) + 'deg'
            );
            card.style.setProperty(
                '--lift',
                '-7px'
            );
        });

        card.addEventListener('pointerleave', () => {
            card.style.setProperty('--rx', '0deg');
            card.style.setProperty('--ry', '0deg');
            card.style.setProperty('--lift', '0px');
        });
    });
}

load();
