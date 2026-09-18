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
   MOBILE CHART LONG-PRESS TRIGGER
   Reuses the existing Mobile Order Sheet.
   No order execution logic is implemented here.
   ============================================================ */

(() => {
    'use strict';

    const isMobile = () =>
        window.matchMedia('(max-width: 768px)').matches;

    const chartStage = document.getElementById('tv');
    const sheet = document.getElementById('mobileOrderSheet');
    const sheetClose = document.getElementById('mobileOrderSheetClose');
    const sheetSymbol = document.getElementById('mobileOrderSheetSymbol');

    if (!chartStage || !sheet) {
        return;
    }

    const openOrderSheet = () => {
        if (!isMobile()) {
            return;
        }

        if (
            sheetSymbol
            && typeof T !== 'undefined'
            && T.selected
        ) {
            sheetSymbol.textContent = T.selected;
        }

        sheet.classList.add('open');
    };

    const closeOrderSheet = () => {
        sheet.classList.remove('open');
    };

    window.openOrderSheet = openOrderSheet;
    window.closeOrderSheet = closeOrderSheet;

    const trigger = document.createElement('button');

    trigger.className = 'chart-longpress-trigger';
    trigger.type = 'button';
    trigger.setAttribute(
        'aria-label',
        'Open order sheet',
    );

    chartStage.appendChild(trigger);

    let pressTimer = null;
    let longPressTriggered = false;

    const clearPress = () => {
        if (pressTimer !== null) {
            window.clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    trigger.addEventListener(
        'pointerdown',
        () => {
            if (!isMobile()) {
                return;
            }

            longPressTriggered = false;
            clearPress();

            pressTimer = window.setTimeout(
                () => {
                    longPressTriggered = true;
                    openOrderSheet();
                },
                500,
            );
        },
    );

    trigger.addEventListener(
        'pointerup',
        clearPress,
    );

    trigger.addEventListener(
        'pointercancel',
        clearPress,
    );

    trigger.addEventListener(
        'pointerleave',
        clearPress,
    );

    trigger.addEventListener(
        'click',
        (event) => {
            if (longPressTriggered) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
    );

    if (sheetClose) {
        sheetClose.addEventListener(
            'click',
            closeOrderSheet,
        );
    }

    const backdrop = sheet.querySelector(
        '.mobile-order-sheet-backdrop',
    );

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
