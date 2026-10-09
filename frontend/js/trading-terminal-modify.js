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
    var FX_INSTRUMENTS = {
        EURUSD: { pip: 0.0001, size: 100000 },
        GBPUSD: { pip: 0.0001, size: 100000 },
        USDCHF: { pip: 0.0001, size: 100000 },
        AUDUSD: { pip: 0.0001, size: 100000 },
        USDCAD: { pip: 0.0001, size: 100000 },
        NZDUSD: { pip: 0.0001, size: 100000 },
        EURGBP: { pip: 0.0001, size: 100000 },
        EURJPY: { pip: 0.01, size: 100000 },
        EURAUD: { pip: 0.0001, size: 100000 },
        EURCHF: { pip: 0.0001, size: 100000 },
        EURNZD: { pip: 0.0001, size: 100000 },
        GBPJPY: { pip: 0.01, size: 100000 },
        GBPCHF: { pip: 0.0001, size: 100000 },
        GBPAUD: { pip: 0.0001, size: 100000 },
        GBPNZD: { pip: 0.0001, size: 100000 },
        AUDJPY: { pip: 0.01, size: 100000 },
        AUDNZD: { pip: 0.0001, size: 100000 },
        AUDCAD: { pip: 0.0001, size: 100000 },
        AUDCHF: { pip: 0.0001, size: 100000 },
        CADJPY: { pip: 0.01, size: 100000 },
        CADCHF: { pip: 0.0001, size: 100000 },
        CHFJPY: { pip: 0.01, size: 100000 },
        NZDJPY: { pip: 0.01, size: 100000 },
        NZDCHF: { pip: 0.0001, size: 100000 },
        NZDCAD: { pip: 0.0001, size: 100000 },
        USDJPY: { pip: 0.01, size: 100000 },
        XAUUSD: { pip: 0.01, size: 100 },
        XAGUSD: { pip: 0.001, size: 5000 }
    };

    function updateModifyPreview(trade, side) {
        var wrap = document.getElementById('modifyPnlPreview');
        var lossEl = document.getElementById('modifyPreviewLoss');
        var profitEl = document.getElementById('modifyPreviewProfit');
        var rrEl = document.getElementById('modifyPreviewRR');
        if (!wrap || !lossEl || !profitEl || !rrEl) return;
        var symbol = String(trade.symbol || '').toUpperCase();
        var inst = FX_INSTRUMENTS[symbol];
        if (!inst) { wrap.hidden = true; return; }
        var entry = Number(trade.entry_price);
        var volume = Number(trade.volume);
        if (!Number.isFinite(entry) || !Number.isFinite(volume) || volume <= 0) {
            wrap.hidden = true; return;
        }
        var tpEl = document.getElementById('modifyTP');
        var slEl = document.getElementById('modifySL');
        var tpVal = tpEl ? String(tpEl.value || '').trim() : '';
        var slVal = slEl ? String(slEl.value || '').trim() : '';
        var tp = tpVal === '' ? null : Number(tpVal);
        var sl = slVal === '' ? null : Number(slVal);
        var lossPips = 0;
        var profitPips = 0;
        var slIsProfit = false;
        var isBuy = String(side || '').toUpperCase() === 'BUY';
        if (sl !== null && Number.isFinite(sl)) {
            lossPips = Math.abs(entry - sl) / inst.pip;
            slIsProfit = isBuy ? (sl > entry) : (sl < entry);
        }
        if (tp !== null && Number.isFinite(tp)) profitPips = Math.abs(tp - entry) / inst.pip;
        var lossAmt = lossPips * inst.pip * inst.size * volume;
        var profitAmt = profitPips * inst.pip * inst.size * volume;
        var lossStr = lossAmt > 0 ? ((slIsProfit ? '+' : '-') + '
        var rrStr = '—';
        if (lossPips > 0 && profitPips > 0 && !slIsProfit) {
            rrStr = '1 : ' + (profitPips / lossPips).toFixed(2);
        }
        if (lossPips <= 0 && profitPips <= 0) { wrap.hidden = true; return; }
        wrap.hidden = false;
        lossEl.textContent = lossStr;
        lossEl.className = 'pnl-value ' + (slIsProfit ? 'green' : 'red');
        profitEl.textContent = profitStr;
        rrEl.textContent = rrStr;
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

                        <div class="pnl-preview" id="modifyPnlPreview" hidden>
                            <div class="pnl-row">
                                <span class="pnl-label">Loss at SL</span>
                                <span class="pnl-value red" id="modifyPreviewLoss">—</span>
                            </div>
                            <div class="pnl-row">
                                <span class="pnl-label">Profit at TP</span>
                                <span class="pnl-value green" id="modifyPreviewProfit">—</span>
                            </div>
                            <div class="pnl-row">
                                <span class="pnl-label">Risk : Reward</span>
                                <span class="pnl-value" id="modifyPreviewRR">—</span>
                            </div>
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

            var tpInputEl = document.getElementById('modifyTP');
            var slInputEl = document.getElementById('modifySL');
            if (tpInputEl) {
                tpInputEl.addEventListener('input', function () {
                    updateModifyPreview(trade, side);
                });
            }
            if (slInputEl) {
                slInputEl.addEventListener('input', function () {
                    updateModifyPreview(trade, side);
                });
            }
            updateModifyPreview(trade, side);

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
                setButtonLoading(
                    $("saveModify"),
                    true,
                    "Saving...",
                );

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
                        // Force the open-position view to refresh after SL/TP changes.
                        if (typeof window.loadOpenPositions === "function") {
                            await window.loadOpenPositions();
                        }
                    }
                    else {
                        location.reload();
                    }
                }
                catch (error) {
                    // Surface modification failures in the browser console for debugging.
                    console.error("[Modify SL/TP]", error);
                    if (
                        error.message.includes("429") ||
                        error.message.includes("Too many")
                    ) {
                        notify("Too many modifications. Please wait a minute and try again.");
                    }
                    else {
                        notify(error.message);
                    }
                }
                finally {
                    setButtonLoading(
                        $("saveModify"),
                        false,
                    );
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
 + lossAmt.toFixed(2)) : '—';
        var profitStr = profitAmt > 0 ? ('+
        var rrStr = '—';
        if (lossPips > 0 && profitPips > 0) {
            rrStr = '1 : ' + (profitPips / lossPips).toFixed(2);
        }
        if (lossPips <= 0 && profitPips <= 0) { wrap.hidden = true; return; }
        wrap.hidden = false;
        lossEl.textContent = lossStr;
        profitEl.textContent = profitStr;
        rrEl.textContent = rrStr;
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

                        <div class="pnl-preview" id="modifyPnlPreview" hidden>
                            <div class="pnl-row">
                                <span class="pnl-label">Loss at SL</span>
                                <span class="pnl-value red" id="modifyPreviewLoss">—</span>
                            </div>
                            <div class="pnl-row">
                                <span class="pnl-label">Profit at TP</span>
                                <span class="pnl-value green" id="modifyPreviewProfit">—</span>
                            </div>
                            <div class="pnl-row">
                                <span class="pnl-label">Risk : Reward</span>
                                <span class="pnl-value" id="modifyPreviewRR">—</span>
                            </div>
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

            var tpInputEl = document.getElementById('modifyTP');
            var slInputEl = document.getElementById('modifySL');
            if (tpInputEl) {
                tpInputEl.addEventListener('input', function () {
                    updateModifyPreview(trade, side);
                });
            }
            if (slInputEl) {
                slInputEl.addEventListener('input', function () {
                    updateModifyPreview(trade, side);
                });
            }
            updateModifyPreview(trade, side);

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
                setButtonLoading(
                    $("saveModify"),
                    true,
                    "Saving...",
                );

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
                        // Force the open-position view to refresh after SL/TP changes.
                        if (typeof window.loadOpenPositions === "function") {
                            await window.loadOpenPositions();
                        }
                    }
                    else {
                        location.reload();
                    }
                }
                catch (error) {
                    // Surface modification failures in the browser console for debugging.
                    console.error("[Modify SL/TP]", error);
                    if (
                        error.message.includes("429") ||
                        error.message.includes("Too many")
                    ) {
                        notify("Too many modifications. Please wait a minute and try again.");
                    }
                    else {
                        notify(error.message);
                    }
                }
                finally {
                    setButtonLoading(
                        $("saveModify"),
                        false,
                    );
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
 + profitAmt.toFixed(2)) : '—';
        var rrStr = '—';
        if (lossPips > 0 && profitPips > 0) {
            rrStr = '1 : ' + (profitPips / lossPips).toFixed(2);
        }
        if (lossPips <= 0 && profitPips <= 0) { wrap.hidden = true; return; }
        wrap.hidden = false;
        lossEl.textContent = lossStr;
        profitEl.textContent = profitStr;
        rrEl.textContent = rrStr;
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

                        <div class="pnl-preview" id="modifyPnlPreview" hidden>
                            <div class="pnl-row">
                                <span class="pnl-label">Loss at SL</span>
                                <span class="pnl-value red" id="modifyPreviewLoss">—</span>
                            </div>
                            <div class="pnl-row">
                                <span class="pnl-label">Profit at TP</span>
                                <span class="pnl-value green" id="modifyPreviewProfit">—</span>
                            </div>
                            <div class="pnl-row">
                                <span class="pnl-label">Risk : Reward</span>
                                <span class="pnl-value" id="modifyPreviewRR">—</span>
                            </div>
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

            var tpInputEl = document.getElementById('modifyTP');
            var slInputEl = document.getElementById('modifySL');
            if (tpInputEl) {
                tpInputEl.addEventListener('input', function () {
                    updateModifyPreview(trade, side);
                });
            }
            if (slInputEl) {
                slInputEl.addEventListener('input', function () {
                    updateModifyPreview(trade, side);
                });
            }
            updateModifyPreview(trade, side);

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
                setButtonLoading(
                    $("saveModify"),
                    true,
                    "Saving...",
                );

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
                        // Force the open-position view to refresh after SL/TP changes.
                        if (typeof window.loadOpenPositions === "function") {
                            await window.loadOpenPositions();
                        }
                    }
                    else {
                        location.reload();
                    }
                }
                catch (error) {
                    // Surface modification failures in the browser console for debugging.
                    console.error("[Modify SL/TP]", error);
                    if (
                        error.message.includes("429") ||
                        error.message.includes("Too many")
                    ) {
                        notify("Too many modifications. Please wait a minute and try again.");
                    }
                    else {
                        notify(error.message);
                    }
                }
                finally {
                    setButtonLoading(
                        $("saveModify"),
                        false,
                    );
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
