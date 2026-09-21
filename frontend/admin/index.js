const API_BASE_URL = "https://fundfxt.onrender.com";
const token = localStorage.getItem("fundfxt_admin_token");
if (!token) location.href = "login.html";
let users = [], orders = [], selectedOrder = null, currentSection = "dashboard";
let currentWalletTransferStatus = 'PENDING';
const $ = (id) => document.getElementById(id);
const auth = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
const esc = (v) => String(v ?? "").replace(/[&<>\'\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;" })[c]);
const money = (c, cur = "USD") => `${String(cur).toUpperCase() === "USD" ? "$" : cur + " "}${(Number(c || 0) / 100).toFixed(2)}`;
const field = (o, ...names) => { for (const n of names) if (o && o[n] !== undefined && o[n] !== null && o[n] !== "") return o[n]; return ""; };
const orderRequestId = (o) => field(o, "request_id", "order_ref", "request_ref", "id");
const orderLink = (o) => field(o, "razorpay_link");
function toast(msg, type = "ok") { const t = $("toast"); if (!t) return alert(msg); t.textContent = msg; t.className = "toast show " + (type === "err" ? "err" : "ok"); clearTimeout(window.__toast); window.__toast = setTimeout(() => (t.className = "toast"), 3000); }
async function get(path) { const r = await fetch(API_BASE_URL + path, { headers: auth() }); let d = {}; try { d = await r.json(); } catch {} if (!r.ok) throw Error(d.error || d.message || `Request failed (${r.status})`); return d; }
async function post(path, body) { const r = await fetch(API_BASE_URL + path, { method: "POST", headers: auth(), body: JSON.stringify(body) }); let d = {}; try { d = await r.json(); } catch {} if (!r.ok) throw Error(d.error || d.message || `Request failed (${r.status})`); return d; }
function logout() { localStorage.removeItem("fundfxt_admin_token"); location.href = "login.html"; }
function toggleSidebar() { $("sidebar").classList.toggle("open"); }
function closeSidebarMobile() { $("sidebar").classList.remove("open"); }
function showSection(name) { currentSection = name; document.querySelectorAll(".view").forEach((x) => x.classList.remove("active")); const target = $("section-" + name); if (target) target.classList.add("active"); document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("active", x.dataset.section === name)); closeSidebarMobile(); const loaders = { dashboard: fetchDashboard, users: fetchUsers, orders: fetchOrders, withdrawals: fetchWithdrawals, affiliates: fetchAffiliates, certificates: fetchCertificates, support: fetchSupportTickets, settings: loadSettings, "wallet-transfers": loadWalletTransfers, "account-payouts": () => loadAccountPayouts("PENDING") }; if (loaders[name]) loaders[name](); }
function refreshCurrent() { showSection(currentSection); }
function setState(kind, loading = false, error = "") { const ids = { users: ["usersLoading", "usersEmpty", "usersError"], orders: ["ordersLoading", "ordersEmpty", "ordersError"], withdrawals: ["withdrawalsLoading", "withdrawalsEmpty", "withdrawalsError"], affiliates: ["affiliatesLoading", "affiliatesEmpty", "affiliatesError"], certificates: ["certificatesLoading", "certificatesEmpty", "certificatesError"], support: ["supportLoading", "supportEmpty", "supportError"] }[kind]; if (!ids) return; const [l,e,er]=ids; $(l).style.display=loading?"block":"none"; $(e).style.display="none"; $(er).innerHTML=error?`<div class="error-box">${esc(error)}</div>`:""; }
async function fetchDashboard(){try{const d=await get("/api/admin/dashboard-stats"),s=d.stats||{}; $("statPayments").textContent=s.payment_requests_today??0; $("statWithdrawals").textContent=s.withdrawal_requests_today??0; $("statPassed").textContent=s.passed_accounts_today??0; $("statFailed").textContent=s.failed_accounts_today??0; $("statRevenue").textContent=money(s.successful_revenue_cents);}catch(e){toast(e.message,"err");}}
async function fetchUsers(){setState("users",true);try{const d=await get("/api/admin/users");users=d.users||[];renderUsers();}catch(e){setState("users",false,e.message);}}
function renderUsers(){const q=($("userSearch").value||"").toLowerCase(),f=$("userFilter").value;const rows=users.filter(u=>(!f||String(u.kyc_status||"")===f)&&[u.id,u.legal_name,u.email,u.phone,u.trader_id,u.address,u.affiliate_code].some(v=>String(v??"").toLowerCase().includes(q)));$("usersBody").innerHTML=rows.map(u=>`<tr><td>${esc(u.id)}</td><td>${esc(u.trader_id)}</td><td><b>${esc(u.legal_name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td>${esc(u.address||"—")}</td><td><span class="badge ${String(u.kyc_status)==="APPROVED"?"green":"yellow"}">${esc(u.kyc_status||"—")}</span></td><td>${esc(u.affiliate_code||"—")}</td><td>${u.created_at?new Date(u.created_at).toLocaleString():"—"}</td></tr>`).join("");$("usersLoading").style.display="none";$("usersEmpty").style.display=rows.length?"none":"block";}
async function fetchOrders(){setState("orders",true);try{const q=($("paymentSearch").value||"").trim(),s=$("orderStatusFilter").value;let qs=[];if(q)qs.push("request_id="+encodeURIComponent(q));if(s)qs.push("status="+encodeURIComponent(s));const d=await get("/api/admin/payment-requests"+(qs.length?"?"+qs.join("&"):""));orders=d.requests||d.orders||[];renderOrders();}catch(e){setState("orders",false,e.message);}}
function clearPaymentSearch(){$("paymentSearch").value="";$ ("orderStatusFilter").value="";fetchOrders();}
function statusClass(s){return s==="PAYMENT_DONE"?"green":s==="REJECTED"||s==="CANCELLED"?"red":"yellow";}
function renderOrders(){const rows=orders||[];$("ordersBody").innerHTML=rows.map(o=>{const rid=orderRequestId(o),link=orderLink(o);let action="";if(o.status==="REQUESTED")action=`<button class="btn" onclick='openLink(${JSON.stringify(o)})'>Proceed</button>`;else if(["LINK_SENT","PAYMENT_PENDING"].includes(o.status))action=`<button class="btn secondary" onclick='openStatus(${JSON.stringify(o)})'>Verify / Update</button>`;else if(o.status==="PAYMENT_DONE")action=`<span class="badge green">${esc(field(o,"account_code")||"PAYMENT DONE")}</span>`;else action=`<button class="btn secondary" onclick='openStatus(${JSON.stringify(o)})'>Update</button>`;const linkHtml=link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" style="word-break:break-all">Open Link</a>`:"—";return `<tr><td><b>${esc(rid)}</b></td><td><b>${esc(field(o,"legal_name","name"))}</b><br><small>${esc(field(o,"user_email","email"))}</small></td><td>${esc(field(o,"model","model_key"))}</td><td>${esc(o.affiliate_code||"—")}<br><small>${esc(o.affiliate_name||"—")}</small></td><td>${money(o.original_amount_cents,o.currency)}</td><td>${money(o.discount_amount_cents,o.currency)}</td><td><b>${money(o.final_amount_cents,o.currency)}</b></td><td>${linkHtml}</td><td><span class="badge ${statusClass(o.status)}">${esc(o.status||"—")}</span></td><td>${action}</td></tr>`;}).join("");$("ordersLoading").style.display="none";$("ordersEmpty").style.display=rows.length?"none":"block";}
function openLink(o){selectedOrder=o;$("linkOrderInfo").innerHTML=`<b>Request ID:</b> ${esc(orderRequestId(o))}<br><b>Customer:</b> ${esc(field(o,"legal_name","name"))} (${esc(field(o,"user_email","email"))})<br><b>Challenge:</b> ${esc(field(o,"model","model_key"))}<br><b>Original:</b> ${money(o.original_amount_cents,o.currency)}<br><b>Discount:</b> ${money(o.discount_amount_cents,o.currency)}<br><b>Payable:</b> ${money(o.final_amount_cents,o.currency)}<br><b>Affiliate:</b> ${esc(o.affiliate_code||"—")} / ${esc(o.affiliate_name||"—")}`;$("paymentLinkInput").value=orderLink(o)||"";$("linkModal").classList.add("open");setTimeout(()=>$("paymentLinkInput").focus(),50);}
function closeLinkModal(){$("linkModal").classList.remove("open");selectedOrder=null;}
async function submitPaymentLink(){if(!selectedOrder)return;const link=$("paymentLinkInput").value.trim();if(!/^https:\/\//i.test(link))return toast("Enter a valid HTTPS Razorpay payment link.","err");try{const d=await post("/api/admin/payment-requests/"+selectedOrder.id+"/mark-link-sent",{razorpay_link:link});toast("Payment link saved and support email processed.");closeLinkModal();await fetchOrders();await fetchDashboard();if(d&&d.emailed_to)toast("Email sent to "+d.emailed_to);}catch(e){toast(e.message,"err");}}
function openStatus(o){selectedOrder=o;$("statusOrderInfo").innerHTML=`<b>Request ID:</b> ${esc(orderRequestId(o))}<br><b>Customer:</b> ${esc(field(o,"legal_name","name"))} (${esc(field(o,"user_email","email"))})<br><b>Challenge:</b> ${esc(field(o,"model","model_key"))}<br><b>Razorpay Link:</b> ${orderLink(o)?esc(orderLink(o)):"Not added"}<br><b>Payable:</b> ${money(o.final_amount_cents,o.currency)}<br><b>Current Status:</b> ${esc(o.status||"—")}`;$("statusModal").classList.add("open");}
function closeStatusModal(){$("statusModal").classList.remove("open");selectedOrder=null;}
async function setOrderStatus(s){if(!selectedOrder)return;if(!confirm("Set "+orderRequestId(selectedOrder)+" to "+s+"?"))return;try{await post("/api/admin/payment-requests/"+selectedOrder.id+"/status",{status:s});closeStatusModal();toast("Payment status updated.");await fetchOrders();await fetchDashboard();}catch(e){toast(e.message,"err");}}
let currentWithdrawalStatus = 'PENDING';
function setWithdrawalFilter(status) {
    currentWithdrawalStatus = status;
    ['PENDING','APPROVED','REJECTED'].forEach((s) => {
        const id = s === 'PENDING' ? 'wdTabPending' : s === 'APPROVED' ? 'wdTabApproved' : 'wdTabRejected';
        const el = $(id);
        if (el) {
            el.classList.toggle('btn', s === status);
            el.classList.toggle('secondary', s !== status);
        }
    });
    fetchWithdrawals();
}
async function fetchWithdrawals(){setState("withdrawals",true);try{const d=await get("/api/admin/withdrawals?status="+encodeURIComponent(currentWithdrawalStatus)),rows=d.withdrawals||[];$("withdrawalsBody").innerHTML=rows.map(x=>{const status=String(x.status||"").toUpperCase();const details=x.method==="UPI"?`UPI: ${esc(x.payout_details?.upi_id||"—")}`:`Wallet: ${esc(x.payout_details?.wallet_address||"—")}<br>Network: ${esc(x.payout_details?.network||"—")}`;const action=status==="PENDING"?`<button class="btn" onclick="approveWithdrawal(${x.id})">Approve</button> <button class="btn red" onclick="rejectWithdrawal(${x.id})">Reject</button>`:"<span>—</span>";const badge=status==="APPROVED"?"green":status==="REJECTED"?"red":"yellow";return `<tr><td><b>${esc(x.request_ref)}</b></td><td><b>${esc(x.legal_name)}</b><br><small>${esc(x.user_email)}</small><br><small>${esc(x.trader_id||"—")}</small></td><td>${money(x.amount_cents,x.currency)}</td><td>${esc(x.method||"—")}</td><td style="min-width:180px">${details}</td><td>${x.created_at?new Date(x.created_at).toLocaleString():"—"}</td><td><span class="badge ${badge}">${esc(status||"—")}</span>${status==="REJECTED"&&x.admin_note?`<br><small>${esc(x.admin_note)}</small>`:""}</td><td>${action}</td></tr>`;}).join("");$("withdrawalsLoading").style.display="none";$("withdrawalsEmpty").style.display=rows.length?"none":"block";}catch(e){setState("withdrawals",false,e.message);}}
async function approveWithdrawal(id){if(!confirm("Confirm the external payout has already been sent? This will mark the withdrawal APPROVED."))return;try{await post("/api/admin/withdrawals/"+id+"/approve",{});toast("Withdrawal approved.");await fetchWithdrawals();}catch(e){toast(e.message,"err");}}
async function rejectWithdrawal(id){const reason=prompt("Enter rejection reason:");if(!reason||!reason.trim())return;try{await post("/api/admin/withdrawals/"+id+"/reject",{reason:reason.trim()});toast("Withdrawal rejected and wallet refunded.");await fetchWithdrawals();}catch(e){toast(e.message,"err");}}
async function fetchAffiliates(){setState("affiliates",true);try{const d=await get("/api/admin/affiliates"),rows=d.affiliates||[];$("affiliatesBody").innerHTML=rows.map(x=>`<tr><td><b>${esc(x.legal_name)}</b></td><td>${esc(x.email)}</td><td><b>${esc(x.affiliate_code||"—")}</b></td><td>${x.total_sales||0}</td><td>${money(x.total_earnings_cents)}</td><td>${money(x.pending_earnings_cents)}</td><td>${x.affiliate_code?`<button class="copy-btn" onclick="copyText(${JSON.stringify(String(x.affiliate_code))})">Copy Code</button>`:"—"}</td></tr>`).join("");$("affiliatesLoading").style.display="none";$("affiliatesEmpty").style.display=rows.length?"none":"block";}catch(e){setState("affiliates",false,e.message);}}
async function copyText(v){try{await navigator.clipboard.writeText(v);toast("Affiliate code copied.");}catch{toast(v);}}
async function loadAffiliateTransferMode() {
    try {
        const data = await get('/api/admin/settings/affiliate-transfer-mode');
        const mode = String(data.mode || 'MANUAL').toUpperCase();
        ['MANUAL', 'AUTO'].forEach((value) => {
            const el = document.getElementById('affiliateTransferMode' + value.charAt(0) + value.slice(1).toLowerCase());
            if (!el) return;
            el.classList.toggle('btn', value === mode);
            el.classList.toggle('secondary', value !== mode);
        });
        const msg = document.getElementById('affiliateTransferModeMsg');
        if (msg) msg.textContent = 'Current mode: ' + mode;
    } catch (error) {
        const msg = document.getElementById('affiliateTransferModeMsg');
        if (msg) msg.textContent = 'Unable to load transfer mode: ' + error.message;
    }
}

async function setAffiliateTransferMode(mode) {
    const nextMode = String(mode || '').toUpperCase();
    if (!['AUTO', 'MANUAL'].includes(nextMode)) return;
    if (!confirm('Switch Affiliate Transfer Mode to ' + nextMode + '?')) return;
    try {
        await post('/api/admin/settings/affiliate-transfer-mode', { mode: nextMode });
        toast('Affiliate Transfer Mode set to ' + nextMode);
        await loadAffiliateTransferMode();
        await loadWalletTransfers(currentWalletTransferStatus);
    } catch (error) {
        toast(error.message, 'err');
    }
}

async function loadWalletTransfers(status) {
    loadAffiliateTransferMode();
    if (status) currentWalletTransferStatus = status;
    
    const tabs = {
        PENDING: 'wtTabPending',
        APPROVED: 'wtTabApproved',
        REJECTED: 'wtTabRejected'
    };
    Object.entries(tabs).forEach(([s, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (s === currentWalletTransferStatus) {
            el.classList.add('btn');
            el.classList.remove('secondary');
        } else {
            el.classList.add('secondary');
            el.classList.remove('btn');
        }
    });

    const body = document.getElementById('walletTransfersBody');
    const loading = document.getElementById('walletTransfersLoading');
    const empty = document.getElementById('walletTransfersEmpty');
    const errorEl = document.getElementById('walletTransfersError');

    if (!body) return;
    body.innerHTML = '';
    if (loading) loading.style.display = 'block';
    if (empty) empty.style.display = 'none';
    if (errorEl) errorEl.innerHTML = '';

    try {
        const data = await get('/api/admin/wallet-transfers?status=' + currentWalletTransferStatus);
        const transfers = Array.isArray(data.transfers) ? data.transfers : [];

        if (loading) loading.style.display = 'none';

        if (!transfers.length) {
            if (empty) empty.style.display = 'block';
            return;
        }

        body.innerHTML = transfers.map(t => {
            const status = String(t.status || '').toUpperCase();
            let badgeClass = 'yellow';
            if (status === 'APPROVED') badgeClass = 'green';
            if (status === 'REJECTED') badgeClass = 'red';

            const amount = money(t.amount_cents);
            const reqDate = t.requested_at ? new Date(t.requested_at).toLocaleDateString() : '—';

            let actionHtml = '<span class="badge ' + badgeClass + '">' + status + '</span>';
            if (status === 'PENDING') {
                actionHtml = 
                    '<button class="btn" onclick="approveWalletTransfer(' + t.id + ',' + t.amount_cents + ')">Approve</button> ' +
                    '<button class="btn red" onclick="rejectWalletTransfer(' + t.id + ')">Reject</button>';
            }

            return '<tr>' +
                '<td>' + (t.transfer_ref || '—') + '</td>' +
                '<td>' + (t.legal_name || '—') + '<br><small>' + (t.email || '') + '</small></td>' +
                '<td>' + (t.affiliate_code || '—') + '</td>' +
                '<td>' + amount + '</td>' +
                '<td>' + (t.reason || '—') + '</td>' +
                '<td>' + reqDate + '</td>' +
                '<td>' + actionHtml + '</td>' +
                '</tr>';
        }).join('');
    } catch (error) {
        if (loading) loading.style.display = 'none';
        if (errorEl) errorEl.textContent = error.message;
    }
}

async function approveWalletTransfer(id, amountCents) {
    const amount = money(amountCents);
    if (!confirm('Approve this ' + amount + ' transfer? Funds will move from affiliate balance to FundFXT Wallet.')) return;
    try {
        await post('/api/admin/wallet-transfers/' + id + '/approve', {});
        toast('Transfer approved');
        loadWalletTransfers(currentWalletTransferStatus);
    } catch (error) {
        toast(error.message, 'err');
    }
}

async function rejectWalletTransfer(id) {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;
    try {
        await post('/api/admin/wallet-transfers/' + id + '/reject', { rejection_reason: reason });
        toast('Transfer rejected');
        loadWalletTransfers(currentWalletTransferStatus);
    } catch (error) {
        toast(error.message, 'err');
    }
}

let currentAccountPayoutStatus = "PENDING";
function setAccountPayoutFilter(status){currentAccountPayoutStatus=status;["Pending","Approved","Rejected"].forEach(x=>{const e=$("apTab"+x);if(e)e.className=x.toUpperCase()===status?"btn":"btn secondary";});loadAccountPayouts(status);}
function ordinal(n){const v=Number(n||0),m=v%100;return v+(m>=11&&m<=13?"th":v%10===1?"st":v%10===2?"nd":v%10===3?"rd":"th");}
function payoutRuleBadge(ok,label){return '<span class="badge '+(ok?'green':'red')+'">'+(ok?'✓ ':'✕ ')+esc(label)+'</span>';}
function payoutSizeLabel(p){const c=Number(p.account?.initial_balance_cents||0);return c?money(c):esc(p.size_key||"—");}
function payoutDetailHtml(p){const rs=p.rules_status||{},ts=Array.isArray(p.trades)?p.trades:[];const rows=ts.length?ts.map(t=>'<tr><td>'+esc(t.symbol||"—")+'</td><td>'+esc(t.side||"—")+'</td><td>'+esc(t.type||"—")+'</td><td>'+esc(t.status||"—")+'</td><td>'+esc(t.volume??"—")+'</td><td>'+esc(t.open_price??"—")+'</td><td>'+esc(t.close_price??"—")+'</td><td>'+money(t.realized_profit_cents??t.profit??0)+'</td><td>'+esc(t.close_reason||"—")+'</td></tr>').join(""):'<tr><td colspan="9">No trades found.</td></tr>';return '<div class="panel" style="margin:8px 0 12px;padding:14px;"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'+payoutRuleBadge(rs.daily_dd_ok!==false,"DD")+payoutRuleBadge(rs.consistency_ok!==false,"Consistency")+payoutRuleBadge(rs.cooldown_ok!==false,"Cooldown")+payoutRuleBadge(rs.open_trades===false,"Open trades clear")+'</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px;"><div><small>Actual Profit</small><br><b>'+money(p.profit_cents)+'</b></div><div><small>Amount to Approve</small><br><b>'+money(p.amount_to_approve)+'</b></div><div><small>Extra Remaining</small><br><b>'+money(p.extra_remaining)+'</b></div><div><small>Tier</small><br><b>'+esc(ordinal(p.withdrawal_number))+' / '+esc(p.tier_range||"Prototype")+'</b></div></div><div style="overflow:auto;"><table class="table"><thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Status</th><th>Volume</th><th>Open</th><th>Close</th><th>P/L</th><th>Reason</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(String(p.status).toUpperCase()==="PENDING"?'<div style="margin-top:12px;display:flex;gap:8px;"><button class="btn" onclick="approveAccountPayout('+p.id+')">Approve</button><button class="btn red" onclick="rejectAccountPayout('+p.id+')">Reject</button></div>':"")+'</div>';}
function togglePayoutDetail(id){const el=$("apDetail"+id);if(el)el.style.display=el.style.display==="none"?"table-row":"none";}
function renderAccountPayoutRow(p){const st=String(p.status||"").toUpperCase(),badge=st==="APPROVED"?"green":st==="REJECTED"?"red":"yellow",rs=p.rules_status||{},rules=payoutRuleBadge(rs.daily_dd_ok!==false,"DD")+payoutRuleBadge(rs.consistency_ok!==false,"C")+payoutRuleBadge(rs.cooldown_ok!==false,"CD")+payoutRuleBadge(rs.open_trades===false,"OT"),action=st==="PENDING"?'<button class="btn" onclick="event.stopPropagation();approveAccountPayout('+p.id+')">Approve</button> <button class="btn red" onclick="event.stopPropagation();rejectAccountPayout('+p.id+')">Reject</button>':'<span class="badge '+badge+'">'+esc(st)+'</span>';return '<tr onclick="togglePayoutDetail('+p.id+')" style="cursor:pointer;"><td><b>'+esc(p.request_ref||"—")+'</b></td><td><b>'+esc(p.user?.name||"—")+'</b><br><small>'+esc(p.user?.email||"")+'</small></td><td>'+esc(p.user?.id??"—")+'</td><td>'+esc(p.account?.code||"—")+'</td><td>'+esc(p.account?.challenge_model||p.model_key||"—")+'</td><td>'+payoutSizeLabel(p)+'</td><td>'+esc(ordinal(p.withdrawal_number))+(p.tier_range?' <small>('+esc(p.tier_range)+')</small>':"")+'</td><td>'+money(p.tier_max_cents)+'</td><td>'+money(p.profit_cents)+'</td><td>'+money(p.amount_to_approve)+'</td><td>'+money(p.extra_remaining)+'</td><td style="min-width:180px">'+rules+'</td><td>'+action+'</td></tr><tr id="apDetail'+p.id+'" style="display:none;"><td colspan="13">'+payoutDetailHtml(p)+'</td></tr>';}
async function loadAccountPayouts(status="PENDING"){currentAccountPayoutStatus=status;["Pending","Approved","Rejected"].forEach(x=>{const e=$("apTab"+x);if(e)e.className=x.toUpperCase()===status?"btn":"btn secondary";});const body=$("accountPayoutsBody"),loading=$("accountPayoutsLoading"),empty=$("accountPayoutsEmpty"),errorEl=$("accountPayoutsError");loading.style.display="block";empty.style.display="none";errorEl.innerHTML="";body.innerHTML="";try{const d=await get("/api/admin/account-payouts?status="+encodeURIComponent(status)),rows=d.payouts||[];loading.style.display="none";window.__accountPayoutRows=rows;if(!rows.length){empty.style.display="block";return;}body.innerHTML=rows.map(renderAccountPayoutRow).join("");}catch(e){loading.style.display="none";errorEl.innerHTML='<div class="error-box">'+esc(e.message)+'</div>';}}
function openPayoutDetail(id){togglePayoutDetail(id);}
async function approveAccountPayout(id){const row=(window.__accountPayoutRows||[]).find(x=>Number(x.id)===Number(id));const amount=row?money(row.amount_to_approve):"the computed amount";const extra=row?money(row.extra_remaining):"—";if(!confirm("Approve "+amount+" to the FundFXT Wallet? Extra remaining in account: "+extra+"."))return;try{await post("/api/admin/account-payouts/"+id+"/approve",{});toast("Account payout approved");await loadAccountPayouts(currentAccountPayoutStatus);}catch(e){toast(e.message,"err");}}
async function rejectAccountPayout(id){const reason=prompt("Enter rejection reason:");if(!reason||!reason.trim())return;try{await post("/api/admin/account-payouts/"+id+"/reject",{rejection_reason:reason.trim()});toast("Account payout rejected");await loadAccountPayouts(currentAccountPayoutStatus);}catch(e){toast(e.message,"err");}}
async function fetchCertificates(){setState("certificates",true);try{const d=await get("/api/admin/certificates"),rows=d.certificates||[];$("certificatesBody").innerHTML=rows.map(x=>`<tr><td><b>${esc(x.legal_name)}</b></td><td>${esc(x.account_code||"—")}</td><td>${esc(x.achievement||"—")}</td><td>${esc(x.issued_on||x.created_at||"—")}</td></tr>`).join("");$("certificatesLoading").style.display="none";$("certificatesEmpty").style.display=rows.length?"none":"block";}catch(e){setState("certificates",false,e.message);}}
async function fetchSupportTickets(){setState("support",true);try{const d=await get("/api/admin/support/tickets"),rows=d.tickets||[];$("supportBody").innerHTML=rows.map(x=>`<tr><td><b>${esc(x.ticket_ref||x.id)}</b></td><td>${esc(x.legal_name||x.email||"—")}</td><td>${esc(x.title||x.subject||"—")}</td><td style="max-width:420px">${esc(x.message||"—")}</td><td>${esc(x.created_at||"—")}</td></tr>`).join("");$("supportLoading").style.display="none";$("supportEmpty").style.display=rows.length?"none":"block";}catch(e){setState("support",false,e.message);}}
async function loadSettings(){try{const d=await get("/api/settings"),s=d.settings||d,mode=String(s.payment_mode?.mode||s.payment_mode||"MANUAL").toUpperCase();document.querySelectorAll("[name=paymentMode]").forEach(x=>x.checked=x.value===mode);$("maintenanceMode").checked=Boolean(s.maintenance_mode?.enabled||s.maintenance_mode);}catch(e){$("settingsError").innerHTML=`<div class="error-box">${esc(e.message)}</div>`;}}
async function saveSettings(){try{const mode=document.querySelector("[name=paymentMode]:checked")?.value||"MANUAL";await post("/api/admin/settings",{settings:{payment_mode:{mode},maintenance_mode:{enabled:$("maintenanceMode").checked}}});$("settingsMsg").textContent="Saved successfully";toast("Settings saved.");setTimeout(()=>($("settingsMsg").textContent=""),2200);}catch(e){toast(e.message,"err");}}
document.addEventListener("keydown",(e)=>{if(e.key==="Escape"){closeLinkModal();closeStatusModal();closeSidebarMobile();}});
showSection("dashboard");

const databaseControlScript = document.createElement("script");
databaseControlScript.src = "database-control.js?v=20260911";
databaseControlScript.defer = true;
document.head.appendChild(databaseControlScript);
