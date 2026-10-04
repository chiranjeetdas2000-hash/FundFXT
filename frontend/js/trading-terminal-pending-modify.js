/* ============================================================
   FUNDFXT PENDING ORDER MODIFY CONTROLLER
   Pending orders are editable until execution.
   ============================================================ */

(function () {
    "use strict";

    const API = "https://fundfxt.onrender.com";

    const token = () => {
        return localStorage.getItem("fundfxt_token") || "";
    };

    const $ = (id) => {
        return document.getElementById(id);
    };

    async function api(path, options = {}) {
        const response = await fetch(
            API + path,
            {
                ...options,
                headers: {
                    Authorization: "Bearer " + token(),
                    "Content-Type": "application/json",
                    ...(options.headers || {}),
                },
            },
        );

        const data = await response
            .json()
            .catch(() => ({}));

        if (!response.ok) {
            throw Error(
                data.error
                || data.message
                || "Request failed",
            );
        }

        return data;
    }

    function notify(message, ok = false) {
        const element = $("tradeFeedback");

        if (!element) {
            return;
        }

        element.textContent = message;
        element.className =
            "trade-feedback show "
            + (ok ? "ok" : "error");

        clearTimeout(notify.timer);

        notify.timer = setTimeout(
            () => {
                element.className = "trade-feedback";
            },
            4000,
        );
    }

    function state() {
        try {
            return typeof T !== "undefined"
                ? T
                : null;
        } catch {
            return null;
        }
    }

    function accountCode() {
        return (
            state()?.account?.account_code
            || localStorage.getItem("fundfxt_selected_account")
            || ""
        );
    }

    function orderTypeOptions(side, selected) {
        const types =
            side === "BUY"
                ? [
                    "BUY_LIMIT",
                    "BUY_STOP",
                ]
                : [
                    "SELL_LIMIT",
                    "SELL_STOP",
                ];

        return types
            .map(
                (type) => {
                    const label =
                        type.replace(
                            "_",
                            " ",
                        );

                    const selectedAttribute =
                        type === selected
                            ? " selected"
                            : "";

                    return (
                        '<option value="' +
                        type +
                        '"' +
                        selectedAttribute +
                        ">" +
                        label +
                        "</option>"
                    );
                },
            )
            .join("");
    }

    async function getPendingTrade(id) {
        const data = await api(
            "/api/trades/pending?account_code="
            + encodeURIComponent(accountCode()),
        );

        return (
            Array.isArray(data.trades)
                ? data.trades
                : []
        ).find(
            (trade) => String(trade.trade_id) === String(id),
        );
    }

    function openModify(id) {
        getPendingTrade(id)
            .then((trade) => {
                if (!trade) {
                    notify("Pending order not found.");
                    return;
                }

                const side = String(
                    trade.side || "BUY",
                ).toUpperCase();

                const modal = document.createElement("div");

                modal.className = "trade-modal";

                modal.innerHTML = `
                    <div class="trade-modal-backdrop"></div>

                    <div class="trade-modal-card">
                        <div class="trade-modal-head">
                            <h3>
                                Modify Pending Order
                            </h3>

                            <button
                                class="trade-modal-close"
                                type="button"
                            >
                                ×
                            </button>
                        </div>

                        <div class="detail">
                            <span>
                                Order
                            </span>

                            <b>
                                ${trade.symbol}
                                ·
                                ${side}
                                ·
                                ${Number(
                                    trade.volume,
                                ).toFixed(2)}
                                lot
                            </b>
                        </div>

                        <div class="modify-grid">
                            <div class="pending-edit-fields">
                                <div class="pending-edit-direction">
                                    <label class="modify-field">
                                        <span>
                                            Direction
                                        </span>

                                        <select
                                            id="pendingModifySide"
                                        >
                                            <option
                                                value="BUY"
                                                ${side === "BUY" ? "selected" : ""}
                                            >
                                                BUY
                                            </option>

                                            <option
                                                value="SELL"
                                                ${side === "SELL" ? "selected" : ""}
                                            >
                                                SELL
                                            </option>
                                        </select>
                                    </label>

                                    <label class="modify-field">
                                        <span>
                                            Order Type
                                        </span>

                                        <select
                                            id="pendingModifyType"
                                        >
                                            ${orderTypeOptions(
                                                side,
                                                trade.order_type,
                                            )}
                                        </select>
                                    </label>
                                </div>
                            </div>

                            <label class="modify-field">
                                <span>
                                    Entry Price
                                </span>

                                <input
                                    id="pendingModifyEntry"
                                    type="number"
                                    step="any"
                                    value="${trade.entry_price ?? ""}"
                                >
                            </label>

                            <label class="modify-field">
                                <span>
                                    Volume
                                </span>

                                <input
                                    id="pendingModifyVolume"
                                    type="number"
                                    min="0.01"
                                    max="2"
                                    step="0.01"
                                    value="${trade.volume ?? ""}"
                                >
                            </label>

                            <label class="modify-field">
                                <span>
                                    Stop Loss
                                </span>

                                <input
                                    id="pendingModifySL"
                                    type="number"
                                    step="any"
                                    value="${trade.stop_loss ?? ""}"
                                    placeholder="Optional"
                                >
                            </label>

                            <label class="modify-field">
                                <span>
                                    Take Profit
                                </span>

                                <input
                                    id="pendingModifyTP"
                                    type="number"
                                    step="any"
                                    value="${trade.take_profit ?? ""}"
                                    placeholder="Optional"
                                >
                            </label>

                            <div class="modify-hint">
                                Pending orders can change direction,
                                order type, entry, volume, SL and TP
                                until execution. After execution,
                                only TP/SL remain editable.
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button
                                class="modify-save"
                                id="savePendingModify"
                                type="button"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                `;

                document.body.appendChild(modal);

                const close = () => {
                    modal.remove();
                };

                modal
                    .querySelector(".trade-modal-close")
                    .onclick = close;

                modal
                    .querySelector(".trade-modal-backdrop")
                    .onclick = close;

                const sideInput = $(
                    "pendingModifySide",
                );

                const typeInput = $(
                    "pendingModifyType",
                );

                sideInput.onchange = () => {
                    typeInput.innerHTML =
                        orderTypeOptions(
                            sideInput.value,
                            "",
                        );
                };

                $("savePendingModify").onclick =
                    async () => {
                        const nextSide =
                            sideInput.value;

                        const nextType =
                            typeInput.value;

                        const entry = Number(
                            $("pendingModifyEntry").value,
                        );

                        const volume = Number(
                            $("pendingModifyVolume").value,
                        );

                        const slValue =
                            $("pendingModifySL").value.trim();

                        const tpValue =
                            $("pendingModifyTP").value.trim();

                        const sl =
                            slValue === ""
                                ? null
                                : Number(slValue);

                        const tp =
                            tpValue === ""
                                ? null
                                : Number(tpValue);

                        if (
                            !Number.isFinite(entry)
                            || entry <= 0
                        ) {
                            notify(
                                "Enter a valid entry price.",
                            );
                            return;
                        }

                        if (
                            !Number.isFinite(volume)
                            || volume < 0.01
                            || volume > 2
                        ) {
                            notify(
                                "Lot size must be 0.01 to 2.00.",
                            );
                            return;
                        }

                        if (
                            (sl !== null && !Number.isFinite(sl))
                            || (tp !== null && !Number.isFinite(tp))
                        ) {
                            notify(
                                "Enter valid TP/SL prices.",
                            );
                            return;
                        }

                        try {
                            await api(
                                "/api/trades/"
                                + encodeURIComponent(id),
                                {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                        side: nextSide,
                                        order_type: nextType,
                                        entry_price: entry,
                                        volume,
                                        stop_loss: sl,
                                        take_profit: tp,
                                    }),
                                },
                            );

                            close();

                            notify(
                                "Pending order modified successfully.",
                                true,
                            );

                            if (
                                state()?.tab === "PENDING"
                                && typeof window.showPendingOrders === "function"
                            ) {
                                await window.showPendingOrders();
                            }
                        } catch (error) {
                            notify(error.message);
                        }
                    };
            })
            .catch((error) => {
                notify(error.message);
            });
    }

    function decorate() {
        const box = $("tradeScroll");

        if (!box) {
            return;
        }

        box
            .querySelectorAll("[data-pcancel]")
            .forEach((cancelButton) => {
                const card = cancelButton.closest(
                    ".trade-card",
                );

                if (!card) {
                    return;
                }

                if (card.querySelector("[data-pmodify]")) {
                    return;
                }

                const id =
                    cancelButton.dataset.pcancel;

                const modifyButton =
                    document.createElement("button");

                modifyButton.className =
                    "mini modify-btn";

                modifyButton.type = "button";

                modifyButton.dataset.pmodify = id;

                modifyButton.textContent = "Modify";

                modifyButton.onclick = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openModify(id);
                };

                cancelButton.parentNode.insertBefore(
                    modifyButton,
                    cancelButton,
                );
            });
    }

    function install() {
        decorate();

        const observer =
            new MutationObserver(
                decorate,
            );

        observer.observe(
            $("tradeScroll") || document.body,
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
