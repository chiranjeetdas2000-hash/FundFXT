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

// ========== EMAIL (RESEND) - FIXED ==========
async function sendEmail(to, subject, html) {
    const API_KEY = process.env.EMAIL_PASS;
    const FROM_EMAIL = process.env.EMAIL_USER || "onboarding@resend.dev";
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
    });
    if (!response.ok) throw new Error('Email API Error: ' + response.status);
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

// ========== FORGOT PASSWORD (OTP hashed) ==========
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
        // Send OTP to admin (support@fundfxt) - or directly to user if you prefer
        await sendEmail('support.fundfxt@gmail.com', `Password Reset OTP for ${email}`, 
            `<h2>FundFXT Password Reset</h2><p>User Email: ${email}</p><p>OTP: <b>${otp}</b></p>`)
            .catch(err => console.log('Email failed:', err.message));
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

app.post('/api/payments/request', authenticateToken, async (req, res) => {
    const { model, affiliate_code, email } = req.body;
    try {
        const [users] = await db.execute('SELECT id, legal_name, email, phone FROM users WHERE id = ?', [req.userId]);
        if (!users.length) return res.status(404).json({ error: 'User not found' });
        const user = users[0];

        const pricing = await calculateServerPrice(model, affiliate_code);
        const requestRef = generateRequestRef();

        let affiliateName = null;
        let affiliateCodeUsed = affiliate_code;
        if (pricing.affiliateApplied && pricing.affiliate_user_id) {
            const [affiliateUsers] = await db.execute('SELECT legal_name FROM users WHERE id = ?', [pricing.affiliate_user_id]);
            if (affiliateUsers.length) affiliateName = affiliateUsers[0].legal_name;
        }

        await db.execute(
            `INSERT INTO payment_orders 
             (order_ref, user_id, provider, model, affiliate_code, affiliate_id, original_amount_cents, discount_amount_cents, final_amount_cents, currency, status, created_at) 
             VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', NOW())`,
            [requestRef, req.userId, pricing.model, affiliate_code || null, pricing.affiliate_user_id || null, 
             pricing.originalAmountCents, pricing.discountAmountCents, pricing.finalAmountCents, pricing.currency]
        );

        // Admin ko email bhejo (Full Details)
        const adminEmail = 'support.fundfxt@gmail.com';
        const subject = `New Payment Request: ${requestRef}`;
        const html = `
            <h2 style="color:#00b56a;">📥 New Payment Request</h2>
            <p><strong>Request ID:</strong> ${requestRef}</p>
            <hr>
            <h3>User Details</h3>
            <p><strong>Name:</strong> ${user.legal_name}</p>
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Phone:</strong> ${user.phone}</p>
            <hr>
            <h3>Order Details</h3>
            <p><strong>Challenge:</strong> ${pricing.model}</p>
            <p><strong>Original Amount:</strong> $${(pricing.originalAmountCents / 100).toFixed(2)}</p>
            <p><strong>Discount:</strong> $${(pricing.discountAmountCents / 100).toFixed(2)}</p>
            <p style="font-size:20px; font-weight:bold; color:#00b56a;"><strong>Final Amount (Payment Link):</strong> $${(pricing.finalAmountCents / 100).toFixed(2)}</p>
            <hr>
            <h3>Affiliate Information</h3>
            <p><strong>Code Used:</strong> ${affiliateCodeUsed || 'None'}</p>
            <p><strong>Affiliate Name:</strong> ${affiliateName || 'N/A'}</p>
            <hr>
            <p>Please create a Razorpay Payment Link for <strong>$${(pricing.finalAmountCents / 100).toFixed(2)}</strong> and send it to ${user.email}.</p>
        `;
        
        await sendEmail(adminEmail, subject, html).catch(err => console.log('Email failed:', err.message));

        res.json({ success: true, request_ref: requestRef, message: 'Payment request created. You will receive a payment link via email shortly.', pricing });
    } catch (error) {
        console.error('Payment request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ADMIN AUTH ==========
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

// ========== ADMIN ROUTES ==========

// Get all users
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const [users] = await db.query('SELECT id, trader_id, legal_name, email, phone, kyc_status, is_verified, affiliate_code, created_at FROM users ORDER BY created_at DESC');
        res.json({ success: true, users });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Approve KYC
app.post('/api/admin/users/:id/verify-kyc', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute("UPDATE users SET kyc_status = 'APPROVED' WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Reset password
app.post('/api/admin/users/:id/reset-password', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password required' });
    try {
        const hashed = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Get payment orders
app.get('/api/admin/payment-orders', authenticateAdmin, async (req, res) => {
    const { status } = req.query;
    let query = `SELECT po.*, u.legal_name, u.email as user_email FROM payment_orders po JOIN users u ON po.user_id = u.id`;
    let params = [];
    if (status) {
        query += ` WHERE po.status = ?`;
        params.push(status);
    }
    query += ` ORDER BY po.created_at DESC`;
    try {
        const [orders] = await db.execute(query, params);
        res.json({ success: true, orders });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Update payment order status (with auto affiliate commission)
app.post('/api/admin/payment-orders/:id/status', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [orders] = await connection.execute('SELECT * FROM payment_orders WHERE id = ? FOR UPDATE', [id]);
        if (!orders.length) throw new Error('Order not found');
        const order = orders[0];

        await connection.execute('UPDATE payment_orders SET status = ? WHERE id = ?', [status, id]);

        // If payment done/approved, add affiliate commission
        if ((status === 'PAYMENT_DONE' || status === 'PAYMENT_APPROVED') && order.affiliate_code) {
            const [affiliateRows] = await connection.execute(
                'SELECT a.id AS affiliate_id, a.user_id FROM affiliates a JOIN users u ON u.id = a.user_id WHERE u.affiliate_code = ? LIMIT 1',
                [order.affiliate_code]
            );
            if (affiliateRows.length > 0) {
                const affiliate = affiliateRows[0];
                const commissionCents = Math.floor((order.final_amount_cents * 0.20) + 100);
                const [existingComm] = await connection.execute('SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1', [id]);
                if (existingComm.length === 0) {
                    await connection.execute(
                        `INSERT INTO affiliate_commissions (affiliate_id, order_id, referred_user_id, model, commission_amount_cents, status) 
                         VALUES (?, ?, ?, ?, ?, 'PENDING')`,
                        [affiliate.affiliate_id, id, order.user_id, order.model, commissionCents]
                    );
                    await connection.execute(
                        `UPDATE affiliates SET total_sales = total_sales + 1, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?`,
                        [commissionCents, affiliate.affiliate_id]
                    );
                }
            }
        }

        await connection.commit();
        res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// Get payment requests (for dashboard)
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

// Reject payment request
app.post('/api/admin/payment-requests/:id/reject', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute("UPDATE payment_orders SET status = 'REJECTED' WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Mark link sent
app.post('/api/admin/payment-requests/:id/mark-link-sent', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { payment_link } = req.body;
    try {
        await db.execute('UPDATE payment_orders SET status = "LINK_SENT", payment_link = ? WHERE id = ?', [payment_link || null, id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Get withdrawals
app.get('/api/admin/withdrawals', authenticateAdmin, async (req, res) => {
    try {
        const [withdrawals] = await db.query(`
            SELECT pr.*, u.legal_name, u.email as user_email, a.account_code 
            FROM payout_requests pr 
            JOIN users u ON pr.user_id = u.id 
            LEFT JOIN accounts a ON pr.account_id = a.id 
            ORDER BY pr.created_at DESC
        `);
        res.json({ success: true, withdrawals });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Update withdrawal status
app.post('/api/admin/withdrawals/:id/status', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.execute('UPDATE payout_requests SET status = ? WHERE id = ?', [status, id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Get affiliates
app.get('/api/admin/affiliates', authenticateAdmin, async (req, res) => {
    try {
        const [affiliates] = await db.query(`
            SELECT a.*, u.legal_name, u.email 
            FROM affiliates a JOIN users u ON a.user_id = u.id 
            ORDER BY a.total_earnings_cents DESC
        `);
        res.json({ success: true, affiliates });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Get certificates
app.get('/api/admin/certificates', authenticateAdmin, async (req, res) => {
    try {
        const [certs] = await db.query(`
            SELECT c.*, u.legal_name, a.account_code 
            FROM certificates c 
            JOIN users u ON c.user_id = u.id 
            LEFT JOIN accounts a ON c.account_id = a.id 
            ORDER BY c.issued_on DESC
        `);
        res.json({ success: true, certificates: certs });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Issue certificate
app.post('/api/admin/certificates/issue', authenticateAdmin, async (req, res) => {
    const { user_id, account_id, model, achievement } = req.body;
    try {
        const certRef = 'CERT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        await db.execute(
            'INSERT INTO certificates (certificate_ref, user_id, account_id, model, achievement, issued_on) VALUES (?, ?, ?, ?, ?, CURDATE())',
            [certRef, user_id, account_id, model, achievement]
        );
        res.json({ success: true, cert_ref: certRef });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== FCS LIVE MARKET DATA ==========
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
        // Ye code processLivePrices function ke andar, trade loop ke andar paste karo
const [accounts] = await db.execute('SELECT * FROM accounts WHERE id = ?', [trade.account_id]);
if (accounts.length > 0) {
    const account = accounts[0];
    const newEquity = account.balance_cents + floatingCents; // Balance + Floating P/L

    // ✅ ONLY for Direct Funded (Trailing): Update Equity HWM
    if (account.challenge_model === 'prototype_5k' && newEquity > account.equity_hwm_cents) {
        await db.execute('UPDATE accounts SET equity_hwm_cents = ? WHERE id = ?', [newEquity, account.id]);
    }

    // ✅ Update Current Equity
    await db.execute('UPDATE accounts SET equity_cents = ? WHERE id = ?', [newEquity, account.id]);

    // Check Risk
    const risk = await checkAccountRisk(account); // Reload updated account info if needed
    if (risk.breached) {
        await db.execute("UPDATE trades SET status = 'CLOSED', exit_time = NOW(), close_reason = 'BREACH' WHERE account_id = ? AND status = 'OPEN'", [account.id]);
    }
}
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
            await db.execute('INSERT INTO admin_users (email, name, password_hash, role) VALUES (?, ?, ?, ?)', [defaultEmail, 'FundFXT Admin', hashed, 'SUPER_ADMIN']);
            console.log('✅ Default admin created:', defaultEmail);
        }
    } catch (err) { console.error('Admin seed error:', err.message); }
})();

// ========== ADMIN CREATE ACCOUNT ==========
app.post('/api/admin/payment-orders/:id/create-account', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [orders] = await db.execute('SELECT * FROM payment_orders WHERE id = ?', [id]);
        if (!orders.length) return res.status(404).json({ error: 'Order not found' });
        const order = orders[0];

        const [configs] = await db.execute('SELECT * FROM challenge_configs WHERE model_key = ?', [order.model]);
        if (!configs.length) return res.status(404).json({ error: 'Challenge config not found' });
        const config = configs[0];

        // Generate unique Account Code
        const accountCode = 'ACC-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

        // Create the Trading Account
        await db.execute(
            `INSERT INTO accounts (account_code, user_id, challenge_model, phase, initial_balance_cents, balance_cents, equity_cents, status)
             VALUES (?, ?, ?, 'PHASE_1', ?, ?, ?, 'ACTIVE')`,
            [accountCode, order.user_id, order.model, config.starting_balance_cents, config.starting_balance_cents, config.starting_balance_cents]
        );

        // Update Payment Order Status
        await db.execute("UPDATE payment_orders SET status = 'ACCOUNT_CREATED', account_code = ? WHERE id = ?", [accountCode, id]);

        res.json({ success: true, account_code: accountCode });
    } catch (error) {
        console.error('Create account error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- GET USER ORDERS (Example) ----------
// GET User's Orders
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const [orders] = await db.execute(
            `SELECT order_ref, model, original_amount_cents, discount_amount_cents, final_amount_cents, currency, status, created_at
             FROM payment_orders
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [req.userId]
        );
        res.json({ success: true, orders });
    } catch (error) {
        console.error('Fetch user orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== GET DASHBOARD STATS (Complete Summary) ==========
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        // 1. User ke saare accounts fetch karo
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);

        // 2. User ke saare orders fetch karo
        const [orders] = await db.execute(
            `SELECT order_ref, model, final_amount_cents, status, created_at FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
            [req.userId]
        );

        // 3. Statistics calculate karo
        const totalAccounts = accounts.length;
        const activeAccounts = accounts.filter(a => a.status === 'ACTIVE').length;
        const passedAccounts = accounts.filter(a => a.status === 'PASSED').length;
        const failedAccounts = accounts.filter(a => ['BREACHED', 'EXPIRED', 'CLOSED'].includes(a.status)).length;
        const totalProfit = accounts.reduce((sum, a) => sum + (a.equity_cents - a.initial_balance_cents), 0) / 100;

        res.json({
            success: true,
            stats: {
                totalAccounts,
                activeAccounts,
                passedAccounts,
                failedAccounts,
                totalProfit: totalProfit.toFixed(2)
            },
            recentActivity: orders // Last 5 orders
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== WITHDRAWAL RULES & REQUEST ==========

// 1. Get Challenge Rules for a selected Account's Model
app.get('/api/challenges/:model', async (req, res) => {
    try {
        const [config] = await db.execute('SELECT * FROM challenge_configs WHERE model_key = ?', [req.params.model]);
        if (!config.length) return res.status(404).json({ error: 'Challenge not found' });
        res.json({ success: true, config: config[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Request Withdrawal (User submits form)
app.post('/api/withdrawals/request', authenticateToken, async (req, res) => {
    const { account_id, amount_cents, method, payment_address } = req.body;

    try {
        // Validate inputs
        if (!account_id || !amount_cents || !method || !payment_address) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Fetch Account and verify ownership
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [account_id, req.userId]);
        if (!accounts.length) return res.status(404).json({ error: 'Account not found' });
        const account = accounts[0];

        // Check Account Status
        if (account.status !== 'ACTIVE') {
            return res.status(400).json({ error: 'Account is not active for withdrawal' });
        }

        // Fetch Challenge Rules
        const [configs] = await db.execute('SELECT * FROM challenge_configs WHERE model_key = ?', [account.challenge_model]);
        if (!configs.length) return res.status(404).json({ error: 'Challenge rules not found' });
        const config = configs[0];

        // Check Payout Eligibility (Max Payout Count)
        if (config.max_payout_count && account.payout_count >= config.max_payout_count) {
            return res.status(400).json({ error: 'Max payout limit reached for this account' });
        }

        // Check Amount vs Equity (Can only withdraw profit)
        const profitCents = account.equity_cents - account.initial_balance_cents;
        if (amount_cents > profitCents) {
            return res.status(400).json({ error: 'Withdrawal amount exceeds current profit' });
        }

        // Generate Request Reference
        const requestRef = 'WD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

        // Create Payout Request
        await db.execute(
            `INSERT INTO payout_requests 
             (request_ref, user_id, kind, account_id, amount_cents, currency, method, payout_details, status, eligibility_snapshot, created_at) 
             VALUES (?, ?, 'TRADER_PROFIT', ?, ?, 'USD', ?, ?, 'PENDING', ?, NOW())`,
            [requestRef, req.userId, account_id, amount_cents, method, 
             JSON.stringify({ payment_address }), 
             JSON.stringify({ profit: profitCents, equity: account.equity_cents, balance: account.balance_cents })]
        );

        // Notify Admin via Email (Optional)
        const [users] = await db.execute('SELECT legal_name, email FROM users WHERE id = ?', [req.userId]);
        if (users.length) {
            await sendEmail('support.fundfxt@gmail.com', `New Withdrawal Request: ${requestRef}`, 
                `<h2>Withdrawal Request</h2><p>User: ${users[0].legal_name}</p><p>Account: ${account.account_code}</p><p>Amount: $${(amount_cents / 100).toFixed(2)}</p><p>Method: ${method}</p>`)
                .catch(err => console.log('Withdrawal email failed:', err.message));
        }

        res.json({ success: true, request_ref: requestRef });

    } catch (error) {
        console.error('Withdrawal request error:', error);
        res.status(500).json({ error: error.message });
    }
});
