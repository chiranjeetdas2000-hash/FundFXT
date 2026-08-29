
require('dotenv').config(); // <-- Sabse pehle ye line
const express = require('express');
...

const ALL_PAIRS = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
    'EURGBP', 'EURJPY', 'EURCHF', 'EURCAD', 'GBPJPY', 'GBPCHF', 'GBPCAD',
    'AUDJPY', 'AUDCAD', 'AUDCHF', 'CADJPY', 'CHFJPY', 'NZDJPY', 'NZDCAD', 'NZDCHF',
    'XAUUSD', 'XAGUSD'
];

const state = {
    currentSymbol: 'EURUSD',
    currentAccount: 'ACC-1001',
    orderType: 'market',
    favorites: [],
    livePrices: {},
    chartProvider: 'OANDA'
};

// ===================== TRADINGVIEW WIDGET =====================
function getTradingViewSymbol(symbol) {
    let prefix = '';
    if (state.chartProvider === 'OANDA') {
        prefix = 'OANDA:';
    } else if (state.chartProvider === 'FXCM') {
        prefix = 'FX:';
    }
    return `${prefix}${symbol}`;
}

function setChartProvider(provider) {
    state.chartProvider = provider;
    document.querySelectorAll('.provider-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent === provider) {
            btn.classList.add('active');
        }
    });
    initTradingView(state.currentSymbol);
}

function initTradingView(symbol) {
    const container = document.getElementById('tradingview_chart');
    container.innerHTML = '';
    new TradingView.widget({
        container_id: 'tradingview_chart',
        symbol: getTradingViewSymbol(symbol),
        interval: '5',
        timezone: 'Asia/Kolkata',
        theme: 'dark',
        style: '1',
        locale: 'en',
        toolbar_bg: '#111820',
        enable_publishing: false,
        allow_symbol_change: false,
        hide_side_toolbar: false,
        details: true,
        autosize: true
    });
}

// ===================== WEBSOCKET (MT5 Bridge) =====================
function connectWebSocket() {
    const ws = new WebSocket("ws://127.0.0.1:8765");
    ws.onopen = () => console.log("✅ Connected to MT5 Bridge");
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        state.livePrices = data;
        updateSidebarPrices();
        updateCurrentPrice();
    };
    ws.onclose = () => setTimeout(connectWebSocket, 2000);
}

// ===================== SIDEBAR =====================
function buildSidebar() {
    const list = document.getElementById('pairList');
    list.innerHTML = '';
    ALL_PAIRS.forEach(pair => {
        const li = document.createElement('li');
        li.className = 'pair-item' + (pair === state.currentSymbol ? ' active' : '');
        li.id = `pair-${pair}`;
        li.innerHTML = `
            <div class="pair-header">
                <span class="sym-name">${pair}</span>
                <span class="fav ${state.favorites.includes(pair) ? 'active' : ''}" onclick="toggleFavorite('${pair}', event)">★</span>
            </div>
            <div class="price-row">
                <div class="bid-box">
                    <div class="bid-label">BID</div>
                    <div class="bid-value" id="bid-${pair}">--</div>
                </div>
                <div class="ask-box">
                    <div class="ask-label">ASK</div>
                    <div class="ask-value" id="ask-${pair}">--</div>
                </div>
            </div>
            <div class="spread-box">
                Spread: <span class="spread-value" id="spread-${pair}">--</span> | 
                <span class="change-value" id="change-${pair}">--</span>
            </div>
        `;
        li.onclick = (e) => {
            if (e.target.classList.contains('fav')) return;
            selectPair(pair);
        };
        list.appendChild(li);
    });
}

function filterPairs() {
    const query = document.getElementById('searchPair').value.toUpperCase();
    const items = document.querySelectorAll('.pair-item');
    items.forEach(item => {
        const symbol = item.querySelector('.sym-name').textContent.toUpperCase();
        item.style.display = symbol.includes(query) ? 'block' : 'none';
    });
}

function toggleFavorite(pair, event) {
    event.stopPropagation();
    const favSpan = event.target;
    if (state.favorites.includes(pair)) {
        state.favorites = state.favorites.filter(f => f !== pair);
        favSpan.classList.remove('active');
        localStorage.setItem('fundfxt_favorites', JSON.stringify(state.favorites));
    } else {
        state.favorites.push(pair);
        favSpan.classList.add('active');
        localStorage.setItem('fundfxt_favorites', JSON.stringify(state.favorites));
    }
}

function loadFavorites() {
    const saved = localStorage.getItem('fundfxt_favorites');
    if (saved) state.favorites = JSON.parse(saved);
    else state.favorites = ['EURUSD', 'XAUUSD'];
}

function updateSidebarPrices() {
    for (const pair in state.livePrices) {
        const tick = state.livePrices[pair];
        const bidEl = document.getElementById(`bid-${pair}`);
        const askEl = document.getElementById(`ask-${pair}`);
        const spreadEl = document.getElementById(`spread-${pair}`);
        const changeEl = document.getElementById(`change-${pair}`);
        
        if (bidEl && askEl) {
            bidEl.textContent = tick.bid.toFixed(5);
            askEl.textContent = tick.ask.toFixed(5);
            
            if (spreadEl && tick.spread !== undefined) {
                spreadEl.textContent = tick.spread;
            }
            
            if (changeEl && tick.change_pct !== undefined) {
                const changeVal = tick.change_pct;
                changeEl.textContent = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(2) + '%';
                changeEl.style.color = changeVal >= 0 ? '#00ff88' : '#ff4757';
            }
        }
    }
}
function updateCurrentPrice() {
    const tick = state.livePrices[state.currentSymbol];
    if (tick) {
        const currentPriceEl = document.getElementById('currentPrice');
        if (currentPriceEl) currentPriceEl.textContent = tick.bid.toFixed(5);
    }
}

function selectPair(pair) {
    state.currentSymbol = pair;
    document.querySelectorAll('.pair-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`pair-${pair}`).classList.add('active');
    initTradingView(pair);
    updateCurrentPrice();
}

function setOrderType(btn, type) {
    state.orderType = type;
    document.querySelectorAll('.type-item').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('marketExecFields').style.display = type === 'market' ? 'block' : 'none';
    document.getElementById('pendingExecFields').style.display = type === 'pending' ? 'block' : 'none';
}

// ===================== ORDER EXECUTION (WITH UNIQUE ID + TIME) =====================
function generateTradeId() {
    const now = new Date();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TR-${now.getTime()}-${random}`;
}

function executeOrder(side) {
    const tick = state.livePrices[state.currentSymbol];
    if (!tick) { alert("Live price not available yet!"); return; }
    const lots = parseFloat(document.getElementById('mktLots').value) || 1.00;
    const entryPrice = side === 'buy' ? tick.ask : tick.bid;
    
    const token = localStorage.getItem('fundfxt_token');
    const accountCode = "ACC-XXXX";  // 👈 Yahan apna actual account code daalo

    fetch('http://localhost:3000/api/trades/execute', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            account_code: accountCode,
            symbol: state.currentSymbol,
            side: side,
            lots: lots,
            entry_price: entryPrice
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert(`✅ Trade Placed! Trade ID: ${data.trade_id}`);
        } else {
            alert(data.error || "Trade failed!");
        }
    })
    .catch(err => {
        alert("Backend se connect nahi ho paya!");
    });
}

function placePendingOrder() {
    const type = document.getElementById('pendingType').value;
    const price = parseFloat(document.getElementById('pendingPrice').value);
    const lots = parseFloat(document.getElementById('pendLots').value) || 1.00;
    if (!price || price <= 0) {
        alert("Please enter a valid pending price!");
        return;
    }
    const tradeId = generateTradeId();
    alert(`${type.toUpperCase()} Pending Order Placed!\nID: ${tradeId}\nPrice: ${price}`);
}

// ===================== LOT SIZE VALIDATION =====================
function validateLotSize(input, isBlur = false) {
    let value = input.value;
    value = value.replace(/[^0-9.]/g, '');
    const firstDot = value.indexOf('.');
    if (firstDot !== -1) {
        value = value.substring(0, firstDot + 1) + value.substring(firstDot + 1).replace(/\./g, '');
    }
    let [intPart, decPart] = value.split('.');
    if (intPart.length > 1) {
        if (intPart[0] === '2') intPart = '2';
        else intPart = intPart.slice(0, 1);
    }
    if (decPart !== undefined) {
        decPart = decPart.slice(0, 2);
        value = intPart + '.' + decPart;
    } else {
        value = intPart;
    }
    if (isBlur) {
        let num = parseFloat(value);
        if (isNaN(num) || num < 0.01) value = "0.01";
        else if (num > 2) value = "2.00";
    }
    input.value = value;
}

// ===================== ACCOUNT LOGIC =====================
function toggleAccountDropdown() {
    const menu = document.getElementById('accountMenu');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function switchAccount(accId) {
    state.currentAccount = accId;
    document.getElementById('accountId').textContent = accId;
    toggleAccountDropdown();
}

function logout() {
    window.location.href = '/login.html';
}

// ===================== BOTTOM TABLES =====================
function switchTab(btn, tab) {
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    const head = document.getElementById('tableHead');
    const body = document.getElementById('tableBody');
    if (tab === 'open') {
        head.innerHTML = `<th>ID</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Current</th><th>P/L</th>`;
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;">No open positions</td></tr>`;
    } else if (tab === 'pending') {
        head.innerHTML = `<th>ID</th><th>Symbol</th><th>Type</th><th>Price</th><th>SL</th><th>TP</th>`;
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;">No pending orders</td></tr>`;
    } else {
        head.innerHTML = `<th>ID</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>P/L</th>`;
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;">No closed trades</td></tr>`;
    }
}

// ===================== INIT =====================
window.onload = () => {
    loadFavorites();
    buildSidebar();
    
    const firstTab = document.querySelector('.tab');
    if (firstTab) switchTab(firstTab, 'open');
    
    connectWebSocket(); // ✅ Ye line jaroori hai!
    initTradingView('EURUSD');
};

// Panel Toggle Logic (Updated)
function togglePanel(panelName) {
    if (panelName === 'left') {
        const left = document.querySelector('.left-sidebar');
        left.classList.toggle('collapsed');
        const restoreBtn = document.getElementById('restoreLeftContainer');
        restoreBtn.style.display = left.classList.contains('collapsed') ? 'flex' : 'none';
        setTimeout(() => initTradingView(state.currentSymbol), 100);
    } else if (panelName === 'right') {
        const right = document.querySelector('.right-sidebar');
        right.classList.toggle('collapsed');
        const restoreBtn = document.getElementById('restoreRightContainer');
        restoreBtn.style.display = right.classList.contains('collapsed') ? 'flex' : 'none';
        setTimeout(() => initTradingView(state.currentSymbol), 100);
    } else if (panelName === 'bottom') {
        const bottom = document.querySelector('.bottom-section');
        bottom.classList.toggle('collapsed');
        const restoreBtn = document.getElementById('restoreBottomContainer');
        restoreBtn.style.display = bottom.classList.contains('collapsed') ? 'flex' : 'none';
        setTimeout(() => initTradingView(state.currentSymbol), 100);
    }
}

function restorePanel(panelName) {
    if (panelName === 'left') {
        document.querySelector('.left-sidebar').classList.remove('collapsed');
        document.getElementById('restoreLeftContainer').style.display = 'none';
        setTimeout(() => initTradingView(state.currentSymbol), 100);
    } else if (panelName === 'right') {
        document.querySelector('.right-sidebar').classList.remove('collapsed');
        document.getElementById('restoreRightContainer').style.display = 'none';
        setTimeout(() => initTradingView(state.currentSymbol), 100);
    } else if (panelName === 'bottom') {
        document.querySelector('.bottom-section').classList.remove('collapsed');
        document.getElementById('restoreBottomContainer').style.display = 'none';
        setTimeout(() => initTradingView(state.currentSymbol), 100);
    }
}