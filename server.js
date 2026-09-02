const WebSocket = require('ws');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// ========== DATABASE (Fixed SSL & Port) ==========
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

// ========== EMAIL VIA RESEND API (SIRF FORGOT PASSWORD KE LIYE) ==========
async function sendOTPEmail(userEmail, otp) {
    const ADMIN_EMAIL = 'support.fundfxt@gmail.com'; 
    const subject = `Password Reset OTP for ${userEmail}`;
    const html = `
        <div style="font-family: Arial; max-width: 500px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #00b56a;">FundFXT Support</h2>
            <p>Please use this OTP to verify your identity and complete the password reset process</p>
            <p><strong>User Email:</strong> ${userEmail}</p>
            <p><strong>OTP:</strong> ${otp}</p>
        </div>
    `;

    const API_KEY = process.env.EMAIL_PASS; 
    const FROM_EMAIL = "FundFXT <onboarding@resend.dev>"; 

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: FROM_EMAIL,
            to: [ADMIN_EMAIL],
            subject: subject,
            html: html
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Resend API Error');
    }
}

// ========== NEW: GENERATE UNIQUE AFFILIATE CODE (3 Capital, 2 Small, 3 Numbers, 1 @, 1 #) ==========
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

// ========== DIRECT REGISTRATION (NO OTP) ==========
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

        // ❌ REMOVED: Dummy Account Create karne wali 2 lines yahan se hata di gayi hain.
        // Ab account sirf tab banega jab payment verify hogi!

        const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ success: true, token, account_code: null, affiliate_code: newAffiliateCode });
    } catch (error) { // Fix added above
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ========== VERIFY EMAIL (NOT USED IN REGISTRATION NOW, BUT KEEPING FOR BACKWARD COMPAT) ==========
app.post('/api/verify-email', async (req, res) => {
    const { email, otp, trader_id, phone, password, legal_name, address } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM email_verifications WHERE email = ? AND otp = ? AND expires_at > NOW()', [email, otp]);
        if (!rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' });

        const hashed = await bcrypt.hash(password, 10);
        const newAffiliateCode = await getUniqueAffiliateCode();

        const [result] = await db.execute(
            'INSERT INTO users (trader_id, email, phone, password_hash, legal_name, address, affiliate_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [trader_id, email, phone, hashed, legal_name, address, newAffiliateCode]
        );

        // ❌ REMOVED: Yahan se bhi dummy account create karne wali line hata di gayi hai.

        await db.execute('DELETE FROM email_verifications WHERE email = ?', [email]);
        
        const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ success: true, token, account_code: null, affiliate_code: newAffiliateCode });
    } catch (error) { // Fix added above
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

// ========== FORGOT PASSWORD (AB OTP ADMIN KO JAYEGI) ==========
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

// ========== AUTH MIDDLEWARE & ACCOUNTS ==========
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.userId = decoded.userId;
        next();
    });
}

app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);
        res.json({ accounts });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== WEBSOCKET SERVER ==========
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

const wss = new WebSocket.Server({ server, path: '/ws' });
const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
                 'EURGBP', 'EURJPY', 'EURCHF', 'EURCAD', 'GBPJPY', 'GBPCHF', 'GBPCAD',
                 'AUDJPY', 'AUDCAD', 'AUDCHF', 'CADJPY', 'CHFJPY', 'NZDJPY', 'NZDCAD', 'NZDCHF',
                 'XAUUSD', 'XAGUSD'];
const baseRates = {
    EURUSD: 1.1234, GBPUSD: 1.3120, USDJPY: 148.50, USDCHF: 0.9140,
    AUDUSD: 0.6540, USDCAD: 1.3670, NZDUSD: 0.5970, EURGBP: 0.8560,
    EURJPY: 166.80, EURCHF: 1.0270, EURCAD: 1.5360, GBPJPY: 194.50,
    GBPCHF: 1.2000, GBPCAD: 1.7940, AUDJPY: 97.00, AUDCAD: 0.8940,
    AUDCHF: 0.5970, CADJPY: 108.70, CHFJPY: 162.50, NZDJPY: 88.70,
    NZDCAD: 0.8160, NZDCHF: 0.5460, XAUUSD: 2035.00, XAGUSD: 23.50
};
let prices = {};
for (let sym of symbols) {
    const base = baseRates[sym] || 1.0;
    prices[sym] = { bid: base - 0.0001, ask: base + 0.0001, change: 0, changePercent: 0 };
}
setInterval(() => {
    for (let sym of symbols) {
        const spread = sym === 'XAUUSD' ? 0.5 : (sym === 'XAGUSD' ? 0.03 : 0.0002);
        const move = (Math.random() - 0.5) * spread * 0.1;
        const mid = (prices[sym].bid + prices[sym].ask) / 2;
        const newMid = mid + move;
        prices[sym].bid = newMid - spread / 2;
        prices[sym].ask = newMid + spread / 2;
        prices[sym].change = move;
        prices[sym].changePercent = (move / newMid) * 100;
    }
    const msg = JSON.stringify({ type: 'price', data: prices });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}, 1000);

wss.on('connection', (client) => {
    console.log('Frontend WebSocket connected');
    client.send(JSON.stringify({ type: 'price', data: prices }));
});

// ========== GET USER BY EMAIL (For Buy Challenge Page) ==========
app.get('/api/get-user-by-email', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const [rows] = await db.execute('SELECT legal_name, email, phone, address FROM users WHERE email = ?', [email]);
        if (rows.length > 0) {
            const user = rows[0];
            res.json({ exists: true, name: user.legal_name, phone: user.phone, address: user.address });
        } else {
            res.json({ exists: false });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

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
        res.json({
            legal_name: user.legal_name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            kyc_status: user.kyc_status,
            affiliate_code: user.affiliate_code || null
        });
    } catch (error) {
        try {
            const [rows] = await db.execute('SELECT legal_name, email, phone, address FROM users WHERE id = ? LIMIT 1', [req.userId]);
            if (!rows.length) return res.status(404).json({ error: 'User not found' });
            res.json({
                legal_name: rows[0].legal_name,
                email: rows[0].email,
                phone: rows[0].phone,
                address: rows[0].address,
                kyc_status: 'Pending',
                affiliate_code: null
            });
        } catch (fallbackError) {
            console.error('Profile error:', fallbackError.message);
            res.status(500).json({ error: 'Unable to load profile' });
        }
    }
});

// ========== UPDATE PROFILE ==========
app.post('/api/user/update-profile', authenticateToken, async (req, res) => {
    const { legal_name, phone } = req.body;
    if (!legal_name || !String(legal_name).trim()) {
        return res.status(400).json({ error: 'Name is required' });
    }
    try {
        await db.execute('UPDATE users SET legal_name = ?, phone = ? WHERE id = ?', [String(legal_name).trim(), phone ? String(phone).trim() : null, req.userId]);
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) { // Fix added above
        console.error('Update profile error:', error.message);
        res.status(500).json({ error: 'Unable to update profile' });
    }
});

// ========== AUTHENTICATED USER LOOKUP ==========
app.get('/api/get-user-by-email', authenticateToken, async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const [rows] = await db.execute('SELECT legal_name, email, phone, address FROM users WHERE id = ? AND LOWER(email) = ? LIMIT 1', [req.userId, email]);
        if (!rows.length) return res.json({ exists: false });
        const user = rows[0];
        res.json({ exists: true, name: user.legal_name, phone: user.phone, address: user.address });
    } catch (error) {
        console.error('User lookup error:', error.message);
        res.status(500).json({ error: 'Unable to fetch user details' });
    }
});

// ========== SECURE PAYMENT ENGINE ==========
const crypto = require('crypto');

const CHALLENGE_PRICES_CENTS = {
    direct: 1000,
    challenge: 2900
};

const AFFILIATE_DISCOUNTS_CENTS = {
    'XN45DH@d#2': {
        direct: 500,
        challenge: 900
    }
};

const PAYMENT_CURRENCY = String(process.env.PAYMENT_CURRENCY || 'USD').toUpperCase();

let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
        const Razorpay = require('razorpay');
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
        console.log('✅ Razorpay configured');
    } catch (err) {
        console.error('❌ Razorpay package/config error:', err.message);
    }
} else {
    console.warn('⚠️ Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
}

async function ensurePaymentOrdersTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS payment_orders (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT NOT NULL,
            provider VARCHAR(30) NOT NULL DEFAULT 'razorpay',
            provider_order_id VARCHAR(100) NOT NULL,
            provider_payment_id VARCHAR(100) NULL,
            model VARCHAR(50) NOT NULL,
            affiliate_code VARCHAR(100) NULL,
            original_amount_cents INT UNSIGNED NOT NULL,
            discount_amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
            final_amount_cents INT UNSIGNED NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'USD',
            status ENUM('created','paid','failed','cancelled') NOT NULL DEFAULT 'created',
            account_code VARCHAR(100) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            paid_at TIMESTAMP NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_provider_order (provider_order_id),
            UNIQUE KEY uq_provider_payment (provider_payment_id),
            KEY idx_payment_user (user_id),
            KEY idx_payment_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

ensurePaymentOrdersTable()
    .then(() => console.log('✅ Payment orders table ready'))
    .catch(err => console.error('❌ Payment table setup failed:', err.message));

function calculateServerPrice(model, affiliateCode) {
    const normalizedModel = String(model || '').trim().toLowerCase();
    const original = CHALLENGE_PRICES_CENTS[normalizedModel];
    if (!original) {
        const error = new Error('Invalid challenge model');
        error.statusCode = 400;
        throw error;
    }
    const code = String(affiliateCode || '').trim();
    const modelDiscounts = AFFILIATE_DISCOUNTS_CENTS[code];
    const discount = modelDiscounts?.[normalizedModel] || 0;
    const finalAmount = Math.max(original - discount, 0);
    return {
        model: normalizedModel,
        originalAmountCents: original,
        discountAmountCents: discount,
        finalAmountCents: finalAmount,
        currency: PAYMENT_CURRENCY,
        affiliateApplied: Boolean(discount)
    };
}

app.post('/api/payments/quote', authenticateToken, async (req, res) => {
    try {
        const pricing = calculateServerPrice(req.body.model, req.body.affiliate_code);
        res.json({ success: true, pricing });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Unable to calculate price' });
    }
});

app.post('/api/payments/create-order', authenticateToken, async (req, res) => {
    if (!razorpay) {
        return res.status(503).json({ error: 'Payment gateway is not configured on the server' });
    }
    const model = String(req.body.model || '').trim().toLowerCase();
    const affiliateCode = String(req.body.affiliate_code || '').trim();
    try {
        const pricing = calculateServerPrice(model, affiliateCode);
        const [users] = await db.execute('SELECT id, email, legal_name FROM users WHERE id = ? LIMIT 1', [req.userId]);
        if (!users.length) return res.status(404).json({ error: 'User not found' });
        const receipt = `FXT_${req.userId}_${Date.now()}`.slice(0, 40);
        const razorpayOrder = await razorpay.orders.create({
            amount: pricing.finalAmountCents,
            currency: pricing.currency,
            receipt,
            notes: {
                user_id: String(req.userId),
                model: pricing.model,
                affiliate_code: affiliateCode || 'none'
            }
        });
        await db.execute(
            `INSERT INTO payment_orders
             (user_id, provider, provider_order_id, model, affiliate_code,
              original_amount_cents, discount_amount_cents, final_amount_cents, currency, status)
             VALUES (?, 'razorpay', ?, ?, ?, ?, ?, ?, ?, 'created')`,
            [req.userId, razorpayOrder.id, pricing.model, affiliateCode || null, pricing.originalAmountCents, pricing.discountAmountCents, pricing.finalAmountCents, pricing.currency]
        );
        res.json({ success: true, key_id: process.env.RAZORPAY_KEY_ID, order_id: razorpayOrder.id, amount: pricing.finalAmountCents, currency: pricing.currency, pricing });
    } catch (error) {
        console.error('Create order error:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Unable to create payment order' });
    }
});

function verifyRazorpaySignature(orderId, paymentId, signature) {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature || ''), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function generateAccountCode() {
    return `ACC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

app.post('/api/payments/verify', authenticateToken, async (req, res) => {
    if (!razorpay) {
        return res.status(503).json({ error: 'Payment gateway is not configured on the server' });
    }
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Incomplete payment verification data' });
    }
    const connection = await db.getConnection();
    try {
        const [orderRows] = await connection.execute('SELECT * FROM payment_orders WHERE provider_order_id = ? AND user_id = ? LIMIT 1', [razorpay_order_id, req.userId]);
        if (!orderRows.length) return res.status(404).json({ error: 'Payment order not found' });
        const paymentOrder = orderRows[0];
        if (paymentOrder.status === 'paid') {
            return res.json({ success: true, already_verified: true, account_code: paymentOrder.account_code, order_id: paymentOrder.provider_order_id });
        }
        if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
            await connection.execute('UPDATE payment_orders SET status = ? WHERE id = ? AND status = ?', ['failed', paymentOrder.id, 'created']);
            return res.status(400).json({ error: 'Payment signature verification failed' });
        }
        const providerOrder = await razorpay.orders.fetch(razorpay_order_id);
        const providerPayment = await razorpay.payments.fetch(razorpay_payment_id);
        if (String(providerOrder.id) !== String(paymentOrder.provider_order_id) || Number(providerOrder.amount) !== Number(paymentOrder.final_amount_cents) || String(providerOrder.currency).toUpperCase() !== String(paymentOrder.currency).toUpperCase()) {
            await connection.execute('UPDATE payment_orders SET status = ? WHERE id = ? AND status = ?', ['failed', paymentOrder.id, 'created']);
            return res.status(400).json({ error: 'Payment amount or currency does not match the server order' });
        }
        if (String(providerPayment.order_id) !== String(paymentOrder.provider_order_id) || Number(providerPayment.amount) !== Number(paymentOrder.final_amount_cents) || String(providerPayment.currency).toUpperCase() !== String(paymentOrder.currency).toUpperCase()) {
            await connection.execute('UPDATE payment_orders SET status = ? WHERE id = ? AND status = ?', ['failed', paymentOrder.id, 'created']);
            return res.status(400).json({ error: 'Payment provider amount verification failed' });
        }
        if (String(providerPayment.status) !== 'captured') {
            return res.status(400).json({ error: `Payment is not captured. Current status: ${providerPayment.status}` });
        }
        await connection.beginTransaction();
        const [lockedRows] = await connection.execute('SELECT * FROM payment_orders WHERE id = ? FOR UPDATE', [paymentOrder.id]);
        const lockedPayment = lockedRows[0];
        if (lockedPayment.status === 'paid') {
            await connection.commit();
            return res.json({ success: true, already_verified: true, account_code: lockedPayment.account_code, order_id: lockedPayment.provider_order_id });
        }
        const accountCode = generateAccountCode();
        await connection.execute('INSERT INTO accounts (user_id, account_code) VALUES (?, ?)', [req.userId, accountCode]);
        await connection.execute('UPDATE payment_orders SET provider_payment_id = ?, status ='paid', account_code = ?, paid_at = NOW() WHERE id = ?', [razorpay_payment_id, accountCode, paymentOrder.id]);
        await connection.commit();
        res.json({ success: true, message: 'Payment verified and challenge activated', account_code: accountCode, order_id: razorpay_order_id, payment_id: razorpay_payment_id });
    } catch (error) { // Fix added above
        try { await connection.rollback(); } catch (_) {}
        console.error('Verify payment error:', error.message);
        res.status(500).json({ error: 'Unable to verify payment' });
    } finally {
        connection.release();
    }
});

app.get('/api/payments', authenticateToken, async (req, res) => {
    try {
        const [payments] = await db.execute(
            `SELECT
                created_at AS date,
                provider_order_id AS order_id,
                final_amount_cents,
                currency,
                status,
                account_code,
                provider_payment_id
             FROM payment_orders
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [req.userId]
        );
        res.json({
            payments: payments.map(p => ({
                date: p.date,
                order_id: p.order_id,
                amount: Number(p.final_amount_cents) / 100,
                currency: p.currency,
                status: p.status,
                account_code: p.account_code,
                payment_id: p.provider_payment_id
            }))
        });
    } catch (error) {
        console.error('Payments error:', error.message);
        res.status(500).json({ error: 'Unable to load payment history' });
    }
});
