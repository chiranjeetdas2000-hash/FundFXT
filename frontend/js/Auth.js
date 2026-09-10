const API = 'https://fundfxt.onrender.com';

const $ = (id) => document.getElementById(id);

const showMessage = (text, ok = false) => {
    const element = $('msg');
    element.textContent = text;
    element.className = `msg show ${ok ? 'ok' : 'err'}`;
};

const setLoading = (id, loading) => {
    $(id)?.classList.toggle('loading', loading);
};

const switchMode = (mode) => {
    const login = mode === 'login';
    const register = mode === 'register';
    const reset = mode === 'reset';

    $('loginTab').classList.toggle('active', login);
    $('registerTab').classList.toggle('active', register);

    $('loginBox').style.display = login ? 'block' : 'none';
    $('registerBox').style.display = register ? 'block' : 'none';
    $('resetBox').style.display = reset ? 'block' : 'none';
    $('authTabs').style.display = reset ? 'none' : 'grid';
    $('msg').className = 'msg';
};

$('loginTab').onclick = () => switchMode('login');
$('registerTab').onclick = () => switchMode('register');
$('forgotButton').onclick = () => switchMode('reset');
$('resetBack').onclick = () => switchMode('login');

document.querySelectorAll('.toggle-pass').forEach((button) => {
    button.onclick = () => {
        const input = $(button.dataset.target);
        const visible = input.type === 'text';

        input.type = visible ? 'password' : 'text';
        button.textContent = visible ? 'SHOW' : 'HIDE';
    };
});

const passwordScore = (value) => {
    let score = 0;

    if (value.length >= 8) score += 1;
    if (/[A-Z]/.test(value)) score += 1;
    if (/[a-z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;

    return score;
};

const updatePasswordStrength = () => {
    const value = $('rPass').value;
    const score = passwordScore(value);
    const width = [0, 20, 40, 60, 80, 100][score];
    const bar = $('passwordBar');

    bar.style.width = `${width}%`;
    bar.style.background = score <= 2
        ? 'var(--red)'
        : score === 3
            ? '#d7a83c'
            : 'var(--green)';

    $('passwordText').textContent = !value
        ? 'Use 8+ characters'
        : `Strength: ${score <= 2 ? 'Weak' : score === 3 ? 'Good' : score === 4 ? 'Strong' : 'Excellent'}`;
};

$('rPass').addEventListener('input', updatePasswordStrength);

const apiRequest = async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }

    return data;
};

const login = async () => {
    const identifier = $('loginId').value.trim();
    const password = $('loginPass').value;

    if (!identifier || !password) {
        showMessage('Enter your Trader ID/email and password.');
        return;
    }

    setLoading('loginSubmit', true);

    try {
        const data = await apiRequest('/api/login', {
            method: 'POST',
            body: JSON.stringify({ identifier, password })
        });

        localStorage.setItem('fundfxt_token', data.token);
        showMessage('Login successful. Opening dashboard…', true);

        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 450);
    } catch (error) {
        showMessage(error.message);
    } finally {
        setLoading('loginSubmit', false);
    }
};

const registerUser = async () => {
    const body = {
        trader_id: $('rTrader').value.trim(),
        legal_name: $('rName').value.trim(),
        email: $('rEmail').value.trim(),
        phone: $('rPhone').value.trim(),
        password: $('rPass').value,
        address: $('rAddress').value.trim() || undefined,
        referred_by_code: $('rReferral').value.trim() || undefined
    };

    if (!body.trader_id || !body.legal_name || !body.email || !body.phone || !body.password) {
        showMessage('Please complete all required fields.');
        return;
    }

    if (!/^\S+@\S+\.\S+$/.test(body.email)) {
        showMessage('Enter a valid email address.');
        return;
    }

    if (body.password.length < 8) {
        showMessage('Password must contain at least 8 characters.');
        return;
    }

    setLoading('registerSubmit', true);

    try {
        const data = await apiRequest('/api/register', {
            method: 'POST',
            body: JSON.stringify(body)
        });

        localStorage.setItem('fundfxt_token', data.token);

        if (data.affiliate_code) {
            localStorage.setItem('fundfxt_affiliate_code', data.affiliate_code);
        }

        showMessage('Account created successfully. Opening dashboard…', true);

        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 500);
    } catch (error) {
        showMessage(error.message);
    } finally {
        setLoading('registerSubmit', false);
    }
};

let resetToken = '';

const resetSteps = (step) => {
    $('resetStep1').style.display = step === 1 ? 'block' : 'none';
    $('resetStep2').style.display = step === 2 ? 'block' : 'none';
    $('resetStep3').style.display = step === 3 ? 'block' : 'none';
};

const requestResetCode = async () => {
    const email = $('resetEmail').value.trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        showMessage('Enter the registered email address.');
        return;
    }

    setLoading('sendOtp', true);

    try {
        const data = await apiRequest('/api/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email })
        });

        resetToken = data.reset_token || '';

        if (!resetToken) {
            throw new Error('Reset session could not be created.');
        }

        resetSteps(2);
        showMessage('Reset code requested. Enter the OTP from the FundFXT reset process.', true);
    } catch (error) {
        showMessage(error.message);
    } finally {
        setLoading('sendOtp', false);
    }
};

const verifyResetCode = async () => {
    const email = $('resetEmail').value.trim();
    const otp = $('resetOtp').value.trim();

    if (!/^\d{6}$/.test(otp)) {
        showMessage('Enter the 6-digit OTP.');
        return;
    }

    setLoading('verifyOtp', true);

    try {
        await apiRequest('/api/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ email, otp })
        });

        resetSteps(3);
        showMessage('OTP verified. Set your new password.', true);
    } catch (error) {
        showMessage(error.message);
    } finally {
        setLoading('verifyOtp', false);
    }
};

const resetPassword = async () => {
    const email = $('resetEmail').value.trim();
    const otp = $('resetOtp').value.trim();
    const password = $('newPass').value;
    const confirmation = $('newPass2').value;

    if (password.length < 8) {
        showMessage('New password must contain at least 8 characters.');
        return;
    }

    if (password !== confirmation) {
        showMessage('Passwords do not match.');
        return;
    }

    if (!resetToken) {
        showMessage('Reset session expired. Start again.');
        resetSteps(1);
        return;
    }

    setLoading('resetPass', true);

    try {
        await apiRequest('/api/reset-password', {
            method: 'POST',
            body: JSON.stringify({
                email,
                otp,
                password,
                reset_token: resetToken
            })
        });

        resetToken = '';
        resetSteps(1);
        switchMode('login');
        $('loginId').value = email;
        showMessage('Password updated successfully. You can now log in.', true);
    } catch (error) {
        showMessage(error.message);
    } finally {
        setLoading('resetPass', false);
    }
};

$('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    login();
});

$('registerForm').addEventListener('submit', (event) => {
    event.preventDefault();
    registerUser();
});

$('sendOtp').onclick = requestResetCode;
$('verifyOtp').onclick = verifyResetCode;
$('resetPass').onclick = resetPassword;

$('loginPass').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        login();
    }
});

document.querySelectorAll('input').forEach((input) => {
    input.addEventListener('blur', () => {
        if (input.required && input.value.trim() === '') {
            input.classList.add('invalid');
        } else {
            input.classList.remove('invalid');
        }
    });
});
