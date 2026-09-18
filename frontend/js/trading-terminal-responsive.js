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
   MOBILE ORDER FAB + BOTTOM SHEET
   ============================================================ */

function initMobileOrderSheet() {
    const fab =
        document.getElementById(
            "mobileOrderFab",
        );

    const sheet =
        document.getElementById(
            "mobileOrderSheet",
        );

    const sheetClose =
        document.getElementById(
            "mobileOrderSheetClose",
        );

    const sheetSymbol =
        document.getElementById(
            "mobileOrderSheetSymbol",
        );

    const feedback =
        document.getElementById(
            "mobileOrderFeedback",
        );

    if (!fab || !sheet) {
        return;
    }

    const isMobile = () =>
        window.innerWidth <= 1100
        || window.matchMedia(
            "(max-aspect-ratio: 1/1)",
        ).matches;

    const refreshFabVisibility = () => {
        if (isMobile()) {
            fab.hidden = false;
        } else {
            fab.hidden = true;
            sheet.classList.remove("open");
        }
    };

    const openSheet = () => {
        const sym =
            typeof T !== "undefined"
                && T.selected
                ? T.selected
                : "EURUSD";

        if (sheetSymbol) {
            sheetSymbol.textContent = sym;
        }

        if (feedback) {
            feedback.textContent = "";
            feedback.className =
                "mobile-order-sheet-feedback";
        }

        sheet.classList.add("open");
    };

    const closeSheet = () => {
        sheet.classList.remove("open");
    };

    fab
        .querySelectorAll("[data-fab-side]")
        .forEach((button) => {
            button.addEventListener(
                "click",
                openSheet,
            );
        });

    if (sheetClose) {
        sheetClose.addEventListener(
            "click",
            closeSheet,
        );
    }

    const backdrop =
        sheet.querySelector(
            ".mobile-order-sheet-backdrop",
        );

    if (backdrop) {
        backdrop.addEventListener(
            "click",
            closeSheet,
        );
    }

    sheet
        .querySelectorAll("[data-sheet-side]")
        .forEach((button) => {
            button.addEventListener(
                "click",
                async () => {
                    const side =
                        button.dataset.sheetSide;

                    const volume =
                        parseFloat(
                            document.getElementById(
                                "mobileVolume",
                            )?.value,
                        );

                    const slInput =
                        document.getElementById(
                            "mobileSl",
                        );

                    const tpInput =
                        document.getElementById(
                            "mobileTp",
                        );

                    const sl =
                        slInput?.value || "";

                    const tp =
                        tpInput?.value || "";

                    if (
                        !Number.isFinite(volume)
                        || volume < 0.01
                        || volume > 2
                    ) {
                        if (feedback) {
                            feedback.textContent =
                                "Lot size must be 0.01 to 2.00.";

                            feedback.className =
                                "mobile-order-sheet-feedback error";
                        }

                        return;
                    }

                    if (feedback) {
                        feedback.textContent =
                            side === "BUY"
                                ? "Buying..."
                                : "Selling...";

                        feedback.className =
                            "mobile-order-sheet-feedback";
                    }

                    button.disabled = true;

                    try {
                        if (
                            typeof execute ===
                            "function"
                        ) {
                            const volInput =
                                document.getElementById(
                                    "volume",
                                );

                            const slDesktopInput =
                                document.getElementById(
                                    "sl",
                                );

                            const tpDesktopInput =
                                document.getElementById(
                                    "tp",
                                );

                            const previousVolume =
                                volInput
                                    ? volInput.value
                                    : "";

                            const previousSl =
                                slDesktopInput
                                    ? slDesktopInput.value
                                    : "";

                            const previousTp =
                                tpDesktopInput
                                    ? tpDesktopInput.value
                                    : "";

                            if (volInput) {
                                volInput.value =
                                    volume;
                            }

                            if (slDesktopInput) {
                                slDesktopInput.value =
                                    sl;
                            }

                            if (tpDesktopInput) {
                                tpDesktopInput.value =
                                    tp;
                            }

                            await execute(side);

                            if (volInput) {
                                volInput.value =
                                    previousVolume;
                            }

                            if (slDesktopInput) {
                                slDesktopInput.value =
                                    previousSl;
                            }

                            if (tpDesktopInput) {
                                tpDesktopInput.value =
                                    previousTp;
                            }
                        }

                        if (feedback) {
                            feedback.textContent =
                                side
                                + " order placed.";

                            feedback.className =
                                "mobile-order-sheet-feedback ok";
                        }

                        window.setTimeout(
                            closeSheet,
                            900,
                        );
                    } catch (error) {
                        if (feedback) {
                            feedback.textContent =
                                error.message
                                || "Order failed.";

                            feedback.className =
                                "mobile-order-sheet-feedback error";
                        }
                    } finally {
                        button.disabled = false;
                    }
                },
            );
        });

    window.addEventListener(
        "resize",
        refreshFabVisibility,
    );

    refreshFabVisibility();
}

document.addEventListener(
    "DOMContentLoaded",
    initMobileOrderSheet,
);
