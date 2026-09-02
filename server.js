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
// Ab yeh email user ko nahi, ADMIN ko jayegi (Manual Support ke liye)
async function sendOTPEmail(userEmail, otp) {
    const ADMIN_EMAIL = 'support.fundfxt@gmail.com'; // Yahan apna Admin email daalo!
    
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
            to: [ADMIN_EMAIL], // Email ADMIN ko jayegi, user ko nahi!
            subject: subject,
            html: html
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Resend API Error');
    }
}

// ========== DIRECT REGISTRATION (NO OTP) ==========
app.post('/api/register', async (req, res) => {
    const { trader_id, email, phone, password, legal_name, address } = req.body;
    try {
        const [existing] = await db.execute('SELECT * FROM users WHERE trader_id = ? OR email = ?', [trader_id, email]);
        if (existing.length) return res.status(400).json({ error: 'User already exists' });

        const hashed = await bcrypt.hash(password, 10);
        // is_verified = 1 (TRUE) se direct user banao
        const [result] = await db.execute(
            'INSERT INTO users (trader_id, email, phone, password_hash, legal_name, address, is_verified) VALUES (?, ?, ?, ?, ?, ?, 1)',
            [trader_id, email, phone, hashed, legal_name, address]
        );

        const accountCode = 'ACC-' + Date.now();
        await db.execute('INSERT INTO accounts (user_id, account_code) VALUES (?, ?)', [result.insertId, accountCode]);

        const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ success: true, token, account_code: accountCode });
    } catch (error) {
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
        const [result] = await db.execute(
            'INSERT INTO users (trader_id, email, phone, password_hash, legal_name, address) VALUES (?, ?, ?, ?, ?, ?)',
            [trader_id, email, phone, hashed, legal_name, address]
        );

        const accountCode = 'ACC-' + Date.now();
        await db.execute('INSERT INTO accounts (user_id, account_code) VALUES (?, ?)', [result.insertId, accountCode]);

        await db.execute('DELETE FROM email_verifications WHERE email = ?', [email]);
        
        const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ success: true, token, account_code: accountCode });
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

// ========== FORGOT PASSWORD (AB OTP ADMIN KO JAYEGI) ==========
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (!rows.length) return res.status(400).json({ error: 'Email not found' });
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await db.execute('INSERT INTO email_verifications (email, otp, expires_at) VALUES (?, ?, ?)', [email, otp, expiresAt]);
        
        // Ab email user ko nahi, ADMIN ko jayegi
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
        const [rows] = await db.execute(
            'SELECT legal_name, email, phone, address FROM users WHERE email = ?', 
            [email]
        );
        
        if (rows.length > 0) {
            const user = rows[0];
            res.json({ 
                exists: true, 
                name: user.legal_name, 
                phone: user.phone, 
                address: user.address 
            });
        } else {
            res.json({ exists: false });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});
