const WebSocket = require('ws');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const FCSClient = require('./fcs-client-lib'); // Import FCS Library
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// ========== DATABASE ==========
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    waitForConnections: true,
    connectionLimit: 10,
    ssl: { rejectUnauthorized: false }
});

(async () => {
    try {
        await db.query('SELECT 1');
        console.log('✅ Database connected');
    } catch (err) {
        console.error('❌ DB error:', err.message);
    }
})();

// ========== AUTH & EMAIL (Bilkul unchanged, aapka original code) ==========
async function sendOTPEmail(userEmail, otp) { /* ... (Aapka existing code) ... */ }
function generateAffiliateCode() { /* ... (Aapka existing code) ... */ }
async function getUniqueAffiliateCode() { /* ... (Aapka existing code) ... */ }

app.post('/api/register', async (req, res) => { /* ... (Aapka existing code) ... */ });
app.post('/api/login', async (req, res) => { /* ... (Aapka existing code) ... */ });
app.post('/api/forgot-password', async (req, res) => { /* ... (Aapka existing code) ... */ });
app.post('/api/verify-otp', async (req, res) => { /* ... (Aapka existing code) ... */ });
app.post('/api/reset-password', async (req, res) => { /* ... (Aapka existing code) ... */ });

function authenticateToken(req, res, next) { /* ... (Aapka existing code) ... */ }

app.get('/api/user/profile', authenticateToken, async (req, res) => { /* ... (Aapka existing code) ... */ });
app.get('/api/get-user-by-email', async (req, res) => { /* ... (Aapka existing code) ... */ });
app.get('/api/accounts', authenticateToken, async (req, res) => { /* ... (Aapka existing code) ... */ });

// ========== SECURE PAYMENT ENGINE (Aapka existing code) ==========
const CHALLENGE_PRICES_CENTS = { direct: 1000, two_step: 4000 };
const PAYMENT_CURRENCY = String(process.env.PAYMENT_CURRENCY || 'USD').toUpperCase();

async function calculateServerPrice(model, affiliateCode) { /* ... (Aapka existing code) ... */ }
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) { /* ... (Aapka existing code) ... */ }
async function ensurePaymentOrdersTable() { /* ... (Aapka existing code) ... */ }

app.post('/api/payments/quote', authenticateToken, async (req, res) => { /* ... (Aapka existing code) ... */ });
app.post('/api/payments/create-order', authenticateToken, async (req, res) => { /* ... (Aapka existing code) ... */ });
function verifyRazorpaySignature(orderId, paymentId, signature) { /* ... (Aapka existing code) ... */ }
function generateAccountCode() { /* ... (Aapka existing code) ... */ }
app.post('/api/payments/verify', authenticateToken, async (req, res) => { /* ... (Aapka existing code) ... */ });

// ==================================================================
// 🚀 NEW: FCS TRADING ENGINE (Random Price Engine REMOVED)
// ==================================================================

// 1. Price Cache (FCS se aayega)
let prices = {};
let priceCache = {};

// 2. Instrument Config
const instruments = {
    EURUSD: { pip: 0.0001, size: 100000 },
    GBPUSD: { pip: 0.0001, size: 100000 },
    AUDUSD: { pip: 0.0001, size: 100000 },
    USDJPY: { pip: 0.01, size: 100000 },
    XAUUSD: { pip: 0.1, size: 100 } // Gold ka contract size alag hota hai
};

// 3. Calculate P/L
function calculatePL(symbol, side, entry, current, volume) {
    const inst = instruments[symbol];
    if (!inst) return 0;
    let diff = (current - entry);
    if (side === 'SELL') diff = -diff;
    return (diff / inst.pip) * (inst.size * inst.pip) * volume;
}

// 4. Trade Engine (Har FCS tick par chalega)
async function processLivePrices() {
    const [trades] = await db.execute('SELECT * FROM trades WHERE status = "OPEN"');
    for (const trade of trades) {
        const price = priceCache[trade.symbol];
        if (!price) continue;

        // Price according to side (BUY check BID, SELL check ASK)
        const currentPrice = trade.side === 'BUY' ? price.bid : price.ask;
        const floating = calculatePL(trade.symbol, trade.side, trade.entry_price, currentPrice, trade.volume);

        // Update live P/L
        await db.execute('UPDATE trades SET current_price = ?, floating_profit = ? WHERE trade_id = ?', [currentPrice, floating, trade.trade_id]);

        // Check SL / TP (Touch = Close Rule)
        let closeReason = null;
        if (trade.side === 'BUY') {
            if (trade.stop_loss && currentPrice <= trade.stop_loss) closeReason = 'SL';
            if (trade.take_profit && currentPrice >= trade.take_profit) closeReason = 'TP';
        } else {
            if (trade.stop_loss && currentPrice >= trade.stop_loss) closeReason = 'SL';
            if (trade.take_profit && currentPrice <= trade.take_profit) closeReason = 'TP';
        }

        // Close Trade
        if (closeReason) {
            await db.execute('UPDATE trades SET status = "CLOSED", exit_price = ?, exit_time = NOW(), realized_profit = ?, close_reason = ? WHERE trade_id = ?', [currentPrice, floating, closeReason, trade.trade_id]);
            await db.execute('UPDATE accounts SET balance = balance + ? WHERE account_number = ?', [floating, trade.account_number]);
        }
    }
}

// 5. FCS Connection (NO RANDOM PRICES)
const fcs = new FCSClient(process.env.FCS_API_KEY, process.env.FCS_WS_URL);

fcs.connect().then(() => {
    console.log("✅ Connected to FCS Live Data");
    // Subscribe ONLY to allowed symbols
    ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'].forEach(sym => fcs.join(`FX:${sym}`, '15'));
});

fcs.onmessage = (data) => {
    if (data.type === 'price' && data.prices) {
        const sym = data.symbol.replace('FX:', '');
        
        // FCS Price Normalization (Spread fix)
        const last = data.prices.c;
        const spread = sym.includes('JPY') ? 0.015 : 0.00015;
        const ask = last + spread;
        const bid = last - spread;

        prices[sym] = { bid: bid, ask: ask, change: 0, changePercent: data.prices.chp ? data.prices.chp : 0 };
        priceCache[sym] = { bid: bid, ask: ask };
        
        // Run Engine
        processLivePrices();
    }
};

fcs.onclose = () => {
    console.log("FCS disconnected, retrying in 5s...");
    setTimeout(() => fcs.connect(), 5000);
};

// 6. Naye Routes (Trades APIs)
app.post('/api/trade/execute', authenticateToken, async (req, res) => {
    const { account_number, symbol, side, volume, sl, tp } = req.body;

    if (!['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'].includes(symbol)) return res.status(400).json({ error: 'Symbol not allowed' });
    if (!priceCache[symbol]) return res.status(400).json({ error: 'Price not available yet' });

    // Backend decides Entry Price (No Frontend Price Allowed)
    const entry = side === 'BUY' ? priceCache[symbol].ask : priceCache[symbol].bid;

    const tradeId = 'TR-' + Date.now() + Math.random().toString(36).substr(2, 5);
    await db.execute(
        `INSERT INTO trades (trade_id, account_number, user_id, symbol, side, volume, entry_price, entry_time, stop_loss, take_profit, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'OPEN')`,
        [tradeId, account_number, req.userId, symbol, side, volume, entry, sl, tp]
    );

    res.json({ success: true, trade_id: tradeId, entry_price: entry });
});

app.get('/api/trade/get', authenticateToken, async (req, res) => {
    const { account_number } = req.query;
    const [trades] = await db.execute('SELECT * FROM trades WHERE account_number = ? AND user_id = ?', [account_number, req.userId]);
    res.json({ trades });
});

// 7. WebSocket Server (Broadcasting FCS Data to Frontend)
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
const wss = new WebSocket.Server({ server, path: '/ws' });

setInterval(() => {
    if (Object.keys(prices).length > 0) {
        const msg = JSON.stringify({ type: 'price', data: prices });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(msg);
        });
    }
}, 1000);

wss.on('connection', (client) => {
    console.log('Frontend WebSocket connected');
    client.send(JSON.stringify({ type: 'price', data: prices }));
});
