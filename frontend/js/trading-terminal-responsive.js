(() => {
    'use strict';

    const shell = document.getElementById(
        'terminalShell',
    );

    if (!shell) {
        return;
    }

    const compact = () =>
        matchMedia(
            '(max-width:1100px),(max-aspect-ratio:1/1)',
        ).matches;

    function sync() {
        if (!compact()) {
            shell.classList.remove(
                'mobile-pairs',
                'mobile-chart',
                'mobile-trades',
            );

            return;
        }

        if (
            !shell.classList.contains('mobile-pairs')
            && !shell.classList.contains('mobile-chart')
            && !shell.classList.contains('mobile-trades')
        ) {
            shell.classList.add(
                'mobile-pairs',
            );
        }
    }

    sync();

    window.addEventListener(
        'resize',
        sync,
    );
})();
/* ============================================================
   MOBILE EXECUTION BUTTON
   Opens the existing mobile order sheet without duplicating
   order execution logic.
   ============================================================ */

(() => {
    'use strict';

    const isMobile = () =>
        window.matchMedia(
            '(max-width: 768px)',
        ).matches;

    const button = document.getElementById(
        'mobile-exec-toggle',
    );

    const sheet = document.getElementById(
        'mobileOrderSheet',
    );

    const sheetClose = document.getElementById(
        'mobileOrderSheetClose',
    );

    const backdrop = sheet?.querySelector(
        '.mobile-order-sheet-backdrop',
    );

    const sheetSymbol = document.getElementById(
        'mobileOrderSheetSymbol',
    );

    const selectedSymbol = document.getElementById(
        'selectedSymbol',
    );

    if (!button || !sheet) {
        return;
    }

    const syncSheetSymbol = () => {
        if (!sheetSymbol) {
            return;
        }

        if (
            typeof T !== 'undefined'
            && T.selected
        ) {
            sheetSymbol.textContent = T.selected;
            return;
        }

        if (selectedSymbol?.textContent) {
            sheetSymbol.textContent =
                selectedSymbol.textContent.trim();
        }
    };

    const openOrderSheet = () => {
        if (!isMobile()) {
            return;
        }

        syncSheetSymbol();
        sheet.classList.add('open');
    };

    const closeOrderSheet = () => {
        sheet.classList.remove('open');
    };

    window.openOrderSheet = openOrderSheet;
    window.closeOrderSheet = closeOrderSheet;

    button.addEventListener(
        'click',
        openOrderSheet,
    );

    if (sheetClose) {
        sheetClose.addEventListener(
            'click',
            closeOrderSheet,
        );
    }

    if (backdrop) {
        backdrop.addEventListener(
            'click',
            closeOrderSheet,
        );
    }

    window.addEventListener(
        'resize',
        () => {
            if (!isMobile()) {
                closeOrderSheet();
            }
        },
    );
})();


/* ============================================================
   MOBILE ORDER TYPE BRIDGE
   Uses the existing desktop execution logic.
   The mobile sheet mirrors the existing order IDs/classes.
   ============================================================ */

(() => {
    'use strict';

    const mobileWrapper = document.getElementById(
        'mobile-order-wrapper',
    );

    if (!mobileWrapper) {
        return;
    }

    const mobileOrderType = mobileWrapper.querySelector(
        '#orderType',
    );

    const mobilePendingFields = mobileWrapper.querySelector(
        '#pendingFields',
    );

    const mobileEntry = mobileWrapper.querySelector(
        '#entry',
    );

    const mobileVolume = mobileWrapper.querySelector(
        '#mobileVolume',
    );

    const mobileSl = mobileWrapper.querySelector(
        '#mobileSl',
    );

    const mobileTp = mobileWrapper.querySelector(
        '#mobileTp',
    );

    const mobileFeedback = mobileWrapper.querySelector(
        '#mobileOrderFeedback',
    );

    const desktopOrderType = document.querySelector(
        '.execution-card #orderType',
    );

    const desktopPendingFields = document.querySelector(
        '.execution-card #pendingFields',
    );

    const desktopEntry = document.querySelector(
        '.execution-card #entry',
    );

    const desktopVolume = document.querySelector(
        '.execution-card #volume',
    );

    const desktopSl = document.querySelector(
        '.execution-card #sl',
    );

    const desktopTp = document.querySelector(
        '.execution-card #tp',
    );

    const desktopBuy = document.querySelector(
        '.execution-card #buy',
    );

    const desktopSell = document.querySelector(
        '.execution-card #sell',
    );

    const desktopFeedback = document.querySelector(
        '.execution-card #tradeFeedback',
    );

    if (
        !mobileOrderType
        || !mobilePendingFields
        || !mobileEntry
        || !desktopOrderType
        || !desktopPendingFields
        || !desktopEntry
    ) {
        return;
    }

    const isPendingType = (value) => {
        return [
            'BUY_LIMIT',
            'SELL_LIMIT',
            'BUY_STOP',
            'SELL_STOP',
        ].includes(
            String(value || '').toUpperCase(),
        );
    };

    const syncMobilePendingVisibility = () => {
        const pending = isPendingType(
            mobileOrderType.value,
        );

        mobilePendingFields.hidden = !pending;
    };

    const syncFromDesktop = () => {
        mobileOrderType.value = desktopOrderType.value;

        if (mobileVolume && desktopVolume) {
            mobileVolume.value = desktopVolume.value;
        }

        if (mobileSl && desktopSl) {
            mobileSl.value = desktopSl.value;
        }

        if (mobileTp && desktopTp) {
            mobileTp.value = desktopTp.value;
        }

        if (mobileEntry && desktopEntry) {
            mobileEntry.value = desktopEntry.value;
        }

        syncMobilePendingVisibility();
    };

    const syncToDesktop = () => {
        desktopOrderType.value = mobileOrderType.value;

        if (mobileVolume && desktopVolume) {
            desktopVolume.value = mobileVolume.value;
        }

        if (mobileSl && desktopSl) {
            desktopSl.value = mobileSl.value;
        }

        if (mobileTp && desktopTp) {
            desktopTp.value = mobileTp.value;
        }

        if (mobileEntry && desktopEntry) {
            desktopEntry.value = mobileEntry.value;
        }

        desktopOrderType.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true,
                },
            ),
        );

        syncMobilePendingVisibility();
    };

    mobileOrderType.addEventListener(
        'change',
        syncToDesktop,
    );

    [mobileVolume, mobileSl, mobileTp, mobileEntry]
        .filter(Boolean)
        .forEach((input) => {
            input.addEventListener(
                'input',
                () => {
                    if (input === mobileVolume && desktopVolume) {
                        desktopVolume.value = input.value;
                    }

                    if (input === mobileSl && desktopSl) {
                        desktopSl.value = input.value;
                    }

                    if (input === mobileTp && desktopTp) {
                        desktopTp.value = input.value;
                    }

                    if (input === mobileEntry && desktopEntry) {
                        desktopEntry.value = input.value;
                    }
                },
            );
        });

    const executeMobile = (side) => {
        syncToDesktop();

        const button = side === 'BUY'
            ? desktopBuy
            : desktopSell;

        if (!button) {
            return;
        }

        button.click();
    };

    mobileWrapper
        .querySelectorAll('[data-sheet-side]')
        .forEach((button) => {
            button.addEventListener(
                'click',
                () => {
                    executeMobile(
                        button.dataset.sheetSide,
                    );
                },
            );
        });

    const syncFeedback = () => {
        if (!mobileFeedback || !desktopFeedback) {
            return;
        }

        mobileFeedback.textContent =
            desktopFeedback.textContent;

        mobileFeedback.className =
            'mobile-order-sheet-feedback';

        if (desktopFeedback.classList.contains('ok')) {
            mobileFeedback.classList.add('ok');
        }

        if (desktopFeedback.classList.contains('error')) {
            mobileFeedback.classList.add('error');
        }
    };

    if (desktopFeedback) {
        const observer = new MutationObserver(
            syncFeedback,
        );

        observer.observe(
            desktopFeedback,
            {
                childList: true,
                characterData: true,
                attributes: true,
                subtree: true,
            },
        );
    }

    window.syncMobileOrderSheet = syncFromDesktop;

    syncFromDesktop();
})();

/* ============================================================
   MOBILE REQUEST LOADER
   Coordinates mobile execution and pair loading feedback.
   Desktop execution logic remains unchanged.
   ============================================================ */

(() => {
    'use strict';

    const isMobile = () => {
        return window.matchMedia(
            '(max-width: 768px)',
        ).matches;
    };

    const overlay = document.getElementById(
        'mobile-loader-overlay',
    );

    if (!overlay) {
        return;
    }

    let activeRequests = 0;

    const getMobileButtons = () => {
        return Array.from(
            document.querySelectorAll(
                '.mobile-order-sheet [data-sheet-side]',
            ),
        );
    };

    const setMobileButtonsDisabled = (disabled) => {
        getMobileButtons().forEach((button) => {
            button.disabled = disabled;

            button.setAttribute(
                'aria-disabled',
                String(disabled),
            );
        });
    };

    const showMobileLoader = () => {
        if (!isMobile()) {
            return;
        }

        activeRequests += 1;

        overlay.classList.add(
            'active',
        );

        overlay.setAttribute(
            'aria-hidden',
            'false',
        );

        setMobileButtonsDisabled(true);
    };

    const hideMobileLoader = () => {
        if (!isMobile()) {
            overlay.classList.remove(
                'active',
            );

            overlay.setAttribute(
                'aria-hidden',
                'true',
            );

            activeRequests = 0;

            setMobileButtonsDisabled(false);

            return;
        }

        activeRequests = Math.max(
            0,
            activeRequests - 1,
        );

        if (activeRequests > 0) {
            return;
        }

        overlay.classList.remove(
            'active',
        );

        overlay.setAttribute(
            'aria-hidden',
            'true',
        );

        setMobileButtonsDisabled(false);
    };

    window.showMobileLoader = showMobileLoader;
    window.hideMobileLoader = hideMobileLoader;

    /*
     * The mobile sheet delegates BUY/SELL to the existing execute()
     * function. Wrapping that existing function lets us wait for its
     * complete async flow, including pending-order execution, account
     * refresh, trade refresh, and final UI navigation.
     */
    if (typeof window.execute === 'function') {
        const originalExecute = window.execute;

        window.execute = async function mobileExecuteWrapper(side) {
            if (!isMobile()) {
                return originalExecute(side);
            }

            showMobileLoader();

            try {
                return await originalExecute(side);
            }
            finally {
                hideMobileLoader();
            }
        };
    }

    /*
     * Pair switching calls the existing loadChart() function. The
     * loader remains visible until the newly created TradingView iframe
     * reports load/error, with a safety timeout for an unavailable
     * external chart.
     */
    if (typeof window.loadChart === 'function') {
        const originalLoadChart = window.loadChart;

        window.loadChart = function mobileLoadChartWrapper(...args) {
            const mobileRequest = isMobile();

            if (!mobileRequest) {
                return originalLoadChart.apply(
                    this,
                    args,
                );
            }

            showMobileLoader();

            const result = originalLoadChart.apply(
                this,
                args,
            );

            const host = document.getElementById(
                'tv',
            );

            const finish = () => {
                hideMobileLoader();
            };

            const attach = () => {
                const frame = host?.querySelector(
                    'iframe',
                );

                if (!frame) {
                    finish();
                    return;
                }

                frame.addEventListener(
                    'load',
                    finish,
                    {
                        once: true,
                    },
                );

                frame.addEventListener(
                    'error',
                    finish,
                    {
                        once: true,
                    },
                );
            };

            window.requestAnimationFrame(
                attach,
            );

            window.setTimeout(
                finish,
                12000,
            );

            return result;
        };
    }

    window.addEventListener(
        'resize',
        () => {
            if (!isMobile()) {
                activeRequests = 0;

                overlay.classList.remove(
                    'active',
                );

                overlay.setAttribute(
                    'aria-hidden',
                    'true',
                );

                setMobileButtonsDisabled(false);
            }
        },
    );
})();
