/* ===== FUNDFXT TRADING TERMINAL UI FIXES ===== */
(function () {
    "use strict";

    function getState() {
        return typeof T !== "undefined" ? T : null;
    }

    function syncPendingFields() {
        const orderType = document.getElementById("orderType");
        const pendingFields = document.getElementById("pendingFields");

        if (!orderType || !pendingFields) {
            return;
        }

        const isMarket = orderType.value === "MARKET";

        pendingFields.hidden = isMarket;
        pendingFields.classList.toggle("hidden", isMarket);
    }

    function wireRightTabs() {
        document.querySelectorAll(".right-section-tab").forEach((button) => {
            button.addEventListener("click", () => {
                if (typeof openPanel === "function") {
                    openPanel(button.dataset.section);
                }
            });
        });
    }

    function wireTradeTabs() {
        document.querySelectorAll(".trade-tab").forEach((button) => {
            button.addEventListener("click", async () => {
                const state = getState();

                if (!state) {
                    return;
                }

                state.tab = String(
                    button.dataset.tradeTab || "open"
                ).toUpperCase();

                document.querySelectorAll(".trade-tab").forEach((tab) => {
                    tab.classList.toggle("active", tab === button);
                });

                if (state.tab === "PENDING") {
                    if (typeof window.showPendingOrders === "function") {
                        await window.showPendingOrders();
                    }
                    return;
                }

                if (typeof loadTrades === "function") {
                    await loadTrades();
                }
            });
        });
    }

    function wireMobileNavigation() {
        document.querySelectorAll(".mobile-nav-item").forEach((button) => {
            button.addEventListener("click", () => {
                const shell = document.getElementById("terminalShell");
                const section = button.dataset.mobileSection;

                if (!shell) {
                    return;
                }

                shell.classList.remove(
                    "mobile-pairs",
                    "mobile-chart",
                    "mobile-trades"
                );

                if (section === "pairs") {
                    shell.classList.add("mobile-pairs");
                }

                if (section === "chart") {
                    shell.classList.add("mobile-chart");
                }

                if (section === "trades") {
                    shell.classList.add("mobile-trades");

                    if (typeof loadTrades === "function") {
                        loadTrades();
                    }
                }

                document.querySelectorAll(".mobile-nav-item").forEach((item) => {
                    item.classList.toggle("active", item === button);
                });
            });
        });
    }

    function startLiveRefresh() {
        if (window.__fundFXTLiveRefreshStarted) {
            return;
        }

        window.__fundFXTLiveRefreshStarted = true;

        setInterval(async () => {
            try {
                if (typeof loadPrices === "function") {
                    await loadPrices();
                }

                const state = getState();

                if (
                    state?.tab === "PENDING" &&
                    typeof window.showPendingOrders === "function"
                ) {
                    await window.showPendingOrders();
                } else if (
                    typeof loadTrades === "function" &&
                    state?.account
                ) {
                    await loadTrades();
                }

                if (typeof loadAccount === "function") {
                    await loadAccount();
                }
            } catch (error) {
                console.warn(
                    "FundFXT terminal refresh:",
                    error.message
                );
            }
        }, 1000);
    }

    function install() {
        const orderType = document.getElementById("orderType");

        if (orderType) {
            orderType.addEventListener(
                "change",
                syncPendingFields
            );
        }

        syncPendingFields();
        wireRightTabs();
        wireTradeTabs();
        wireMobileNavigation();
        startLiveRefresh();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, {
            once: true,
        });
    } else {
        install();
    }
})();
