const WebSocket = require('ws');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const FCSClient = require('./fcs-client-lib'); // Official FCS library
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

// ========== REGISTER ==========
app.post('/api/register', async (req, res) => {
    const { trader_id, email, phone, password, legal_name, address, referred_by_code } = req.body;
    try {
        const [existing] = await db.execute('SELECT * FROM users WHERE trader_id = ? OR email = ?', [trader_id, email]);
        if (existing.length) return res.status(400).json({ error: 'User already exists' });

        const hashed = await bcrypt.hash(password, 10);
        const newAffiliateCode = await getUniqueAffiliateCode();

        const [result] = await db.execute(
            `INSERT INTO users (trader_id, email, phone, password_hash, legal_name, address, is_verified, affiliate_code, referred_by_code, kyc_status, status) 
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'NOT_SUBMITTED', 'ACTIVE')`,
            [trader_id, email, phone, hashed, legal_name, address, newAffiliateCode, referred_by_code || null]
        );

        await db.execute(
            'INSERT INTO affiliates (user_id, affiliate_code) VALUES (?, ?)',
            [result.insertId, newAffiliateCode]
        );

        const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ success: true, token, account_code: null, affiliate_code: newAffiliateCode });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ========== LOGIN ==========
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
        const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await db.execute(
            'INSERT INTO email_verifications (email, purpose, otp_hash, expires_at) VALUES (?, ?, ?, ?)',
            [email, 'PASSWORD_RESET', otpHash, expiresAt]
        );
        sendOTPEmail(email, otp).catch(err => console.log("Email failed:", err.message));
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
        const [rows] = await db.execute(
            'SELECT * FROM email_verifications WHERE email = ? AND otp_hash = ? AND purpose = "PASSWORD_RESET" AND expires_at > NOW() AND consumed_at IS NULL',
            [email, otpHash]
        );
        if (!rows.length) return res.status(400).json({ error: 'Invalid OTP' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        await db.execute('UPDATE users SET password_hash = ? WHERE email = ?', [hashed, email]);
        await db.execute('UPDATE email_verifications SET consumed_at = NOW() WHERE email = ?', [email]);
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
            `SELECT id, trader_id, legal_name, email, phone, address, kyc_status, affiliate_code FROM users WHERE id = ? LIMIT 1`,
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

// ========== PAYMENT ENGINE (using challenge_configs) ==========
const MODEL_MAP = { 'direct': 'prototype_5k', 'two_step': 'warrior_5k', 'prototype_5k': 'prototype_5k', 'warrior_5k': 'warrior_5k' };

async function getChallengeConfig(modelKey) {
    const [rows] = await db.execute('SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1', [modelKey]);
    if (!rows.length) throw new Error('Invalid challenge model');
    return rows[0];
}

async function calculateServerPrice(model, affiliateCode) {
    const mappedModel = MODEL_MAP[model] || model;
    const config = await getChallengeConfig(mappedModel);
    const original = config.price_cents;
    let discountAmountCents = 0, affiliateUserId = null, affiliateApplied = false;

    if (affiliateCode) {
        // ✅ FIXED: Use `id` from users, not `user_id`
        const [affiliateRows] = await db.execute('SELECT id FROM users WHERE affiliate_code = ? LIMIT 1', [String(affiliateCode).trim()]);
        if (affiliateRows.length > 0) {
            affiliateUserId = affiliateRows[0].id;
            discountAmountCents = Math.floor(original * (config.affiliate_discount_bps / 10000));
            affiliateApplied = true;
        }
    }

    const finalAmount = Math.max(original - discountAmountCents, 0);
    return {
        model: mappedModel,
        originalAmountCents: original,
        discountAmountCents,
        finalAmountCents: finalAmount,
        currency: String(process.env.PAYMENT_CURRENCY || 'USD').toUpperCase(),
        affiliateApplied,
        affiliate_user_id: affiliateUserId,
        config
    };
}

let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    console.log('✅ Razorpay configured');
} else { console.warn('⚠️ Razorpay is not configured.'); }

// ========== PAYMENT QUOTE ==========
app.post('/api/payments/quote', authenticateToken, async (req, res) => {
    try {
        const pricing = await calculateServerPrice(req.body.model, req.body.affiliate_code);
        res.json({ success: true, pricing });
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message || 'Unable to calculate price' }); }
});

// ========== PAYMENT REQUEST (NEW) ==========
function generateRequestRef() {
    return 'REQ-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// POST /api/payments/request - User requests a payment link
app.post('/api/payments/request', authenticateToken, async (req, res) => {
    const { model, affiliate_code, email } = req.body;
    try {
        // 1. Get the authenticated user
        const [users] = await db.execute('SELECT id, legal_name, email, phone FROM users WHERE id = ?', [req.userId]);
        if (!users.length) return res.status(404).json({ error: 'User not found' });
        const user = users[0];

        // 2. Calculate price server-side (includes affiliate discount)
        const pricing = await calculateServerPrice(model, affiliate_code);

        // 3. Generate unique request reference
        const requestRef = generateRequestRef();

        // 4. Find affiliate user details if code exists
        let affiliateName = null;
        if (pricing.affiliateApplied && pricing.affiliate_user_id) {
            const [affiliateUsers] = await db.execute('SELECT legal_name FROM users WHERE id = ?', [pricing.affiliate_user_id]);
            if (affiliateUsers.length) affiliateName = affiliateUsers[0].legal_name;
        }

        // 5. Create payment order with status REQUESTED
        await db.execute(
            `INSERT INTO payment_orders 
             (order_ref, user_id, provider, model, affiliate_code, affiliate_id, original_amount_cents, discount_amount_cents, final_amount_cents, currency, status, created_at) 
             VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', NOW())`,
            [requestRef, req.userId, pricing.model, affiliate_code || null, pricing.affiliate_user_id || null, 
             pricing.originalAmountCents, pricing.discountAmountCents, pricing.finalAmountCents, pricing.currency]
        );

        // 6. Send email to Admin with all details
        const adminEmail = 'support.fundfxt@gmail.com';
        const subject = `New Payment Request: ${requestRef}`;
        const html = `
            <h2>FundFXT Payment Request</h2>
            <p><strong>Request ID:</strong> ${requestRef}</p>
            <p><strong>User Name:</strong> ${user.legal_name}</p>
            <p><strong>User Email:</strong> ${user.email}</p>
            <p><strong>User Phone:</strong> ${user.phone}</p>
            <p><strong>Challenge Model:</strong> ${pricing.model}</p>
            <p><strong>Affiliate Code:</strong> ${affiliate_code || 'None'}</p>
            <p><strong>Affiliate Name:</strong> ${affiliateName || 'N/A'}</p>
            <p><strong>Original Amount:</strong> $${(pricing.originalAmountCents / 100).toFixed(2)}</p>
            <p><strong>Discount:</strong> $${(pricing.discountAmountCents / 100).toFixed(2)}</p>
            <p><strong>Final Amount (Create Payment Link for this):</strong> $${(pricing.finalAmountCents / 100).toFixed(2)}</p>
            <p>Please create a Razorpay Payment Link for this amount and send it to ${user.email}.</p>
        `;
        await sendEmail(adminEmail, subject, html).catch(err => console.log('Email failed:', err.message));

        // 7. Return success with request reference
        res.json({ 
            success: true, 
            request_ref: requestRef, 
            message: 'Payment request created. You will receive a payment link via email shortly.',
            pricing
        });
    } catch (error) {
        console.error('Payment request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper function to send email
async function sendEmail(to, subject, html) {
    const API_KEY = process.env.EMAIL_PASS;
    const FROM_EMAIL = "FundFXT <onboarding@resend.dev>";
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
    });
    if (!response.ok) throw new Error('Email API Error');
}

// ========== ADMIN AUTH & ROUTES (SIMPLIFIED) ==========
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [admins] = await db.execute('SELECT * FROM admin_users WHERE email = ?', [email]);
        if (!admins.length) return res.status(400).json({ error: 'Admin not found' });
        const admin = admins[0];
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) return res.status(400).json({ error: 'Invalid password' });
        const token = jwt.sign({ adminId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' });
        res.json({ success: true, token });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

function authenticateAdmin(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No admin token' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Invalid admin token' });
        req.adminId = decoded.adminId;
        req.adminRole = decoded.role;
        next();
    });
}

app.get('/api/admin/payment-requests', authenticateAdmin, async (req, res) => {
    try {
        const [requests] = await db.query(`
            SELECT po.*, u.legal_name, u.email as user_email 
            FROM payment_orders po 
            JOIN users u ON po.user_id = u.id 
            WHERE po.status IN ('REQUESTED', 'LINK_SENT', 'PAYMENT_PENDING')
            ORDER BY po.created_at DESC
        `);
        res.json({ success: true, requests });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/payment-requests/:id/mark-link-sent', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { payment_link } = req.body;
    try {
        await db.execute('UPDATE payment_orders SET status = "LINK_SENT", payment_link = ? WHERE id = ?', [payment_link || null, id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== AFFILIATE DASHBOARD STATS ==========
app.get('/api/affiliate/stats', authenticateToken, async (req, res) => {
    try {
        const [affiliateRows] = await db.execute('SELECT * FROM affiliates WHERE user_id = ? LIMIT 1', [req.userId]);
        if (!affiliateRows.length) return res.status(404).json({ error: 'Affiliate account not found' });
        const affiliate = affiliateRows[0];
        const [referralCount] = await db.execute('SELECT COUNT(DISTINCT user_id) AS total FROM payment_orders WHERE affiliate_code = ? AND status = "paid"', [affiliate.affiliate_code]);
        const [commissionSum] = await db.execute(`SELECT SUM(commission_amount_cents) AS total_earnings_cents, SUM(CASE WHEN status = 'PENDING' THEN commission_amount_cents ELSE 0 END) AS pending_earnings_cents, SUM(CASE WHEN status = 'PAID' THEN commission_amount_cents ELSE 0 END) AS paid_earnings_cents FROM affiliate_commissions WHERE affiliate_id = ?`, [affiliate.id]);
        res.json({ affiliate_code: affiliate.affiliate_code, total_referrals: referralCount[0].total || 0, total_sales: affiliate.total_sales, total_earnings_cents: commissionSum[0].total_earnings_cents || 0, pending_earnings_cents: commissionSum[0].pending_earnings_cents || 0, paid_earnings_cents: commissionSum[0].paid_earnings_cents || 0 });
    } catch (error) { console.error('Affiliate stats error:', error); res.status(500).json({ error: 'Failed to fetch affiliate stats' }); }
});

// ========== FCS LIVE MARKET DATA (Using Official Library) ==========
const FCS_API_KEY = process.env.FCS_API_KEY || 'fcs_socket_demo';
const fcs = new FCSClient(FCS_API_KEY);
fcs.showLogs = true;

fcs.onconnected = () => {
    console.log('✅ FCS Connected successfully');
    const symbols = ['FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'FX:AUDUSD', 'FX:XAUUSD'];
    symbols.forEach(sym => {
        fcs.join(sym, '15');
    });
};

fcs.onmessage = (data) => {
    if (data.type === 'price' && data.prices) {
        const sym = data.symbol.replace('FX:', '');
        const last = data.prices.c;
        const spread = sym.includes('JPY') ? 0.015 : 0.00015;
        const ask = last + spread;
        const bid = last - spread;
        global.prices = global.prices || {};
        global.priceCache = global.priceCache || {};
        global.prices[sym] = { bid, ask, change: data.prices.ch || 0, changePercent: data.prices.chp || 0 };
        global.priceCache[sym] = { bid, ask };
        processLivePrices();
    }
};

fcs.onclose = (event) => {
    console.log(`❌ FCS disconnected (${event.code}): ${event.reason || 'no reason'}`);
};

fcs.onerror = (err) => {
    console.error('FCS error:', err.message || err);
};

fcs.connect().catch(err => {
    console.error('FCS connection failed:', err.message);
});

// ========== TRADE ENGINE ==========
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
    const priceCache = global.priceCache || {};
    const [trades] = await db.execute("SELECT * FROM trades WHERE status = 'OPEN'");
    for (const trade of trades) {
        const price = priceCache[trade.symbol];
        if (!price) continue;
        const currentPrice = trade.side === 'BUY' ? price.bid : price.ask;
        const floatingCents = Math.round(calculatePL(trade.symbol, trade.side, trade.entry_price, currentPrice, trade.volume) * 100);
        await db.execute('UPDATE trades SET current_price = ?, floating_profit_cents = ? WHERE trade_id = ?', [currentPrice, floatingCents, trade.trade_id]);
        let closeReason = null;
        if (trade.side === 'BUY') {
            if (trade.stop_loss && currentPrice <= trade.stop_loss) closeReason = 'SL';
            if (trade.take_profit && currentPrice >= trade.take_profit) closeReason = 'TP';
        } else {
            if (trade.stop_loss && currentPrice >= trade.stop_loss) closeReason = 'SL';
            if (trade.take_profit && currentPrice <= trade.take_profit) closeReason = 'TP';
        }
        if (closeReason) {
            const realizedCents = Math.round(calculatePL(trade.symbol, trade.side, trade.entry_price, currentPrice, trade.volume) * 100);
            await db.execute(`UPDATE trades SET status = 'CLOSED', exit_price = ?, exit_time = NOW(), realized_profit_cents = ?, close_reason = ? WHERE trade_id = ?`, [currentPrice, realizedCents, closeReason, trade.trade_id]);
            await db.execute('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', [realizedCents, trade.account_id]);
        }
    }
}

// ========== TRADE EXECUTION ==========
app.post('/api/trade/execute', authenticateToken, async (req, res) => {
    const { account_code, symbol, side, volume, sl, tp } = req.body;
    if (!['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'].includes(symbol)) return res.status(400).json({ error: 'Symbol not allowed' });
    if (!global.priceCache || !global.priceCache[symbol]) return res.status(400).json({ error: 'Price not available yet' });
    const [accounts] = await db.execute('SELECT * FROM accounts WHERE account_code = ? AND user_id = ?', [account_code, req.userId]);
    if (!accounts.length) return res.status(404).json({ error: 'Account not found' });
    const account = accounts[0];
    const entry = side === 'BUY' ? global.priceCache[symbol].ask : global.priceCache[symbol].bid;
    const tradeId = 'TR-' + Date.now() + Math.random().toString(36).substr(2, 5);
    const tradingDay = new Date().toISOString().split('T')[0];
    await db.execute(`INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, trading_day, stop_loss, take_profit, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'OPEN')`, [tradeId, account.id, account_code, req.userId, symbol, side, volume, entry, tradingDay, sl || null, tp || null]);
    res.json({ success: true, trade_id: tradeId, entry_price: entry });
});

app.get('/api/trade/get', authenticateToken, async (req, res) => {
    const { account_code } = req.query;
    const [trades] = await db.execute('SELECT * FROM trades WHERE account_code = ? AND user_id = ?', [account_code, req.userId]);
    res.json({ trades });
});

// ========== WEBSOCKET SERVER ==========
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
const wss = new WebSocket.Server({ server, path: '/ws' });

setInterval(() => {
    if (global.prices && Object.keys(global.prices).length > 0) {
        const msg = JSON.stringify({ type: 'price', data: global.prices });
        wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(msg); });
    }
}, 1000);

wss.on('connection', (client) => {
    console.log('Frontend WebSocket connected');
    client.send(JSON.stringify({ type: 'price', data: global.prices || {} }));
});

// ========== SEED DEFAULT ADMIN ==========
(async () => {
    try {
        const [admins] = await db.execute('SELECT id FROM admin_users LIMIT 1');
        if (admins.length === 0) {
            const defaultEmail = process.env.ADMIN_EMAIL || 'admin@fundfxt.com';
            const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
            const hashed = await bcrypt.hash(defaultPassword, 10);
            await db.execute('INSERT INTO admin_users (email, name, password_hash, role) VALUES (?, ?, ?, "SUPER_ADMIN")', [defaultEmail, 'FundFXT Admin', hashed]);
            console.log('✅ Default admin created:', defaultEmail);
        }
    } catch (err) { console.error('Admin seed error:', err.message); }
})();
