/* ============================================================
   FUNDFXT TRADING TERMINAL UI FIXES
   ------------------------------------------------------------
   Keeps background market refreshes lightweight. Trade lists
   refresh only while the Trades view is actually visible.
   ============================================================ */

(() => {
    'use strict';

    function getState() {
        return typeof T !== 'undefined'
            ? T
            : null;
    }

    function syncPendingFields() {
        const orderType = document.getElementById(
            'orderType',
        );

        const pendingFields = document.getElementById(
            'pendingFields',
        );

        if (
            !orderType
            || !pendingFields
        ) {
            return;
        }

        const isMarket =
            orderType.value === 'MARKET';

        pendingFields.hidden = isMarket;

        pendingFields.classList.toggle(
            'hidden',
            isMarket,
        );
    }

    function isTradesViewVisible() {
        const state = getState();

        if (!state) {
            return false;
        }

        const shell = document.getElementById(
            'terminalShell',
        );

        if (
            window.innerWidth <= 768
            && shell?.classList.contains('mobile-trades')
        ) {
            return true;
        }

        const trades = document.getElementById(
            'terminalTrades',
        );

        return Boolean(
            trades
            && !trades.hidden
            && trades.classList.contains('active'),
        );
    }

    function wireTradeTabs() {
        document
            .querySelectorAll('.trade-tab')
            .forEach((button) => {
                button.addEventListener(
                    'click',
                    async () => {
                        const state = getState();

                        if (!state) {
                            return;
                        }

                        state.tab = String(
                            button.dataset.tradeTab
                            || 'open',
                        ).toUpperCase();

                        document
                            .querySelectorAll('.trade-tab')
                            .forEach((tab) => {
                                tab.classList.toggle(
                                    'active',
                                    tab === button,
                                );
                            });

                        if (
                            state.tab === 'PENDING'
                            && typeof window.showPendingOrders === 'function'
                        ) {
                            await window.showPendingOrders();

                            return;
                        }

                        if (
                            typeof loadTrades === 'function'
                        ) {
                            await loadTrades();
                        }
                    },
                );
            });
    }

    function wireMobileNavigation() {
        document
            .querySelectorAll('.mobile-nav-item')
            .forEach((button) => {
                button.addEventListener(
                    'click',
                    () => {
                        const shell = document.getElementById(
                            'terminalShell',
                        );

                        const section =
                            button.dataset.mobileSection;

                        if (!shell) {
                            return;
                        }

                        shell.classList.remove(
                            'mobile-pairs',
                            'mobile-chart',
                            'mobile-trades',
                        );

                        if (section === 'pairs') {
                            shell.classList.add(
                                'mobile-pairs',
                            );
                        }

                        if (section === 'chart') {
                            shell.classList.add(
                                'mobile-chart',
                            );
                        }

                        if (section === 'trades') {
                            shell.classList.add(
                                'mobile-trades',
                            );

                            if (
                                typeof loadTrades === 'function'
                            ) {
                                loadTrades();
                            }
                        }

                        document
                            .querySelectorAll('.mobile-nav-item')
                            .forEach((item) => {
                                item.classList.toggle(
                                    'active',
                                    item === button,
                                );
                            });
                    },
                );
            });
    }

    function startLiveRefresh() {
        if (window.__fundFXTLiveRefreshStarted) {
            return;
        }

        window.__fundFXTLiveRefreshStarted = true;

        window.setInterval(
            async () => {
                try {
                    if (
                        typeof loadPrices === 'function'
                    ) {
                        await loadPrices();
                    }

                    const state = getState();

                    if (
                        state?.tab === 'PENDING'
                        && typeof window.showPendingOrders === 'function'
                        && isTradesViewVisible()
                    ) {
                        await window.showPendingOrders();

                        return;
                    }

                    if (
                        typeof loadTrades === 'function'
                        && state?.account
                        && isTradesViewVisible()
                    ) {
                        await loadTrades();
                    }

                    if (
                        typeof loadAccount === 'function'
                        && isTradesViewVisible()
                    ) {
                        await loadAccount();
                    }
                }
                catch (error) {
                    console.warn(
                        'FundFXT terminal refresh:',
                        error.message,
                    );
                }
            },
            3000,
        );
    }

    function repairDesktopSectionState() {
        const pairs = document.getElementById(
            'terminalPairs',
        );

        const orders = document.getElementById(
            'terminalOrders',
        );

        const trades = document.getElementById(
            'terminalTrades',
        );

        if (
            !pairs
            || !orders
            || !trades
        ) {
            return;
        }

        pairs.hidden = false;
        pairs.classList.add('active');

        orders.hidden = true;

        trades.hidden = true;
    }

    function install() {
        repairDesktopSectionState();

        const orderType = document.getElementById(
            'orderType',
        );

        if (orderType) {
            orderType.addEventListener(
                'change',
                syncPendingFields,
            );
        }

        syncPendingFields();

        wireTradeTabs();

        wireMobileNavigation();

        startLiveRefresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            install,
            {
                once: true,
            },
        );
    }
    else {
        install();
    }
})();
