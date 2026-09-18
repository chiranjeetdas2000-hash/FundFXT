/*
 * FundFXT Trading Terminal
 * Account-scoped favorite pairs and Market Watch rendering.
 */
(function () {
    "use strict";

    const API = "https://fundfxt.onrender.com";

    function finite(value) {
        return Number.isFinite(Number(value));
    }

    function formatPrice(value, symbol) {
        if (!finite(value)) {
            return "—";
        }

        const decimals = /JPY$/i.test(symbol)
            ? 3
            : /XAU|XAG|BTC|ETH/i.test(symbol)
                ? 2
                : 5;

        return Number(value).toFixed(decimals);
    }

    function formatSpread(value, symbol) {
        return formatPrice(value, symbol);
    }

    function token() {
        return localStorage.getItem("fundfxt_token") || "";
    }

    function state() {
        try {
            return typeof T !== "undefined" ? T : null;
        } catch {
            return null;
        }
    }

    function accountCode() {
        const terminal = state();

        return terminal?.account?.account_code
            || localStorage.getItem("fundfxt_selected_account")
            || "";
    }

    async function api(path, options = {}) {
        const response = await fetch(API + path, {
            ...options,
            headers: {
                Authorization: "Bearer " + token(),
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error
                || data.message
                || `Request failed (${response.status})`,
            );
        }

        return data;
    }

    function getQuote(symbol) {
        const terminal = state();
        const price = terminal?.prices?.[symbol] || {};
        const bid = finite(price.bid)
            ? Number(price.bid)
            : NaN;
        const ask = finite(price.ask)
            ? Number(price.ask)
            : NaN;
        const spread = finite(price.spread)
            ? Number(price.spread)
            : finite(ask) && finite(bid)
                ? Math.abs(ask - bid)
                : NaN;
        const change = finite(price.changePercent)
            ? Number(price.changePercent)
            : NaN;

        return {
            bid,
            ask,
            spread,
            change,
        };
    }

    window.renderPairs = function renderPairs() {
        const terminal = state();
        const box = document.getElementById("watchlist");

        if (!terminal || !box) {
            return;
        }

        const search = document.getElementById("search");
        const query = (search?.value || "")
            .trim()
            .toUpperCase();
        const favorites = Array.isArray(terminal.favorites)
            ? terminal.favorites
            : [];
        const symbols = favorites.filter((symbol) =>
            String(symbol).toUpperCase().includes(query),
        );

        box.innerHTML = symbols
            .map((symbol) => {
                const quote = getQuote(symbol);
                const change = finite(quote.change)
                    ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}%`
                    : "—";

                return `
                    <button
                        class="quote ${symbol === terminal.selected ? "selected" : ""}"
                        data-symbol="${symbol}"
                        type="button"
                        aria-label="${symbol} market quote"
                    >
                        <span class="quote-pair">
                            ${symbol}
                        </span>
                        <span class="quote-value quote-spread-value">
                            ${formatSpread(quote.spread, symbol)}
                        </span>
                        <span class="quote-value quote-ask-value">
                            ${formatPrice(quote.ask, symbol)}
                        </span>
                        <span class="quote-value quote-bid-value">
                            ${formatPrice(quote.bid, symbol)}
                        </span>
                        <span class="quote-change">
                            ${change}
                        </span>
                    </button>
                `;
            })
            .join("")
            || `
                <div class="favorite-empty">
                    No favorite pairs match your search.
                </div>
            `;

        box.querySelectorAll(".quote").forEach((button) => {
            button.onclick = () => {
                terminal.selected = button.dataset.symbol;

                const selected = document.getElementById("selectedSymbol");
                const executionSymbol = document.getElementById("executionSymbol");

                if (selected) {
                    selected.textContent = terminal.selected;
                }

                if (executionSymbol) {
                    executionSymbol.textContent = terminal.selected;
                }

                renderPairs();

                if (typeof loadChart === "function") {
                    loadChart();
                }

                const isMobile =
                    window.innerWidth <= 768;

                if (isMobile) {
                    const chartTab =
                        document.querySelector(
                            '[data-mobile-section="chart"]',
                        );

                    if (chartTab) {
                        chartTab.click();
                    }
                } else if (typeof openPanel === "function") {
                    openPanel("center");
                }
            };
        });

        const live = Object.values(terminal.prices || {}).some(
            (price) => finite(price?.bid) && finite(price?.ask),
        );
        const market = document.getElementById("market");

        if (market) {
            market.textContent = live
                ? "● LIVE"
                : "● OFFLINE";
            market.style.color = live
                ? "var(--green)"
                : "var(--red)";
        }
    };

    async function loadServerFavorites() {
        const terminal = state();
        const code = accountCode();

        if (!terminal || !code) {
            return false;
        }

        try {
            const data = await api(
                "/api/trading/favorites?account_code="
                + encodeURIComponent(code),
            );
            const favorites = Array.isArray(data.favorites)
                ? data.favorites
                : [];

            if (favorites.length) {
                terminal.favorites = favorites;
            }

            if (typeof saveFavorites === "function") {
                saveFavorites();
            }

            renderPairs();
            return true;
        } catch (error) {
            console.warn("Favorite pair load failed:", error.message);
            renderPairs();
            return false;
        }
    }

    async function saveServerFavorites() {
        const terminal = state();
        const code = accountCode();

        if (!terminal || !code) {
            throw new Error("No trading account selected.");
        }

        await api("/api/trading/favorites", {
            method: "PUT",
            body: JSON.stringify({
                account_code: code,
                favorites: terminal.favorites,
            }),
        });
    }

    window.addPair = function addPair() {
        const terminal = state();

        if (!terminal || typeof modal !== "function") {
            return;
        }

        const body = `
            <div class="pair-add-toolbar">
                <input
                    id="favoritePairSearch"
                    class="search"
                    placeholder="Search pairs…"
                    autocomplete="off"
                >
            </div>
            <div
                id="favoritePairList"
                class="pair-add-list"
            ></div>
        `;

        modal("Favorite Pairs", body, "");

        const list = document.getElementById("favoritePairList");
        const search = document.getElementById("favoritePairSearch");

        const draw = () => {
            const query = (search?.value || "")
                .trim()
                .toUpperCase();
            const symbols = (typeof SYMBOLS !== "undefined"
                ? SYMBOLS
                : []
            ).filter((symbol) => symbol.includes(query));

            list.innerHTML = symbols
                .map((symbol) => {
                    const favorite = terminal.favorites.includes(symbol);

                    return `
                        <div class="pair-add-item">
                            <div>
                                <b>
                                    ${symbol}
                                </b>
                                <small>
                                    ${favorite ? "Favorite" : "Available"}
                                </small>
                            </div>
                            <button
                                data-fav="${symbol}"
                                type="button"
                            >
                                ${favorite ? "Remove" : "Add"}
                            </button>
                        </div>
                    `;
                })
                .join("")
                || `
                    <div class="favorite-empty">
                        No pairs found.
                    </div>
                `;

            list.querySelectorAll("[data-fav]").forEach((button) => {
                button.onclick = async () => {
                    const symbol = button.dataset.fav;
                    const previous = [...terminal.favorites];

                    if (terminal.favorites.includes(symbol)) {
                        if (terminal.favorites.length === 1) {
                            if (typeof feedback === "function") {
                                feedback("Keep at least one favorite pair.");
                            }

                            return;
                        }

                        terminal.favorites = terminal.favorites.filter(
                            (item) => item !== symbol,
                        );
                    } else {
                        terminal.favorites.push(symbol);
                    }

                    try {
                        await saveServerFavorites();

                        if (typeof saveFavorites === "function") {
                            saveFavorites();
                        }

                        renderPairs();
                        draw();
                    } catch (error) {
                        terminal.favorites = previous;
                        renderPairs();

                        if (typeof feedback === "function") {
                            feedback(
                                "Favorite pair could not be saved: "
                                + error.message,
                            );
                        }
                    }
                };
            });
        };

        draw();
        search?.addEventListener("input", draw);
    };

    function waitForAccount() {
        let attempts = 0;

        const timer = setInterval(async () => {
            attempts += 1;

            if (accountCode()) {
                clearInterval(timer);
                await loadServerFavorites();
                return;
            }

            if (attempts >= 200) {
                clearInterval(timer);
                renderPairs();
            }
        }, 100);
    }

    function install() {
        const search = document.getElementById("search");
        const add = document.getElementById("addPairBtn");

        if (search) {
            search.oninput = renderPairs;
        }

        if (add) {
            add.onclick = window.addPair;
        }

        renderPairs();
        waitForAccount();
    }

    const wait = setInterval(() => {
        if (
            document.readyState !== "loading"
            && typeof T !== "undefined"
            && document.getElementById("watchlist")
        ) {
            clearInterval(wait);
            install();
        }
    }, 50);
})();
