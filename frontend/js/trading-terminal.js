'use strict';
/* ===== FUNDFXT TRADING TERMINAL CONTROLLER ===== */
const FX_API='https://fundfxt.onrender.com';
const SYMBOLS=['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD','EURGBP','EURJPY','EURAUD','EURCHF','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPNZD','AUDJPY','AUDNZD','AUDCAD','AUDCHF','CADJPY','CADCHF','CHFJPY','NZDJPY','NZDCHF','NZDCAD','XAUUSD','XAGUSD'];
const T = {
    account: null,
    prices: {},
    previousPrices: {},
    selected: 'EURUSD',
    tab: 'OPEN',
    favorites: [],
    trades: [],
};
const $=id=>document.getElementById(id);
const token=()=>localStorage.getItem('fundfxt_token')||'';
const money=c=>'$'+(Number(c||0)/100).toLocaleString('en-US', {
    minimumFractionDigits:2,maximumFractionDigits:2
});
const fmt=(v,s)=>Number.isFinite(Number(v))?Number(v).toFixed(/JPY$/i.test(s)?3:/XAU|XAG|BTC|ETH/i.test(s)?2:5):'—';
const isNum=v=>Number.isFinite(Number(v));
async function api(path,opt= {
}) {
    const r=await fetch(FX_API+path, {
        ...opt,headers: {
            Authorization:'Bearer '+token(),'Content-Type':'application/json',...(opt.headers|| {
            }            )
        }
    }    );
    let d= {
    }    ;
    try {
        d=await r.json()
    }
    catch {
    }
    if(!r.ok)throw Error(d.error||d.message||`Request failed (${r.status})`);
    return d
}
function feedback(msg,ok=false) {
    const x=$('tradeFeedback');
    if(!x)return;
    x.textContent=msg;
    x.className='trade-feedback show '+(ok?'ok':'error');
    clearTimeout(feedback.t);
    feedback.t=setTimeout(()=>x.className='trade-feedback',5000)
}
function loadFavorites() {
    try {
        T.favorites=JSON.parse(localStorage.getItem('fundfxt_favorite_pairs')||'[]').filter(s=>SYMBOLS.includes(s))
    }
    catch {
        T.favorites=[]
    }
    if(!T.favorites.length)T.favorites=SYMBOLS.slice(0,5);
    localStorage.setItem('fundfxt_favorite_pairs',JSON.stringify(T.favorites))
}
function saveFavorites() {
    localStorage.setItem('fundfxt_favorite_pairs',JSON.stringify(T.favorites))
}
function toggleFavorite(symbol) {
    if(T.favorites.includes(symbol)) {
        if(T.favorites.length===1)return feedback('Keep at least one favorite pair.');
        T.favorites=T.favorites.filter(s=>s!==symbol)
    }
    else T.favorites.push(symbol);
    saveFavorites();
    renderPairs()
}
function priceMovementClass(current, previous) {
    if (!isNum(current) || !isNum(previous)) {
        return 'quote-price-flat';
    }

    if (Number(current) > Number(previous)) {
        return 'quote-price-up';
    }

    if (Number(current) < Number(previous)) {
        return 'quote-price-down';
    }

    return 'quote-price-flat';
}

function renderPairs() {
    const box = $('watchlist');

    if (!box) {
        return;
    }

    const query = ($('search')?.value || '')
        .trim()
        .toUpperCase();

    const rows = query
        ? SYMBOLS.filter(
            (symbol) => symbol.includes(query),
        )
        : T.favorites;

    box.innerHTML = rows
        .map((symbol) => {
            const quote = T.prices[symbol] || {};
            const previous = T.previousPrices[symbol] || {};
            const ask = Number(quote.ask);
            const bid = Number(quote.bid);
            const spread = isNum(quote.spread)
                ? Number(quote.spread)
                : ask - bid;
            const change = Number(quote.changePercent);
            const favorite = T.favorites.includes(symbol);

            const askClass = priceMovementClass(
                ask,
                Number(previous.ask),
            );

            const bidClass = priceMovementClass(
                bid,
                Number(previous.bid),
            );

            return `
                <button
                    class="quote ${symbol === T.selected ? 'selected' : ''}"
                    data-symbol="${symbol}"
                    type="button"
                    aria-label="${symbol} market quote"
                >
                    <span class="quote-pair">
                        <b>${symbol}</b>
                        <small
                            class="quote-favorite ${favorite ? 'active' : ''}"
                            title="${favorite ? 'Favorite pair' : 'Add to favorites'}"
                        >
                            ${favorite ? '★' : '☆'}
                        </small>
                    </span>

                    <span class="quote-value quote-spread-value">
                        ${fmt(spread, symbol)}
                    </span>

                    <span
                        class="quote-value quote-ask-value ${askClass}"
                    >
                        ${fmt(ask, symbol)}
                    </span>

                    <span
                        class="quote-value quote-bid-value ${bidClass}"
                    >
                        ${fmt(bid, symbol)}
                    </span>

                    <span
                        class="quote-change ${isNum(change) && change < 0 ? 'negative' : ''}"
                    >
                        ${isNum(change)
                            ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%'
                            : '—'}
                    </span>
                </button>
            `;
        })
        .join('')
        || `
            <div class="favorite-empty">
                ${query
                    ? 'No matching pairs found.'
                    : 'No favorite pairs added yet.'}
            </div>
        `;

    box.querySelectorAll('.quote').forEach((button) => {
        button.onclick = () => {
            T.selected = button.dataset.symbol;

            renderPairs();
            openPanel('center');
            loadChart();
        };
    });

    const live = Object.values(T.prices).some(
        (price) => isNum(price.bid) && isNum(price.ask),
    );

    if ($('market')) {
        $('market').textContent = live
            ? '● LIVE'
            : '● OFFLINE';

        $('market').style.color = live
            ? 'var(--green)'
            : 'var(--red)';
    }

    if ($('selectedSymbol')) {
        $('selectedSymbol').textContent = T.selected;
    }

    if ($('executionSymbol')) {
        $('executionSymbol').textContent = T.selected;
    }
}


async function loadPrices() {
    const d = await api('/api/prices');

    T.previousPrices = T.prices || {};
    T.prices = d.prices || {};

    renderPairs();
}
async function loadAccount() {
    const d=await api('/api/accounts');
    const list=d.accounts||d;
    const params=new URLSearchParams(location.search);
    const wanted=params.get('account_code')||params.get('account')||localStorage.getItem('fundfxt_selected_account');
    T.account=list.find(a=>String(a.account_code)===String(wanted))||list[0];
    if(!T.account)throw Error('No trading account available');
    localStorage.setItem('fundfxt_selected_account',T.account.account_code);
    if ($('rightAccount')) {
        $('rightAccount').textContent = T.account.account_code;
    }

    if ($('accountPhase')) {
        $('accountPhase').textContent =
            T.account.phase
            || T.account.account_phase
            || T.account.status
            || 'ACTIVE';
    }

    if ($('rightBalance')) {
        $('rightBalance').textContent =
            money(T.account.balance_cents);
    }

    if ($('rightEquity')) {
        $('rightEquity').textContent =
            money(T.account.equity_cents);
    }

    renderAccount();
}
function renderAccount() {
    if(!T.account)return;
    if($('balance'))$('balance').textContent=money(T.account.balance_cents);
    if($('equity'))$('equity').textContent=money(T.account.equity_cents);
    if($('chartBalance'))$('chartBalance').textContent='Balance '+money(T.account.balance_cents);
    if($('chartEquity'))$('chartEquity').textContent='Equity '+money(T.account.equity_cents)
}
function loadChart() {
    const host = $('tv');

    if (!host) {
        return;
    }

    host.querySelector('iframe')?.remove();
    host.querySelector('#chartLoading')?.remove();

    const loading = document.createElement('div');

    loading.className = 'chart-loading';
    loading.id = 'chartLoading';

    loading.innerHTML = `
        <span></span>
        <b>Loading ${T.selected} chart…</b>
    `;

    host.appendChild(loading);

    const frame = document.createElement('iframe');
    frame.title = 'FundFXT ${T.selected}';
    frame.allowFullscreen = true;
    frame.loading = 'eager';

    frame.src =
        'https://www.tradingview.com/widgetembed/?symbol='
        + encodeURIComponent('OANDA:' + T.selected)
        + '&interval=15'
        + '&theme=dark'
        + '&style=1'
        + '&locale=en'
        + '&enable_publishing=false'
        + '&hide_top_toolbar=false'
        + '&hide_side_toolbar=false'
        + '&save_image=false'
        + '&allow_symbol_change=true'
        + '&autosize=true';

    frame.addEventListener(
        'load',
        () => {
            const current = $('chartLoading');

            if (current) {
                current.remove();
            }
        },
        {
            once: true,
        },
    );

    frame.addEventListener(
        'error',
        () => {
            const current = $('chartLoading');

            if (current) {
                current.innerHTML = `
                    <b>Chart unavailable</b>
                    <span>Market data is still available in Market Watch.</span>
                `;
            }
        },
        {
            once: true,
        },
    );

    host.appendChild(frame);

    window.clearTimeout(loadChart.timeout);

    loadChart.timeout = window.setTimeout(
        () => {
            const current = $('chartLoading');

            if (current) {
                current.innerHTML = `
                    <b>Chart is taking longer than expected</b>
                    <span>Try selecting the pair again.</span>
                `;
            }
        },
        12000,
    );
}


function openPanel(name) {
    if (name === 'center') {
        document
            .querySelectorAll('.panel')
            .forEach((panel) => {
                panel.classList.remove('mobile-active');
            });

        $('center')?.classList.add('mobile-active');

        return;
    }

    document
        .querySelectorAll('.panel')
        .forEach((panel) => {
            panel.classList.remove('mobile-active');
        });

    $('right')?.classList.add('mobile-active');

    const sectionId =
        'terminal'
        + String(name).charAt(0).toUpperCase()
        + String(name).slice(1);

    const section = document.getElementById(sectionId);

    if (!section) {
        return;
    }

    document
        .querySelectorAll('.terminal-section')
        .forEach((item) => {
            item.classList.remove('active');
            item.hidden = true;
        });

    section.hidden = false;
    section.classList.add('active');

    document
        .querySelectorAll('.right-section-tab')
        .forEach((button) => {
            button.classList.toggle(
                'active',
                button.dataset.section === name,
            );
        });

    if (name === 'trades') {
        loadTrades();
    }

    if (name === 'orders') {
        window.showPendingOrders?.();
    }
}
function tabStatus(tab) {
    return tab==='HISTORY'?'CLOSED':tab
}
function fallbackFloatingPL(t) {
    const p=T.prices[t.symbol]|| {
    }    ,cur=t.side==='BUY'?Number(p.bid):Number(p.ask);
    if(!isNum(cur))return Number(t.floating_profit_cents||0)/100;
    const contract=/XAU|GOLD/i.test(t.symbol)?100:/XAG|SILVER/i.test(t.symbol)?5000:100000;
    return(t.side==='BUY'?cur-Number(t.entry_price):Number(t.entry_price)-cur)*Number(t.volume)*contract
}
function renderTradeCard(t) {
    if(t.status==='CLOSED') {
        const cents=Number(t.realized_profit_cents||0);
        return `<article class="trade-card history-card" data-details="${t.trade_id}"><div class="trade-main"><div><b class="trade-symbol">${t.symbol}</b><small class="trade-id">${t.trade_id}</small></div><b class="trade-side ${String(t.side).toLowerCase()}">${t.side}</b></div><div class="trade-meta"><div><span>Entry</span><b>${fmt(Number(t.entry_price),t.symbol)}</b></div><div><span>Lot</span><b>${Number(t.volume).toFixed(2)}</b></div><div><span>Exit</span><b>${fmt(Number(t.exit_price),t.symbol)}</b></div><div><span>Profit / Loss</span><b class="pl ${cents>=0?'green':'red'}">${cents>=0?'+':''}${money(cents)}</b></div></div><small class="muted">Tap for trade details</small></article>`
    }
    if(t.status!=='OPEN')return '';
    const p=T.prices[t.symbol]|| {
    }    ,cur=t.side==='BUY'?Number(p.bid):Number(p.ask);
    const pl=isNum(t.floating_profit_cents)?Number(t.floating_profit_cents)/100:fallbackFloatingPL(t);
    return `<article class="trade-card"><div class="trade-main"><div><b class="trade-symbol">${t.symbol}</b><small class="trade-id">${t.trade_id}</small></div><b class="trade-side ${String(t.side).toLowerCase()}">${t.side} · ${Number(t.volume).toFixed(2)}L</b></div><div class="trade-meta"><div><span>Entry</span><b>${fmt(Number(t.entry_price),t.symbol)}</b></div><div><span>Current</span><b>${fmt(cur,t.symbol)}</b></div><div><span>P/L</span><b class="pl ${pl>=0?'green':'red'}">${pl>=0?'+':''}$${pl.toFixed(2)}</b></div></div><div class="trade-actions"><button class="mini" data-details="${t.trade_id}" type="button">Details</button><button class="mini close" data-close="${t.trade_id}" type="button">Close</button><button class="mini" data-partial="${t.trade_id}" type="button">Partial close</button></div></article>`
}
function renderTrades() {
    const box=$('tradeScroll');
    if(!box)return;
    const status=tabStatus(T.tab),rows=T.trades.filter(t=>t.status===status);
    box.innerHTML=rows.map(renderTradeCard).join('')||`<div class="empty"><strong>No ${T.tab.toLowerCase()} trades</strong><span>${T.tab==='HISTORY'?'Closed trades will appear here.':T.tab==='PENDING'?'No pending orders.':'No open positions.'}</span></div>`;
    box.querySelectorAll('[data-details]').forEach(b=>b.onclick=()=>showDetails(b.dataset.details));
    box.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closePosition(b.dataset.close));
    box.querySelectorAll('[data-partial]').forEach(b=>b.onclick=()=>partialClose(b.dataset.partial))
}
async function loadTrades(force = false) {
    if (!T.account) {
        return;
    }

    /*
     * A forced refresh is used immediately after close/partial-close.
     * If an older request is still running, wait for it first and then
     * fetch the database state again so the UI cannot repaint stale lots.
     */
    if (T.tradeLoadPromise) {
        if (!force) {
            return T.tradeLoadPromise;
        }

        try {
            await T.tradeLoadPromise;
        }
        catch {
        }
    }

    T.tradeLoadPromise = (async () => {
        try {
            const d = await api(
                '/api/trade/get?account_code='
                + encodeURIComponent(T.account.account_code),
            );

            T.trades = Array.isArray(d.trades)
                ? d.trades
                : [];

            renderTrades();
        }
        catch (e) {
            feedback(e.message);
        }
        finally {
            T.tradeLoadPromise = null;
        }
    })();

    return T.tradeLoadPromise;
}

function showDetails(id) {
    const t=T.trades.find(x=>String(x.trade_id)===String(id));
    if(!t)return;
    const cents=Number(t.realized_profit_cents||0);
    const fields=[['Trade ID',t.trade_id],['Pair',t.symbol],['Direction',t.side],['Lot Size',Number(t.volume).toFixed(2)],['Open Time',t.entry_time||t.created_at||'—'],['Close Time',t.exit_time||'—'],['Entry Price',fmt(Number(t.entry_price),t.symbol)],['Exit Price',fmt(Number(t.exit_price),t.symbol)],['Take Profit',isNum(t.take_profit)?fmt(Number(t.take_profit),t.symbol):'—'],['Stop Loss',isNum(t.stop_loss)?fmt(Number(t.stop_loss),t.symbol):'—'],['Exit By',t.close_reason||'—'],['Calculated P/L',t.status==='CLOSED'?`${cents>=0?'+':''}${money(cents)}`:'Open / Floating']].map(([a,b])=>`<div class="detail"><span>${a}</span><b>${b??'—'}</b></div>`).join('');
    modal('Trade Details',fields,'')
}
function modal(title,body,actions) {
    document.querySelector('.trade-modal')?.remove();
    const x=document.createElement('div');
    x.className='trade-modal';
    x.innerHTML=`<div class="trade-modal-backdrop"></div><div class="trade-modal-card"><div class="trade-modal-head"><h3>${title}</h3><button class="trade-modal-close" type="button">×</button></div><div class="detail-grid">${body}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ''}</div>`;
    document.body.appendChild(x);
    x.querySelector('.trade-modal-close').onclick=()=>x.remove();
    x.querySelector('.trade-modal-backdrop').onclick=()=>x.remove()
}
function closeAmountModal(id, t) {
    const max = Math.round(Number(t.volume) * 100) / 100;
    const body = `
        <div class="detail">
            <span>Pair</span>
            <b>${t.symbol} · ${t.side}</b>
        </div>
        <div class="detail">
            <span>Current Lot</span>
            <b>${max.toFixed(2)}</b>
        </div>
        <label class="modal-input">
            <span>Lots to close</span>
            <input
                id="modalCloseVolume"
                type="number"
                min="0.01"
                max="${Math.max(0, max - 0.01).toFixed(2)}"
                step="0.01"
                value="0.01"
                inputmode="decimal"
            >
            <small id="partialCloseHint" class="modal-input-hint"></small>
        </label>
    `;

    modal(
        "Partial Close",
        body,
        "<span></span>",
    );

    const actionBox = document.querySelector(
        ".trade-modal .modal-actions",
    );
    const input = $("modalCloseVolume");
    const hint = $("partialCloseHint");

    if (!actionBox || !input || !hint) {
        document.querySelector(".trade-modal")?.remove();
        feedback("Partial close action is unavailable.");
        return;
    }

    actionBox.innerHTML = `
        <button
            class="mini close"
            id="confirmPartial"
            type="button"
            disabled
        >
            Close selected lots
        </button>
    `;

    const confirmButton = $("confirmPartial");

    const validatePartialVolume = () => {
        const raw = input.value.trim();
        const value = Number(raw);
        const rounded = Math.round(value * 100) / 100;
        const remaining = Math.round((max - rounded) * 100) / 100;
        let message = "";
        let valid = true;

        if (raw === "" || !Number.isFinite(value)) {
            message = "Enter the number of lots to close.";
            valid = false;
        } else if (Math.abs(value - rounded) > 0.000001) {
            message = "Lot size must use 0.01 steps.";
            valid = false;
        } else if (rounded <= 0) {
            message = "Lots to close must be greater than 0.";
            valid = false;
        } else if (rounded >= max) {
            message =
                rounded === max
                    ? "Partial Close cannot close the full position. Use Close instead."
                    : `Lots to close cannot exceed ${max.toFixed(2)} lot.`;
            valid = false;
        } else if (remaining < 0.01) {
            message = "At least 0.01 lot must remain open.";
            valid = false;
        } else {
            message = `Remaining position: ${remaining.toFixed(2)} lot.`;
        }

        hint.textContent = message;
        hint.classList.toggle("error", !valid);
        hint.classList.toggle("valid", valid);
        confirmButton.disabled = !valid;

        return {
            valid,
            value: rounded,
        };
    };

    input.addEventListener(
        "input",
        validatePartialVolume,
    );
    input.addEventListener(
        "blur",
        validatePartialVolume,
    );
    input.addEventListener(
        "change",
        validatePartialVolume,
    );

    confirmButton.onclick = async () => {
        const result = validatePartialVolume();

        if (!result.valid) {
            return;
        }

        document.querySelector(".trade-modal")?.remove();
        await submitClose(id, result.value, true);
    };

    validatePartialVolume();
}
async function submitClose(id, volume, partial) {
    try {
        const path = partial
            ? '/api/trades/'
                + encodeURIComponent(id)
                + '/partial-close'
            : '/api/trades/'
                + encodeURIComponent(id)
                + '/close';

        const response = await api(
            path,
            {
                method: 'POST',
                body: JSON.stringify({
                    volume,
                }),
            },
        );

        if (partial) {
            const serverRemaining =
                Number(response.remaining_volume);

            if (
                !Number.isFinite(serverRemaining)
                || serverRemaining < 0.01
            ) {
                throw Error(
                    'Partial close returned an invalid remaining volume.',
                );
            }

            feedback(
                'Partial close successful. Remaining '
                + serverRemaining.toFixed(2)
                + ' lot.',
                true,
            );
        }
        else {
            feedback(
                'Position closed successfully.',
                true,
            );
        }

        await loadAccount();
        await loadTrades(true);
    }
    catch (error) {
        feedback(error.message);
    }
}

function closePosition(id) {
    const t=T.trades.find(x=>String(x.trade_id)===String(id));
    if(!t||t.status!=='OPEN')return;
    submitClose(id,Number(t.volume),false)
}
function partialClose(id) {
    const t=T.trades.find(x=>String(x.trade_id)===String(id));
    if(!t||t.status!=='OPEN')return;
    closeAmountModal(id,t)
}
async function execute(side) {
    const code=T.account?.account_code,volume=Number($('volume')?.value),sl=$('sl')?.value===''?null:Number($('sl')?.value),tp=$('tp')?.value===''?null:Number($('tp')?.value);
    const orderType=$('orderType')?.value||'MARKET';
    if(!code)return feedback('No trading account selected.');

    if (orderType !== 'MARKET') {
        if (typeof window.executePendingOrder === 'function') {
            await window.executePendingOrder(side);
            return;
        }

        return feedback('Pending order handler is not available. Please refresh the terminal.');
    }

    if(!isNum(volume)||volume<.01||volume>2)return feedback('Lot size must be 0.01 to 2.00.');
    try {
        const d=await api('/api/trade/execute', {
            method:'POST',body:JSON.stringify( {
                account_code:code,symbol:T.selected,side,volume,sl,tp
            }            )
        }        );
        feedback(`${side} ${T.selected} ${volume.toFixed(2)} lot executed successfully${d.trade_id?' · '+d.trade_id:''}`,true);
        await loadAccount();
        await loadTrades();
        openPanel('trades')
    }
    catch(e) {
        feedback(e.message)
    }
}
function addPair() {
    const body = `
        <div class="pair-add-toolbar">
            <input
                id="favoritePairSearch"
                class="search"
                type="search"
                placeholder="Search pairs…"
                autocomplete="off"
            >
        </div>

        <div
            id="favoritePairList"
            class="pair-add-list"        ></div>
    `;

    modal(
        'Favorite Pairs',
        body,
        '',
    );

    const list = $('favoritePairList');
    const search = $('favoritePairSearch');

    const draw = () => {
        const value = (search?.value || '')
            .trim()
            .toUpperCase();

        const symbols = SYMBOLS.filter(
            (symbol) => symbol.includes(value),
        );

        list.innerHTML = symbols
            .map((symbol) => {
                const favorite = T.favorites.includes(symbol);

                return `
                    <div class="pair-add-item">
                        <div>
                            <b>${symbol}</b>
                            <small>
                                ${favorite
                                    ? 'Favorite'
                                    : 'Available'}
                            </small>
                        </div>

                        <button
                            data-fav="${symbol}"
                            type="button"
                        >
                            ${favorite
                                ? 'Remove'
                                : 'Add'}
                        </button>
                    </div>
                `;
            })
            .join('')
            || `
                <div class="favorite-empty">
                    No pairs found.
                </div>
            `;

        list
            .querySelectorAll('[data-fav]')
            .forEach((button) => {
                button.onclick = () => {
                    toggleFavorite(
                        button.dataset.fav,
                    );

                    draw();
                };
            });
    };

    draw();

    search?.addEventListener(
        'input',
        draw,
    );
}


function logout() {
    localStorage.removeItem('fundfxt_token');
    localStorage.removeItem('fundfxt_selected_account');
    location.href='/dashboard.html'
}
function setup() {
    loadFavorites();

    if ($('terminalLogoutBtn')) {
        $('terminalLogoutBtn').onclick = logout;
    }

    if ($('accountMenuBtn')) {
        $('accountMenuBtn').onclick = () => {
            if (!T.account) {
                feedback('Account is still loading.');
                return;
            }

            location.href =
                '/account-dashboard.html?account_code='
                + encodeURIComponent(
                    T.account.account_code,
                );
        };
    }

    if ($('search')) {
        $('search').oninput = renderPairs;
    }

    if ($('buy')) {
        $('buy').onclick = () => execute('BUY');
    }

    if ($('sell')) {
        $('sell').onclick = () => execute('SELL');
    }

    if ($('orderType')) {
        $('orderType').onchange = () => {
            const isMarket =
                $('orderType').value === 'MARKET';

            $('pendingFields').hidden = isMarket;
        };
    }

    if ($('chartFocusBtn')) {
        $('chartFocusBtn').onclick = () => {
            const shell = $('terminalShell');

            if (!shell) {
                return;
            }

            const hidden =
                shell.classList.toggle(
                    'right-hidden',
                );

            $('chartFocusBtn').setAttribute(
                'aria-label',
                hidden
                    ? 'Show market watch'
                    : 'Focus chart',
            );

            $('chartFocusBtn').textContent =
                hidden
                    ? '↙'
                    : '⛶';
        };
    }

    if ($('rightCollapseBtn')) {
        $('rightCollapseBtn').onclick = () => {
            const shell = $('terminalShell');

            if (!shell) {
                return;
            }

            const hidden =
                shell.classList.toggle(
                    'right-hidden',
                );

            $('rightCollapseBtn').setAttribute(
                'aria-label',
                hidden
                    ? 'Show market rail'
                    : 'Hide market rail',
            );

            $('rightCollapseBtn').textContent =
                hidden
                    ? '‹'
                    : '›';
        };
    }

    document
        .querySelectorAll('.right-section-tab')
        .forEach((button) => {
            button.onclick = () => {
                openPanel(
                    button.dataset.section,
                );
            };
        });

    openPanel('pairs');

    loadAccount()
        .then(loadPrices)
        .then(() => {
            renderPairs();
            loadChart();
            loadTrades();

            if (
                typeof window.showPendingOrders
                === 'function'
            ) {
                window.showPendingOrders();
            }
        })
        .catch((error) => {
            feedback(error.message);
        });

    if (window.lucide?.createIcons) {
        window.lucide.createIcons();
    }
}

document.addEventListener('DOMContentLoaded',setup);
window.loadTrades=loadTrades;
window.loadAccount=loadAccount;