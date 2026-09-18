/* ===== OPEN TRADE MODIFY CONTROLLER ===== */
(function () {
    "use strict";
    const API = "https://fundfxt.onrender.com";
    const token = () => localStorage.getItem("fundfxt_token") || "";
    const $ = (id) => document.getElementById(id);
    async function api(path, opt = {
    }    ) {
        const response = await fetch(API + path, {
            ...opt,
            headers: {
                Authorization: "Bearer " + token(),
                "Content-Type": "application/json",
                ...(opt.headers || {
                }                ),
            }            ,
        }        );
        let data = {
        }        ;
        try {
            data = await response.json();
        }
        catch {
        }
        if (!response.ok) {
            throw Error(
            data.error ||
            data.message ||
            `Request failed (${response.status})`
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
        element.className = "trade-feedback show " + (ok ? "ok" : "error");
        clearTimeout(notify.timer);
        notify.timer = setTimeout(() => {
            element.className = "trade-feedback";
        }        , 4000);
    }
    function injectStyle() {
        if ($("modifyTradeStyle")) {
            return;
        }
        const style = document.createElement("style");
        style.id = "modifyTradeStyle";
        style.textContent = `
            .modify-btn {
                color: #00c77a !important;
            }

            .modify-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }

            .modify-field span {
                display: block;
                color: #7f8d9a;
                font-size: 8px;
                margin-bottom: 4px;
            }

            .modify-field input {
                width: 100%;
                height: 38px;
                padding: 0 9px;
                border: 1px solid #263541;
                border-radius: 8px;
                background: #080c11;
                color: #fff;
                font-size: 11px;
                outline: 0;
            }

            .modify-hint {
                grid-column: 1 / -1;
                color: #7f8d9a;
                font-size: 8px;
                line-height: 1.5;
            }

            .modify-save {
                width: 100%;
                height: 40px;
                border: 1px solid #00c77a55;
                border-radius: 8px;
                background: #111a22;
                color: #00c77a;
                font-size: 10px;
                font-weight: 800;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }
    async function openModify(id) {
        try {
            const account = localStorage.getItem("fundfxt_selected_account");
            if (!account) {
                notify("No trading account selected.");
                return;
            }
            const data = await api(
            "/api/trade/get?account_code=" + encodeURIComponent(account)
            );
            const trade = (Array.isArray(data.trades) ? data.trades : [])
            .find((item) => String(item.trade_id) === String(id));
            if (!trade || trade.status !== "OPEN") {
                notify("Open trade not found.");
                return;
            }
            const side = String(trade.side).toUpperCase();
            const modalElement = document.createElement("div");
            modalElement.className = "trade-modal";
            modalElement.innerHTML = `
                <div class="trade-modal-backdrop"></div>
                <div class="trade-modal-card">
                    <div class="trade-modal-head">
                        <h3>Modify Trade</h3>
                        <button class="trade-modal-close" type="button">×</button>
                    </div>

                    <div class="detail">
                        <span>Trade</span>
                        <b>
                            ${trade.symbol}
                            · ${side}
                            · ${Number(trade.volume).toFixed(2)} lot
                        </b>
                    </div>

                    <div class="modify-grid">
                        <label class="modify-field">
                            <span>Take Profit</span>
                            <input
                                id="modifyTP"
                                type="number"
                                step="any"
                                value="${trade.take_profit ?? ""}"
                                placeholder="Optional"
                            >
                        </label>

                        <label class="modify-field">
                            <span>Stop Loss</span>
                            <input
                                id="modifySL"
                                type="number"
                                step="any"
                                value="${trade.stop_loss ?? ""}"
                                placeholder="Optional"
                            >
                        </label>

                        <div class="modify-hint">
                            ${side} position · Leave a field empty to remove that TP/SL.
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button
                            class="modify-save"
                            id="saveModify"
                            type="button"
                        >
                            Save Changes
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modalElement);
            modalElement.querySelector(".trade-modal-close").onclick = () => {
                modalElement.remove();
            }            ;
            modalElement.querySelector(".trade-modal-backdrop").onclick = () => {
                modalElement.remove();
            }            ;
            $("saveModify").onclick = async () => {
                const tpValue = $("modifyTP").value.trim();
                const slValue = $("modifySL").value.trim();
                const tp = tpValue === "" ? null : Number(tpValue);
                const sl = slValue === "" ? null : Number(slValue);
                const entry = Number(trade.entry_price);
                if (
                (tp !== null && !Number.isFinite(tp)) ||
                (sl !== null && !Number.isFinite(sl))
                ) {
                    notify("Enter valid TP/SL prices.");
                    return;
                }
                if (
                sl !== null &&
                (side === "BUY" ? sl >= entry : sl <= entry)
                ) {
                    notify("Invalid Stop Loss for this direction.");
                    return;
                }
                if (
                tp !== null &&
                (side === "BUY" ? tp <= entry : tp >= entry)
                ) {
                    notify("Invalid Take Profit for this direction.");
                    return;
                }
                try {
                    await api(
                    "/api/trades/" + encodeURIComponent(id),
                    {
                        method: "PATCH",
                        body: JSON.stringify( {
                            stop_loss: sl,
                            take_profit: tp,
                        }                        ),
                    }
                    );
                    modalElement.remove();
                    notify("Trade modified successfully.", true);
                    if (typeof window.loadTrades === "function") {
                        await window.loadTrades();
                    }
                    else {
                        location.reload();
                    }
                }
                catch (error) {
                    notify(error.message);
                }
            }            ;
        }
        catch (error) {
            notify(error.message);
        }
    }
    function decorate() {
        const box = $("tradeScroll");
        if (!box) {
            return;
        }
        box.querySelectorAll("[data-close]").forEach((button) => {
            const card = button.closest(".trade-card");
            if (!card || card.querySelector("[data-modify]")) {
                return;
            }
            const id = button.dataset.close;
            const modifyButton = document.createElement("button");
            modifyButton.className = "mini modify-btn";
            modifyButton.type = "button";
            modifyButton.dataset.modify = id;
            modifyButton.textContent = "Modify";
            modifyButton.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                openModify(id);
            }            ;
            button.parentNode.insertBefore(modifyButton, button);
        }        );
    }
    function install() {
        injectStyle();
        decorate();
        setInterval(decorate, 300);
        const target = $("tradeScroll") || document.body;
        new MutationObserver(decorate).observe(target, {
            childList: true,
            subtree: true,
        }        );
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, {
            once: true,
        }        );
    }
    else {
        install();
    }
})();
