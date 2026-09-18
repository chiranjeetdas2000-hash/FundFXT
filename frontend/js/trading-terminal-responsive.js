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
