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

        if (link.dataset.view === 'withdraw') {
            renderWithdrawAccounts();
        }

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
        ?? (size && model.includes('5k') ? size * 0.08 : 0)
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
                    <span class="pill">${esc(account.status || 'ACTIVE')}</span>
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
    renderWithdrawAccounts();
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

function renderWithdrawAccounts() {
    const normalized = accounts.map(normalizeAccount);

    $('wAccount').innerHTML = [
        '<option value="">Select account</option>',
        ...normalized.map((account) => {
            return `<option value="${esc(account.id)}">${esc(account.account_code)} · ${esc(account.status)}</option>`;
        })
    ].join('');
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
                    <td>${esc(order.order_ref)}</td>
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

async function loadAffiliate() {
    try {
        const [stats, dashboard] = await Promise.all([
            api('/api/affiliate/stats'),
            api('/api/affiliate/dashboard')
        ]);

        const data = dashboard?.success ? dashboard : stats;
        const code = data.affiliate_code || stats.affiliate_code || 'Unavailable';
        const pendingCents = Number(
            data.pending_earnings_cents
            ?? data.available_earnings_cents
            ?? stats.pending_earnings_cents
            ?? 0
        );

        $('affCode').textContent = code;

        $('copyCode').onclick = async () => {
            try {
                await navigator.clipboard.writeText(code);
                $('copyCode').textContent = 'Copied';
                setTimeout(() => {
                    $('copyCode').textContent = 'Copy';
                }, 1500);
            } catch (error) {
                $('copyCode').textContent = 'Copy failed';
            }
        };

        $('shareCode').onclick = async () => {
            const shareText = 'Join FundFXT with my referral code: ' + code;
            try {
                if (navigator.share) {
                    await navigator.share({
                        title: 'FundFXT Referral',
                        text: shareText
                    });
                } else {
                    await navigator.clipboard.writeText(shareText);
                    $('shareCode').textContent = 'Copied';
                    setTimeout(() => {
                        $('shareCode').textContent = 'Share';
                    }, 1500);
                }
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    $('shareCode').textContent = 'Share failed';
                    setTimeout(() => {
                        $('shareCode').textContent = 'Share';
                    }, 1500);
                }
            }
        };

        $('affRef').textContent = Number(data.total_referrals ?? stats.total_referrals ?? 0);
        $('affSales').textContent = Number(data.verified_sales ?? data.total_sales ?? stats.total_sales ?? 0);
        $('affEarn').textContent = money(
            data.total_earnings_cents ?? stats.total_earnings_cents ?? 0
        );
        $('affPending').textContent = money(pendingCents);

        const remaining = Math.max(10000 - pendingCents, 0);
        $('affPendingHint').textContent = pendingCents < 10000
            ? 'You need ' + money(remaining) + ' more to request payout'
            : 'Minimum payout threshold reached';

        const rows = Array.isArray(dashboard?.commissions)
            ? dashboard.commissions
            : [];

        $('affiliateRows').innerHTML = rows.length
            ? rows.map((sale) => {
                const email = String(sale.customer_email || '—');
                const maskedEmail = email.includes('@')
                    ? email.replace(/^(.{2}).*(@.*)$/, '$1***$2')
                    : email;
                const status = String(sale.status || 'PENDING').toUpperCase();
                const statusClass = status === 'PAID'
                    ? 'status-paid'
                    : status === 'REJECTED' || status === 'CANCELLED'
                        ? 'status-rejected'
                        : 'status-pending';

                return `
                    <tr>
                        <td><span class="masked-email">${esc(maskedEmail)}</span></td>
                        <td class="mono-cell">${esc(sale.account_code || '—')}</td>
                        <td>${sale.created_at ? new Date(sale.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                        <td>${money(sale.final_amount_cents)}</td>
                        <td class="commission-cell">${money(sale.commission_cents)}</td>
                        <td><span class="status-badge ${statusClass}">${esc(status)}</span></td>
                    </tr>
                `;
            }).join('')
            : '<tr><td colspan="6" class="empty-cell">No referred sales yet. Share your code to start earning.</td></tr>';
    } catch (error) {
        $('affCode').textContent = 'Unavailable';
        $('affiliateRows').innerHTML = '<tr><td colspan="6" class="empty-cell">Unable to load referral activity.</td></tr>';
    }
}

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

$('wSubmit').addEventListener('click', async () => {
    try {
        const data = await api('/api/withdrawals/request', {
            method: 'POST',
            body: JSON.stringify({
                account_id: $('wAccount').value,
                amount_cents: Math.round(Number($('wAmount').value) * 100),
                method: $('wMethod').value,
                payment_address: $('wAddress').value
            })
        });

        $('wMsg').textContent = data.success
            ? 'Request submitted: ' + data.request_ref
            : data.error || 'Failed';
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
