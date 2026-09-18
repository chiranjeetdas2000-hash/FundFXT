/* ============================================================
   FUNDFXT TRADING TERMINAL — PAIR MANAGER FIX
   Keeps pair-management behavior isolated from trading logic.
   Maximum Market Watch scope: 24 instruments.
   ============================================================ */

(() => {
    'use strict';

    const MAX_PAIRS = 24;

    const ALLOWED_SYMBOLS = [
        'EURUSD',
        'GBPUSD',
        'USDJPY',
        'USDCHF',
        'AUDUSD',
        'USDCAD',
        'NZDUSD',
        'EURGBP',
        'EURJPY',
        'EURAUD',
        'EURCHF',
        'EURNZD',
        'GBPJPY',
        'GBPCHF',
        'GBPAUD',
        'GBPNZD',
        'AUDJPY',
        'AUDNZD',
        'AUDCAD',
        'AUDCHF',
        'CADJPY',
        'CADCHF',
        'XAUUSD',
        'XAGUSD',
    ];

    function getElement(id) {
        return document.getElementById(id);
    }

    function normalizeFavorites() {
        const stored = Array.isArray(T.favorites)
            ? T.favorites
            : [];

        const allowed = stored.filter(
            (symbol) => ALLOWED_SYMBOLS.includes(symbol),
        );

        T.favorites = allowed.length
            ? allowed.slice(0, MAX_PAIRS)
            : ALLOWED_SYMBOLS.slice(0, 5);

        saveFavorites();
    }

    function renderMarketWatch() {
        const box = getElement('watchlist');

        if (!box) {
            return;
        }

        const query = (
            getElement('search')?.value || ''
        )
            .trim()
            .toUpperCase();

        const rows = query
            ? ALLOWED_SYMBOLS.filter(
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
                                ? (change >= 0 ? '+' : '')
                                    + change.toFixed(2)
                                    + '%'
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

        box.querySelectorAll('.quote').forEach(
            (button) => {
                button.onclick = () => {
                    T.selected = button.dataset.symbol;

                    renderMarketWatch();
                    loadChart();

                    if (
                        window.innerWidth <= 768
                    ) {
                        const chartTab =
                            document.querySelector(
                                '[data-mobile-section="chart"]',
                            );

                        if (chartTab) {
                            chartTab.click();
                        }
                    } else {
                        openPanel('center');
                    }
                };
            },
        );
    }

    function saveAndRender() {
        saveFavorites();
        renderMarketWatch();
        drawPairManager();
    }

    function toggleManagedPair(symbol) {
        if (!ALLOWED_SYMBOLS.includes(symbol)) {
            return;
        }

        if (T.favorites.includes(symbol)) {
            if (T.favorites.length === 1) {
                feedback(
                    'Keep at least one favorite pair.',
                );
                return;
            }

            T.favorites = T.favorites.filter(
                (item) => item !== symbol,
            );

            saveAndRender();
            return;
        }

        if (T.favorites.length >= MAX_PAIRS) {
            feedback(
                'Maximum 24 Market Watch pairs reached.',
            );
            return;
        }

        T.favorites.push(symbol);
        saveAndRender();
    }

    function drawPairManager() {
        const list = getElement(
            'pairManagerList',
        );

        const count = getElement(
            'pairManagerCount',
        );

        const search = getElement(
            'pairManagerSearch',
        );

        if (!list || !count) {
            return;
        }

        const query = (
            search?.value || ''
        )
            .trim()
            .toUpperCase();

        const symbols = ALLOWED_SYMBOLS.filter(
            (symbol) => symbol.includes(query),
        );

        count.textContent =
            T.favorites.length
            + ' / '
            + MAX_PAIRS
            + ' pairs selected';

        list.innerHTML = symbols
            .map((symbol) => {
                const selected =
                    T.favorites.includes(symbol);

                return `
                    <div class="pair-manager-item">
                        <div>
                            <b class="pair-manager-symbol">
                                ${symbol}
                            </b>
                            <small class="pair-manager-state">
                                ${selected
                                    ? 'Shown in Market Watch'
                                    : 'Available'}
                            </small>
                        </div>

                        <button
                            class="pair-manager-button ${selected ? 'remove' : 'add'}"
                            data-pair-manager="${symbol}"
                            type="button"
                        >
                            ${selected ? 'Remove' : 'Add'}
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
            .querySelectorAll(
                '[data-pair-manager]',
            )
            .forEach((button) => {
                button.onclick = () => {
                    toggleManagedPair(
                        button.dataset.pairManager,
                    );
                };
            });
    }

    function openPairManager() {
        document
            .querySelector('.pair-manager-modal')
            ?.remove();

        const modal = document.createElement('div');

        modal.className =
            'trade-modal pair-manager-modal';

        modal.innerHTML = `
            <div class="trade-modal-backdrop"></div>

            <div class="trade-modal-card pair-manager">
                <div class="trade-modal-head">
                    <h3>Add Pairs</h3>

                    <button
                        class="trade-modal-close"
                        type="button"
                        aria-label="Close Add Pairs"
                    >
                        ×
                    </button>
                </div>

                <div class="pair-add-toolbar">
                    <input
                        id="pairManagerSearch"
                        class="search"
                        type="search"
                        placeholder="Search pairs…"
                        autocomplete="off"
                    >
                </div>

                <div
                    id="pairManagerCount"
                    class="pair-manager-count"
                ></div>

                <div
                    id="pairManagerList"
                    class="pair-manager-list"
                ></div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => {
            modal.remove();
        };

        modal
            .querySelector('.trade-modal-close')
            .onclick = close;

        modal
            .querySelector('.trade-modal-backdrop')
            .onclick = close;

        const search = getElement(
            'pairManagerSearch',
        );

        search?.addEventListener(
            'input',
            drawPairManager,
        );

        drawPairManager();

        search?.focus();
    }

    function install() {
        normalizeFavorites();

        const addButton = getElement(
            'addPairBtn',
        );

        if (addButton) {
            addButton.onclick = openPairManager;
            addButton.setAttribute(
                'aria-label',
                'Add Pairs',
            );
            addButton.setAttribute(
                'title',
                'Add Pairs',
            );
        }

        const search = getElement('search');

        if (search) {
            search.oninput = renderMarketWatch;
        }

        renderMarketWatch();
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            install,
            {
                once: true,
            },
        );
    } else {
        install();
    }

    window.fundfxtPairManager = {
        maxPairs: MAX_PAIRS,
        allowedSymbols: ALLOWED_SYMBOLS,
        open: openPairManager,
    };
})();
