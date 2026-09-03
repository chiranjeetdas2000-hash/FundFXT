const WebSocket = require('ws');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const FCSClient = require('./fcs-client-lib'); // FCS Import
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

// ========== EMAIL (RESEND) ==========
async function sendOTPEmail(userEmail, otp) {
    const ADMIN_EMAIL = 'support.fundfxt@gmail.com';
    const subject = `Password Reset OTP for ${userEmail}`;
    const html = `<div style="font-family: Arial; max-width: 500px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #00b56a;">FundFXT Support</h2>
            <p>Please use this OTP to verify your identity and complete the password reset process</p>
            <p><strong>User Email:</strong> ${userEmail}</p>
            <p><strong>OTP:</strong> ${otp}</p>
        </div>`;

    const API_KEY = process.env.EMAIL_PASS;
    const FROM_EMAIL = "FundFXT <onboarding@resend.dev>";

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: [ADMIN_EMAIL], subject: subject, html: html })
    });

    if (!response.ok) throw new Error('Resend API Error');
}

// ========== AFFILIATE CODE GENERATOR ==========
function generateAffiliateCode() {
    const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
    const numChars = '0123456789';
    const symbols = ['@', '#'];
    let chars = [];
    for (let i = 0; i < 3; i++) chars.push(upperChars[Math.floor(Math.random() * upperChars.length)]);
    for (let i = 0; i < 2; i++) chars.push(lowerChars[Math.floor(Math.random() * lowerChars.length)]);
    for (let i = 0; i < 3; i++) chars.push(numChars[Math.floor(Math.random() * numChars.length)]);
    chars.push('@');
    chars.push('#');
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

async function getUniqueAffiliateCode() {
    let code = generateAffiliateCode();
    let [existing] = await db.execute('SELECT id FROM users WHERE affiliate_code = ?', [code]);
    while (existing.length > 0) {
        code = generateAffiliateCode();
        [existing] = await db.execute('SELECT id FROM users WHERE affiliate_code = ?', [code]);
    }
    return code;
}

// ========== REGISTER (Login/Register Features Aapke Original Code Se 100% Safe) ==========
app.post('/api/register', async (req, res) => {
    const { trader_id, email, phone, password, legal_name, address } = req.body;
    try {
        const [existing] = await db.execute('SELECT * FROM users WHERE trader_id = ? OR email = ?', [trader_id, email]);
        if (existing.length) return res.status(400).json({ error: 'User already exists' });

        const hashed = await bcrypt.hash(password, 10);
        const newAffiliateCode = await getUniqueAffiliateCode();

        const [result] = await db.execute(
            'INSERT INTO users (trader_id, email, phone, password_hash, legal_name, address, is_verified, affiliate_code) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
            [trader_id, email, phone, hashed, legal_name, address, newAffiliateCode]
        );

        const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ success: true, token, account_code: null, affiliate_code: newAffiliateCode });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ========== LOGIN (100% Complete) ==========
app.post('/api/login', async (req, res) => {
    const { identifier, password } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE trader_id = ? OR email = ?', [identifier, identifier]);
        if (!rows.length) return res.status(400).json({ error: 'User not found' });
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: 'Invalid password' });
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== FORGOT PASSWORD ==========
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (!rows.length) return res.status(400).json({ error: 'Email not found' });
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await db.execute('INSERT INTO email_verifications (email, otp, expires_at) VALUES (?, ?, ?)', [email, otp, expiresAt]);
        sendOTPEmail(email, otp).catch(err => console.log("Email failed:", err.message));
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM email_verifications WHERE email = ? AND otp = ? AND expires_at > NOW()', [email, otp]);
        if (!rows.length) return res.status(400).json({ error: 'Invalid OTP' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        await db.execute('UPDATE users SET password_hash = ? WHERE email = ?', [hashed, email]);
        await db.execute('DELETE FROM email_verifications WHERE email = ?', [email]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== AUTH MIDDLEWARE ==========
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.userId = decoded.userId;
        next();
    });
}

// ========== USER PROFILE ==========
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, trader_id, legal_name, email, phone, address,
                    COALESCE(kyc_status, 'Pending') AS kyc_status,
                    affiliate_code
             FROM users WHERE id = ? LIMIT 1`,
            [req.userId]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });
        const user = rows[0];
        res.json({ legal_name: user.legal_name, email: user.email, phone: user.phone, address: user.address, kyc_status: user.kyc_status, affiliate_code: user.affiliate_code || null });
    } catch (error) {
        console.error('Profile DB Error:', error.message);
        res.status(500).json({ error: 'Column missing in database. Please run ALTER TABLE.' });
    }
});

// ========== GET USER BY EMAIL ==========
app.get('/api/get-user-by-email', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    try {
        const [rows] = await db.execute('SELECT legal_name, email, phone, address FROM users WHERE email = ?', [email]);
        if (rows.length > 0) {
            const user = rows[0];
            res.json({ exists: true, name: user.legal_name, email: user.email, phone: user.phone, address: user.address });
        } else {
            res.json({ exists: false });
        }
    } catch (error) { console.error(error); res.status(500).json({ error: error.message }); }
});

// ========== ACCOUNTS ==========
app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);
        res.json({ accounts });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== SECURE PAYMENT ENGINE (Aapka Original) ==========
const CHALLENGE_PRICES_CENTS = { direct: 1000, two_step: 4000 };
const PAYMENT_CURRENCY = String(process.env.PAYMENT_CURRENCY || 'USD').toUpperCase();

async function calculateServerPrice(model, affiliateCode) {
    const normalizedModel = String(model || '').trim().toLowerCase();
    const original = CHALLENGE_PRICES_CENTS[normalizedModel];
    if (!original) { const error = new Error('Invalid challenge model'); error.statusCode = 400; throw error; }
    let discountAmountCents = 0, affiliateUserId = null, affiliateApplied = false;
    if (affiliateCode) {
        const [affiliateRows] = await db.execute('SELECT id, affiliate_code FROM users WHERE affiliate_code = ? LIMIT 1', [String(affiliateCode).trim()]);
        if (affiliateRows.length > 0) {
            affiliateUserId = affiliateRows[0].id;
            discountAmountCents = Math.floor(original * 0.5);
            affiliateApplied = true;
        }
    }
    const finalAmount = Math.max(original - discountAmountCents, 0);
    return { model: normalizedModel, originalAmountCents: original, discountAmountCents: discountAmountCents, finalAmountCents: finalAmount, currency: PAYMENT_CURRENCY, affiliateApplied: affiliateApplied, affiliate_user_id: affiliateUserId };
}

let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    console.log('✅ Razorpay configured');
} else { console.warn('⚠️ Razorpay is not configured.'); }

async function ensurePaymentOrdersTable() {
    await db.query(`CREATE TABLE IF NOT EXISTS payment_orders ( id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL, provider VARCHAR(30) NOT NULL DEFAULT 'razorpay', provider_order_id VARCHAR(100) NOT NULL, provider_payment_id VARCHAR(100) NULL, model VARCHAR(50) NOT NULL, affiliate_code VARCHAR(100) NULL, original_amount_cents INT UNSIGNED NOT NULL, discount_amount_cents INT UNSIGNED NOT NULL DEFAULT 0, final_amount_cents INT UNSIGNED NOT NULL, currency VARCHAR(10) NOT NULL DEFAULT 'USD', status ENUM('created','paid','failed','cancelled') NOT NULL DEFAULT 'created', account_code VARCHAR(100) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP NULL, PRIMARY KEY (id), UNIQUE KEY uq_provider_order (provider_order_id), UNIQUE KEY uq_provider_payment (provider_payment_id), KEY idx_payment_user (user_id), KEY idx_payment_status (status) ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
}
ensurePaymentOrdersTable().then(() => console.log('✅ Payment orders table ready')).catch(err => console.error('❌ Payment table setup failed:', err.message));

app.post('/api/payments/quote', authenticateToken, async (req, res) => {
    try {
        const pricing = await calculateServerPrice(req.body.model, req.body.affiliate_code);
        res.json({ success: true, pricing });
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message || 'Unable to calculate price' }); }
});

app.post('/api/payments/create-order', authenticateToken, async (req, res) => {
    if (!razorpay) return res.status(503).json({ error: 'Payment gateway is not configured on the server' });
    const model = String(req.body.model || '').trim().toLowerCase();
    const affiliateCode = String(req.body.affiliate_code || '').trim();
    try {
        const pricing = await calculateServerPrice(model, affiliateCode);
        const [users] = await db.execute('SELECT id, email, legal_name FROM users WHERE id = ? LIMIT 1', [req.userId]);
        if (!users.length) return res.status(404).json({ error: 'User not found' });
        const receipt = `FXT_${req.userId}_${Date.now()}`.slice(0, 40);
        const razorpayOrder = await razorpay.orders.create({ amount: pricing.finalAmountCents, currency: pricing.currency, receipt, notes: { user_id: String(req.userId), model: pricing.model, affiliate_code: affiliateCode || 'none', affiliate_user_id: pricing.affiliate_user_id ? String(pricing.affiliate_user_id) : 'none' } });
        await db.execute(`INSERT INTO payment_orders (user_id, provider, provider_order_id, model, affiliate_code, original_amount_cents, discount_amount_cents, final_amount_cents, currency, status) VALUES (?, 'razorpay', ?, ?, ?, ?, ?, ?, ?, 'created')`, [req.userId, razorpayOrder.id, pricing.model, affiliateCode || null, pricing.originalAmountCents, pricing.discountAmountCents, pricing.finalAmountCents, pricing.currency]);
        res.json({ success: true, key_id: process.env.RAZORPAY_KEY_ID, order_id: razorpayOrder.id, amount: pricing.finalAmountCents, currency: pricing.currency, pricing });
    } catch (error) { console.error('Create order error:', error.message); res.status(error.statusCode || 500).json({ error: error.message || 'Unable to create payment order' }); }
});

function verifyRazorpaySignature(orderId, paymentId, signature) {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature || ''), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function generateAccountCode() { return `ACC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

app.post('/api/payments/verify', authenticateToken, async (req, res) => {
    if (!razorpay) return res.status(503).json({ error: 'Payment gateway is not configured on the server' });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return res.status(400).json({ error: 'Incomplete payment verification data' });
    const connection = await db.getConnection();
    try {
        const [orderRows] = await connection.execute('SELECT * FROM payment_orders WHERE provider_order_id = ? AND user_id = ? LIMIT 1', [razorpay_order_id, req.userId]);
        if (!orderRows.length) return res.status(404).json({ error: 'Payment order not found' });
        const paymentOrder = orderRows[0];
        if (paymentOrder.status === 'paid') return res.json({ success: true, already_verified: true, account_code: paymentOrder.account_code, order_id: paymentOrder.provider_order_id });
        if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) { await connection.execute('UPDATE payment_orders SET status = ? WHERE id = ? AND status = ?', ['failed', paymentOrder.id, 'created']); return res.status(400).json({ error: 'Payment signature verification failed' }); }
        const providerOrder = await razorpay.orders.fetch(razorpay_order_id);
        const providerPayment = await razorpay.payments.fetch(razorpay_payment_id);
        if (String(providerOrder.id) !== String(paymentOrder.provider_order_id) || Number(providerOrder.amount) !== Number(paymentOrder.final_amount_cents)) { await connection.execute('UPDATE payment_orders SET status = ? WHERE id = ? AND status = ?', ['failed', paymentOrder.id, 'created']); return res.status(400).json({ error: 'Payment amount mismatch' }); }
        const accountCode = generateAccountCode();
        await connection.execute('INSERT INTO accounts (user_id, account_code) VALUES (?, ?)', [req.userId, accountCode]);
        await connection.execute("UPDATE payment_orders SET provider_payment_id = ?, status = 'paid', account_code = ?, paid_at = NOW() WHERE id = ?", [razorpay_payment_id, accountCode, paymentOrder.id]);
        if (paymentOrder.affiliate_code) {
            const [affiliateData] = await connection.execute('SELECT id, user_id FROM users WHERE affiliate_code = ? LIMIT 1', [paymentOrder.affiliate_code]);
            if (affiliateData.length > 0) {
                const affiliate = affiliateData[0];
                const commissionCents = Math.floor((paymentOrder.final_amount_cents * 0.20) + 100);
                await connection.execute(`INSERT INTO affiliate_commissions (affiliate_id, order_id, referred_user_id, model, commission_amount, status) VALUES (?, ?, ?, ?, ?, 'Pending')`, [affiliate.id, paymentOrder.id, req.userId, paymentOrder.model, (commissionCents / 100).toFixed(2)]);
                await connection.execute(`UPDATE affiliates SET total_sales = total_sales + 1, pending_earnings = pending_earnings + ? WHERE user_id = ?`, [(commissionCents / 100).toFixed(2), affiliate.user_id]);
            }
        }
        await connection.commit();
        res.json({ success: true, message: 'Payment verified and challenge activated', account_code: accountCode, order_id: razorpay_order_id, payment_id: razorpay_payment_id });
    } catch (error) { try { await connection.rollback(); } catch (_) {} console.error('Verify payment error:', error.message); res.status(500).json({ error: 'Unable to verify payment' }); } finally { connection.release(); }
});

// ==================================================================
// 🚀 NEW: FCS TRADING ENGINE (No Random Prices)
// ==================================================================
let prices = {};
let priceCache = {};

const instruments = {
    EURUSD: { pip: 0.0001, size: 100000 },
    GBPUSD: { pip: 0.0001, size: 100000 },
    AUDUSD: { pip: 0.0001, size: 100000 },
    USDJPY: { pip: 0.01, size: 100000 },
    XAUUSD: { pip: 0.1, size: 100 }
};

function calculatePL(symbol, side, entry, current, volume) {
    const inst = instruments[symbol];
    if (!inst) return 0;
    let diff = (current - entry);
    if (side === 'SELL') diff = -diff;
    return (diff / inst.pip) * (inst.size * inst.pip) * volume;
}

async function processLivePrices() {
    const [trades] = await db.execute('SELECT * FROM trades WHERE status = "OPEN"');
    for (const trade of trades) {
        const price = priceCache[trade.symbol];
        if (!price) continue;
        const currentPrice = trade.side === 'BUY' ? price.bid : price.ask;
        const floating = calculatePL(trade.symbol, trade.side, trade.entry_price, currentPrice, trade.volume);
        await db.execute('UPDATE trades SET current_price = ?, floating_profit = ? WHERE trade_id = ?', [currentPrice, floating, trade.trade_id]);
        let closeReason = null;
        if (trade.side === 'BUY') {
            if (trade.stop_loss && currentPrice <= trade.stop_loss) closeReason = 'SL';
            if (trade.take_profit && currentPrice >= trade.take_profit) closeReason = 'TP';
        } else {
            if (trade.stop_loss && currentPrice >= trade.stop_loss) closeReason = 'SL';
            if (trade.take_profit && currentPrice <= trade.take_profit) closeReason = 'TP';
        }
        if (closeReason) {
            await db.execute('UPDATE trades SET status = "CLOSED", exit_price = ?, exit_time = NOW(), realized_profit = ?, close_reason = ? WHERE trade_id = ?', [currentPrice, floating, closeReason, trade.trade_id]);
            await db.execute('UPDATE accounts SET balance = balance + ? WHERE account_number = ?', [floating, trade.account_number]);
        }
    }
}

const fcs = new FCSClient(process.env.FCS_API_KEY, process.env.FCS_WS_URL);
fcs.connect().then(() => {
    console.log("✅ Connected to FCS Live Data");
    ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'].forEach(sym => fcs.join(`FX:${sym}`, '15'));
});
fcs.onmessage = (data) => {
    if (data.type === 'price' && data.prices) {
        const sym = data.symbol.replace('FX:', '');
        const last = data.prices.c;
        const spread = sym.includes('JPY') ? 0.015 : 0.00015;
        const ask = last + spread;
        const bid = last - spread;
        prices[sym] = { bid: bid, ask: ask, change: 0, changePercent: data.prices.chp ? data.prices.chp : 0 };
        priceCache[sym] = { bid: bid, ask: ask };
        processLivePrices();
    }
};
fcs.onclose = () => { console.log("FCS disconnected, retrying..."); setTimeout(() => fcs.connect(), 5000); };

// ========== NEW TRADE APIs ==========
app.post('/api/trade/execute', authenticateToken, async (req, res) => {
    const { account_number, symbol, side, volume, sl, tp } = req.body;
    if (!['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'].includes(symbol)) return res.status(400).json({ error: 'Symbol not allowed' });
    if (!priceCache[symbol]) return res.status(400).json({ error: 'Price not available yet' });
    const entry = side === 'BUY' ? priceCache[symbol].ask : priceCache[symbol].bid;
    const tradeId = 'TR-' + Date.now() + Math.random().toString(36).substr(2, 5);
    await db.execute(`INSERT INTO trades (trade_id, account_number, user_id, symbol, side, volume, entry_price, entry_time, stop_loss, take_profit, status) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'OPEN')`, [tradeId, account_number, req.userId, symbol, side, volume, entry, sl, tp]);
    res.json({ success: true, trade_id: tradeId, entry_price: entry });
});

app.get('/api/trade/get', authenticateToken, async (req, res) => {
    const { account_number } = req.query;
    const [trades] = await db.execute('SELECT * FROM trades WHERE account_number = ? AND user_id = ?', [account_number, req.userId]);
    res.json({ trades });
});

// ========== WEBSOCKET SERVER (Broadcast Backend Data) ==========
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
const wss = new WebSocket.Server({ server, path: '/ws' });

setInterval(() => {
    if (Object.keys(prices).length > 0) {
        const msg = JSON.stringify({ type: 'price', data: prices });
        wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(msg); });
    }
}, 1000);

wss.on('connection', (client) => {
    console.log('Frontend WebSocket connected');
    client.send(JSON.stringify({ type: 'price', data: prices }));
});
