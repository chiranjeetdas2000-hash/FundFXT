const API='https://fundfxt.onrender.com';
const $=id=>document.getElementById(id);
const msg=(text,ok=false)=>{const e=$('msg');e.textContent=text;e.className='msg show '+(ok?'ok':'err')};
const setLoading=(id,on)=>$(id)?.classList.toggle('loading',on);

function switchMode(mode){const login=mode==='login';$('loginTab').classList.toggle('active',login);$('registerTab').classList.toggle('active',!login);$('loginBox').style.display=login?'block':'none';$('registerBox').style.display=login?'none':'block';$('msg').className='msg';window.requestAnimationFrame(()=>document.querySelector(login?'#loginBox':'#registerBox')?.classList.add('auth-pane'))}
$('loginTab').onclick=()=>switchMode('login');
$('registerTab').onclick=()=>switchMode('register');

document.querySelectorAll('.toggle-pass').forEach(btn=>btn.onclick=()=>{const input=$(btn.dataset.target);const visible=input.type==='text';input.type=visible?'password':'text';btn.textContent=visible?'SHOW':'HIDE'});

function passwordScore(value){let score=0;if(value.length>=8)score++;if(/[A-Z]/.test(value))score++;if(/[a-z]/.test(value))score++;if(/\d/.test(value))score++;if(/[^A-Za-z0-9]/.test(value))score++;return score}
function updatePassword(){const value=$('rPass').value;const score=passwordScore(value);const width=[0,20,40,60,80,100][score];const bar=$('passwordBar');bar.style.width=width+'%';bar.style.background=score<=2?'var(--red)':score===3?'#d7a83c':'var(--green)';$('passwordText').textContent=!value?'Use 8+ characters':'Strength: '+(score<=2?'Weak':score===3?'Good':score===4?'Strong':'Excellent')}
$('rPass').addEventListener('input',updatePassword);

async function login(){const identifier=$('loginId').value.trim(),password=$('loginPass').value;if(!identifier||!password)return msg('Enter your Trader ID/email and password.');setLoading('loginSubmit',true);try{const r=await fetch(API+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,password})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Login failed');localStorage.setItem('fundfxt_token',d.token);msg('Login successful. Opening dashboard…',true);setTimeout(()=>location.href='dashboard.html',450)}catch(e){msg(e.message)}finally{setLoading('loginSubmit',false)}}

async function registerUser(){const body={trader_id:$('rTrader').value.trim(),legal_name:$('rName').value.trim(),email:$('rEmail').value.trim(),phone:$('rPhone').value.trim(),password:$('rPass').value,address:$('rAddress').value.trim()||undefined,referred_by_code:$('rReferral').value.trim()||undefined};if(!body.trader_id||!body.legal_name||!body.email||!body.phone||!body.password)return msg('Please complete all required fields.');if(!/^\S+@\S+\.\S+$/.test(body.email))return msg('Enter a valid email address.');if(body.password.length<8)return msg('Password must contain at least 8 characters.');setLoading('registerSubmit',true);try{const r=await fetch(API+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Registration failed');localStorage.setItem('fundfxt_token',d.token);if(d.affiliate_code)localStorage.setItem('fundfxt_affiliate_code',d.affiliate_code);msg('Account created successfully. Opening dashboard…',true);setTimeout(()=>location.href='dashboard.html',500)}catch(e){msg(e.message)}finally{setLoading('registerSubmit',false)}}

$('loginForm').addEventListener('submit',e=>{e.preventDefault();login()});$('registerForm').addEventListener('submit',e=>{e.preventDefault();registerUser()});
$('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')login()});

document.querySelectorAll('input').forEach(input=>input.addEventListener('blur',()=>{if(input.required&&input.value.trim()==='')input.classList.add('invalid');else input.classList.remove('invalid')}));
