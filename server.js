const WebSocket = require('ws');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer'); // ✅ Added
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// ==================== DATABASE ====================
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fundfxt',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

(async () => {
    try {
        await db.query('SELECT 1');
        console.log('✅ Database connected successfully!');
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
    }
})();

// ==================== EMAIL TRANSPORTER (Gmail) ====================
const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'support.fundfxt@gmail.com',
        pass: process.env.EMAIL_PASS, // App Password (16-digit)
    },
});

// ==================== SEND OTP EMAIL ====================
async function sendOTPEmail(to, otp, type = 'verification') {
    const subject = type === 'verification' ? 'Email Verification OTP' : 'Password Reset OTP';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #00b56a;">FundFXT</h2>
            <p>Your OTP for <strong>${type === 'verification' ? 'email verification' : 'password reset'}</strong> is:</p>
            <h1 style="font-size: 36px; color: #00b56a; letter-spacing: 4px;">${otp}</h1>
            <p style="color: #666;">This OTP is valid for <strong>10 minutes</strong>.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee;">
            <p style="color: #aaa; font-size: 11px;">FundFXT Support &bull; support.fundfxt@gmail.com</p>
        </div>
    `;
    await transporter.sendMail({
        from: `"FundFXT Support" <${process.env.EMAIL_USER || 'support.fundfxt@gmail.com'}>`,
        to,
        subject,
        html,
    });
}

// ==================== REGISTER API (with OTP) ====================
app.post('/api/register', async (req, res) => {
    const { trader_id, email, phone, password } = req.body;
    try {
        // Check existing user
        const [rows] = await db.execute('SELECT * FROM users WHERE trader_id = ? OR email = ?', [trader_id, email]);
        if (rows.length > 0) return res.status(400).json({ error: 'User already exists' });

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user (is_verified = FALSE by default)
        const [result] = await db.execute(
            'INSERT INTO users (trader_id, email, phone, password_hash) VALUES (?, ?, ?, ?)',
            [trader_id, email, phone, hashedPassword]
        );

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

        // Store OTP in email_verifications table
        await db.execute(
            'INSERT INTO email_verifications (email, otp, expires_at) VALUES (?, ?, ?)',
            [email, otp, expiresAt]
        );

        // Send OTP email
        await sendOTPEmail(email, otp, 'verification');

        // Create account entry
        const accountCode = 'ACC-' + Date.now();
        await db.execute('INSERT INTO accounts (user_id, account_code) VALUES (?, ?)', [result.insertId, accountCode]);

        // Generate JWT token (for auto-login after verification)
        const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'supersecretkey123', { expiresIn: '7d' });

        res.json({
            success: true,
            message: 'OTP sent to your email. Please verify.',
            token,
            account_code: accountCode,
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== VERIFY EMAIL OTP ====================
app.post('/api/verify-email', async (req, res) => {
    const { email, otp } = req.body;
    try {
        // Check OTP validity
        const [rows] = await db.execute(
            'SELECT * FROM email_verifications WHERE email = ? AND otp = ? AND expires_at > NOW()',
            [email, otp]
        );
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        // Mark user as verified
        await db.execute('UPDATE users SET is_verified = TRUE WHERE email = ?', [email]);

        // Delete used OTP
        await db.execute('DELETE FROM email_verifications WHERE email = ?', [email]);

        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== LOGIN API ====================
app.post('/api/login', async (req, res) => {
    const { identifier, password } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE trader_id = ? OR email = ?', [identifier, identifier]);
        if (rows.length === 0) return res.status(400).json({ error: 'User not found' });

        const user = rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.status(400).json({ error: 'Invalid password' });

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'supersecretkey123', { expiresIn: '7d' });
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== AUTH MIDDLEWARE ====================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey123', (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.userId = decoded.userId;
        next();
    });
}

// ==================== GET ALL ACCOUNTS ====================
app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const [accounts] = await db.execute('SELECT * FROM accounts WHERE user_id = ?', [req.userId]);
        res.json({ accounts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FORGET PASSWORD (Send OTP via Email) ====================
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) return res.status(400).json({ error: 'Email not found' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Store OTP in email_verifications table (reuse)
        await db.execute(
            'INSERT INTO email_verifications (email, otp, expires_at) VALUES (?, ?, ?)',
            [email, otp, expiresAt]
        );

        // Send OTP email
        await sendOTPEmail(email, otp, 'reset');

        res.json({ success: true, message: 'OTP sent to your email' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== VERIFY OTP (for password reset) ====================
app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const [rows] = await db.execute(
            'SELECT * FROM email_verifications WHERE email = ? AND otp = ? AND expires_at > NOW()',
            [email, otp]
        );
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== RESET PASSWORD ====================
app.post('/api/reset-password', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.execute('UPDATE users SET password_hash = ? WHERE email = ?', [hashedPassword, email]);
        // Delete OTP entries
        await db.execute('DELETE FROM email_verifications WHERE email = ?', [email]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== CHANGE PASSWORD (Dashboard) ====================
app.post('/api/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.userId]);
        if (rows.length === 0) return res.status(400).json({ error: 'User not found' });

        const user = rows[0];
        const isValid = await bcrypt.compare(oldPassword, user.password_hash);
        if (!isValid) return res.status(400).json({ error: 'Old password is incorrect' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, req.userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FCS API WEBSOCKET (Live Prices) ====================
const fcsApiKey = process.env.FCS_API_KEY;
let fcsSocket = null;

if (fcsApiKey) {
    fcsSocket = new WebSocket(`wss://ws-v4.fcsapi.com/ws?access_key=${fcsApiKey}`);

    fcsSocket.on('open', () => {
        console.log('✅ FCS API WebSocket Connected');
        const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
                         'EURGBP', 'EURJPY', 'EURCHF', 'EURCAD', 'GBPJPY', 'GBPCHF', 'GBPCAD',
                         'AUDJPY', 'AUDCAD', 'AUDCHF', 'CADJPY', 'CHFJPY', 'NZDJPY', 'NZDCAD', 'NZDCHF',
                         'XAUUSD', 'XAGUSD'];
        symbols.forEach(symbol => {
            fcsSocket.send(JSON.stringify({ action: 'subscribe', symbol: symbol }));
        });
    });

    fcsSocket.on('message', (data) => {
        // Forward to frontend WebSocket clients later
        const tick = JSON.parse(data.toString());
        // console.log('Live data:', tick); // optional
    });

    fcsSocket.on('error', (err) => {
        console.error('FCS WebSocket Error:', err);
    });
} else {
    console.warn('⚠️ FCS_API_KEY not set. WebSocket will use simulated data.');
}

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// ==================== FRONTEND WEBSOCKET (Browser) ====================
const wss = new WebSocket.Server({ server, path: '/ws' });

// Simulated price data (fallback)
const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
                 'EURGBP', 'EURJPY', 'EURCHF', 'EURCAD', 'GBPJPY', 'GBPCHF', 'GBPCAD',
                 'AUDJPY', 'AUDCAD', 'AUDCHF', 'CADJPY', 'CHFJPY', 'NZDJPY', 'NZDCAD', 'NZDCHF',
                 'XAUUSD', 'XAGUSD'];
let prices = {};

// Initialize with base rates
const baseRates = {
    EURUSD: 1.1234, GBPUSD: 1.3120, USDJPY: 148.50, USDCHF: 0.9140,
    AUDUSD: 0.6540, USDCAD: 1.3670, NZDUSD: 0.5970, EURGBP: 0.8560,
    EURJPY: 166.80, EURCHF: 1.0270, EURCAD: 1.5360, GBPJPY: 194.50,
    GBPCHF: 1.2000, GBPCAD: 1.7940, AUDJPY: 97.00, AUDCAD: 0.8940,
    AUDCHF: 0.5970, CADJPY: 108.70, CHFJPY: 162.50, NZDJPY: 88.70,
    NZDCAD: 0.8160, NZDCHF: 0.5460, XAUUSD: 2035.00, XAGUSD: 23.50
};

for (let sym of symbols) {
    const base = baseRates[sym] || 1.0;
    prices[sym] = { bid: base - 0.0001, ask: base + 0.0001, change: 0, changePercent: 0 };
}

// Update simulated prices every second
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
    // Broadcast to all frontend clients
    const message = JSON.stringify({ type: 'price', data: prices });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}, 1000);

// If FCS socket is available, forward its data instead
if (fcsSocket) {
    fcsSocket.on('message', (data) => {
        const tick = JSON.parse(data.toString());
        // Update prices from FCS if needed
        // Broadcast to clients
        const message = JSON.stringify({ type: 'price', data: prices });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });
}

wss.on('connection', (clientSocket) => {
    console.log('Frontend WebSocket client connected');
    // Send initial prices
    clientSocket.send(JSON.stringify({ type: 'price', data: prices }));
});
