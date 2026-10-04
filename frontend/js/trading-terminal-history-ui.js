/* ============================================================
   FUNDFXT TRADE HISTORY UI ENHANCEMENT
   Visual-only layer. Core trade execution remains untouched.
   ============================================================ */

(function () {
    "use strict";

    function getTradeScroll() {
        return document.getElementById("tradeScroll");
    }

    function classifyProfitLoss() {
        const box = getTradeScroll();

        if (!box) {
            return;
        }

        box.querySelectorAll(".trade-card").forEach((card) => {
            const pl = card.querySelector(".pl");

            if (!pl) {
                card.classList.remove(
                    "pl-positive",
                    "pl-negative",
                );

                return;
            }

            const text = pl.textContent.trim();
            const negative = text.includes("-");
            const numeric = Number(
                text.replace(/[^0-9.-]/g, ""),
            );

            card.classList.remove(
                "pl-positive",
                "pl-negative",
            );

            if (negative || (Number.isFinite(numeric) && numeric < 0)) {
                card.classList.add("pl-negative");
            } else if (
                Number.isFinite(numeric)
                && numeric > 0
            ) {
                card.classList.add("pl-positive");
            }
        });
    }

    function enhanceDetailsModal() {
        const modal = document.querySelector(
            ".trade-modal",
        );

        if (!modal) {
            return;
        }

        const detailItems = modal.querySelectorAll(
            ".detail",
        );

        detailItems.forEach((detail) => {
            const label = detail
                .querySelector("span")
                ?.textContent
                ?.trim()
                ?.toLowerCase();

            if (
                label !== "calculated p/l"
                && label !== "profit / loss"
            ) {
                return;
            }

            const value = detail
                .querySelector("b")
                ?.textContent
                ?.trim();

            if (!value) {
                return;
            }

            const negative = value.includes("-");

            const numeric = Number(
                value.replace(/[^0-9.-]/g, ""),
            );

            detail.classList.remove(
                "pl-positive",
                "pl-negative",
            );

            if (
                negative
                || (
                    Number.isFinite(numeric)
                    && numeric < 0
                )
            ) {
                detail.classList.add("pl-negative");
            } else if (
                Number.isFinite(numeric)
                && numeric > 0
            ) {
                detail.classList.add("pl-positive");
            }
        });
    }

    function decorate() {
        classifyProfitLoss();
        enhanceDetailsModal();
    }

    function wrapTradeDetails() {
        if (
            typeof window.showDetails !== "function"
            || window.__fundFXTHistoryDetailsWrapped
        ) {
            return;
        }

        const originalShowDetails =
            window.showDetails;

        window.showDetails = function (id) {
            originalShowDetails(id);

            window.requestAnimationFrame(() => {
                enhanceDetailsModal();
            });

            window.setTimeout(
                enhanceDetailsModal,
                0,
            );
        };

        window.__fundFXTHistoryDetailsWrapped = true;
    }

    function install() {
        wrapTradeDetails();
        decorate();

        const observer = new MutationObserver(
            () => {
                wrapTradeDetails();
                decorate();
            },
        );

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true,
            },
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            install,
            {
                once: true,
            },
        );
    } else {
        install();
    }
})();
