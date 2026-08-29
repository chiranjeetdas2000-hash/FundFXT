// ============ TOGGLE LOGIC ============
const container = document.getElementById('container');
const registerBtn = document.querySelector('.register-btn');
const loginBtn = document.querySelector('.login-btn');

registerBtn.addEventListener('click', () => {
    container.classList.add('active');
});

loginBtn.addEventListener('click', () => {
    container.classList.remove('active');
});

// ============ FORGET PASSWORD LOGIC ============
const forgetOverlay = document.getElementById('forgetOverlay');
const forgotLink = document.getElementById('forgotLink');

// Open forget password (login/register forms hide honge)
forgotLink.addEventListener('click', function(e) {
    e.preventDefault();
    container.classList.add('hide-forms');
    forgetOverlay.style.display = 'flex';
});

// Close forget password (wapas login/register par)
function closeForgetPassword() {
    container.classList.remove('hide-forms');
    forgetOverlay.style.display = 'none';
}

// Step 1: Send OTP
async function sendOTP() {
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('fp_email').value })
        });
        const data = await response.json();
        if (data.success) {
            console.log('OTP:', data.otp);
            alert('OTP sent to your email! (Check console)');
            document.getElementById('step1').style.display = 'none';
            document.getElementById('step2').style.display = 'block';
        } else {
            alert(data.error || 'Email not found');
        }
    } catch (error) {
        alert('Server connection error!');
    }
}

// Step 2: Verify OTP
async function verifyOTP() {
    try {
        const response = await fetch('http://localhost:3000/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('fp_email').value, otp: document.getElementById('fp_otp').value })
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('step2').style.display = 'none';
            document.getElementById('step3').style.display = 'block';
        } else {
            alert(data.error || 'Invalid OTP');
        }
    } catch (error) {
        alert('Server connection error!');
    }
}

// Step 3: Reset Password
async function resetPassword() {
    const newPass = document.getElementById('fp_new_password').value;
    const confirmPass = document.getElementById('fp_confirm_password').value;
    
    if (newPass !== confirmPass) {
        alert('Passwords do not match!');
        return;
    }
    
    try {
        const response = await fetch('https://fundfxt.onrender.com/api/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('fp_email').value, password: newPass })
        });
        const data = await response.json();
        if (data.success) {
            alert('Password reset successfully!');
            closeForgetPassword();
        } else {
            alert(data.error || 'Password reset failed!');
        }
    } catch (error) {
        alert('Server connection error!');
    }
}

// ============ PASSWORD VIEW/HIDE ============
function togglePassword(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// ============ REGISTER BACKEND ============
async function handleRegister(event) {
    event.preventDefault();
    const trader_id = document.getElementById('reg_username').value;
    const email = document.getElementById('reg_email').value;
    const password = document.getElementById('reg_password').value;

    try {
        const response = await fetch('https://fundfxt.onrender.com/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trader_id, email, phone: '', password })
        });
        const data = await response.json();
        if (data.success) {
            localStorage.setItem('fundfxt_token', data.token);
            alert('Registration Successful!');
            window.location.href = '/dashboard.html';
        } else {
            alert(data.error || 'Registration failed!');
        }
    } catch (error) {
        alert('Server connection error!');
    }
}

// ============ LOGIN BACKEND ============
async function handleLogin(event) {
    event.preventDefault();
    const identifier = document.getElementById('login_username').value;
    const password = document.getElementById('login_password').value;
    const trimmedPassword = password.trim();

    try {
        const response = await fetch('https://fundfxt.onrender.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password: trimmedPassword })
        });
        const data = await response.json();
        if (data.success) {
            localStorage.setItem('fundfxt_token', data.token);
            alert('Login Successful!');
            window.location.href = '/dashboard.html';
        } else {
            alert(data.error || 'Login failed!');
        }
    } catch (error) {
        alert('Server connection error!');
    }
}
