const mockAccounts = [
  {
    accountId: "ACC-123456", type: "Phase 1", status: "Active",
    balance: 25000, equity: 25250, dailyDrawdown: 1850, maxDrawdown: 4250,
    tradesToday: "2/3", consistency: 35,
    chart: [25000,25240,25120,25620,25550,26150,26600,27150,26820,27650,28200,27950,28600,29150,28900,29700,30200,30650,31050]
  },
  {
    accountId: "ACC-123457", type: "Phase 2", status: "Active",
    balance: 50000, equity: 50780, dailyDrawdown: 3300, maxDrawdown: 7400,
    tradesToday: "1/5", consistency: 42,
    chart: [50000,50300,50100,50650,50900,50700,51200,51800,51550,52300,52800,52500,53400,53800,54200,54050,54800,55300,55780]
  },
  {
    accountId: "ACC-123458", type: "Funded Trader", status: "Active",
    balance: 100000, equity: 101250, dailyDrawdown: 5200, maxDrawdown: 8900,
    tradesToday: "2/8", consistency: 28,
    chart: [100000,100450,100900,100600,101300,101750,101500,102200,102850,102500,103200,103850,103100,103900,104400,103800,102900,101700,101250]
  }
];

const mockTrades = {
  "ACC-123456": [
    {symbol:"EURUSD",side:"Buy",lots:"0.50",entry:"1.08245",current:"1.08420",pl:87.50,status:"Open"},
    {symbol:"XAUUSD",side:"Sell",lots:"0.30",entry:"2,034.50",current:"2,028.10",pl:192.00,status:"Open"},
    {symbol:"GBPUSD",side:"Buy",lots:"0.20",entry:"1.26820",current:"1.26690",pl:-26.00,status:"Open"},
    {symbol:"EURUSD",side:"Sell",lots:"0.40",entry:"1.08580",current:"1.08720",pl:-56.00,status:"Open"}
  ],
  "ACC-123457": [
    {symbol:"XAUUSD",side:"Buy",lots:"0.50",entry:"2,018.20",current:"2,025.80",pl:380.00,status:"Open"},
    {symbol:"EURUSD",side:"Buy",lots:"0.70",entry:"1.07840",current:"1.08130",pl:203.00,status:"Open"}
  ],
  "ACC-123458": [
    {symbol:"GBPUSD",side:"Sell",lots:"1.00",entry:"1.27150",current:"1.26910",pl:240.00,status:"Open"},
    {symbol:"XAUUSD",side:"Buy",lots:"0.80",entry:"2,012.00",current:"2,009.20",pl:-224.00,status:"Open"},
    {symbol:"EURUSD",side:"Buy",lots:"0.60",entry:"1.08000",current:"1.08310",pl:186.00,status:"Open"}
  ]
};

// API-ready data layer. Replace fallback data with real backend endpoints.
async function fetchAccounts() {
  try {
    // const response = await fetch('/api/accounts');
    // if (!response.ok) throw new Error('API unavailable');
    // return await response.json();
    return mockAccounts;
  } catch (error) {
    console.warn("Using mock account data", error);
    return mockAccounts;
  }
}
async function fetchTrades(accountId) {
  try {
    // const response = await fetch(`/api/accounts/${accountId}/trades`);
    // return await response.json();
    return mockTrades[accountId] || [];
  } catch (error) {
    return mockTrades[accountId] || [];
  }
}
async function fetchEquityData(accountId) {
  // const response = await fetch(`/api/accounts/${accountId}/equity`);
  // return await response.json();
  return mockAccounts.find(a => a.accountId === accountId).chart;
}

let accounts = [];
let selectedAccount = null;
let chart, lineSeries;

const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(n);

function renderStats(account) {
  const cards = [
    ["▣","Account Balance",money(account.balance),"white","Balance"],
    ["◉","Current Equity",money(account.equity),"green","Live equity"],
    ["◔","Available Daily DD",money(account.dailyDrawdown),"yellow","Remaining"],
    ["◉","Available Max DD",money(account.maxDrawdown),"red-text","Remaining"],
    ["⇄","Trades Today",account.tradesToday,"green","Trade limit"],
    ["◌","Consistency Score",account.consistency+"%","green","Performance ratio"]
  ];
  document.getElementById("statsGrid").innerHTML = cards.map((c,i)=>`
    <article class="stat-card">
      <div class="stat-top"><span class="stat-icon ${i===3?'red':i===2?'yellow':''}">${c[0]}</span><span>${c[1]}</span></div>
      <div class="stat-value ${c[3]}">${c[2]}</div>
      <div class="stat-sub">${c[4]}</div>
    </article>`).join("");
}

function renderAccounts() {
  document.getElementById("accountList").innerHTML = accounts.map(a => `
    <div class="account-card ${a.accountId===selectedAccount.accountId?'selected':''}" data-id="${a.accountId}">
      <div class="account-card-top"><div><div class="account-id">${a.accountId}</div><div class="account-type">${a.type}</div></div><span class="badge">${a.status}</span></div>
      <div class="account-row"><span>Balance</span><strong>${money(a.balance)}</strong></div>
      <div class="account-row"><span>Equity</span><strong class="green">${money(a.equity)}</strong></div>
    </div>`).join("");
  document.querySelectorAll(".account-card").forEach(el => el.onclick = () => selectAccount(el.dataset.id));
}

function renderTrades(trades) {
  const filter = document.getElementById("symbolFilter").value;
  const visible = filter === "all" ? trades : trades.filter(t=>t.symbol===filter);
  document.getElementById("tradesBody").innerHTML = visible.map((t,index)=>`
    <tr>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="side ${t.side==='Buy'?'buy':'sell'}">${t.side}</span></td>
      <td>${t.lots}</td><td>${t.entry}</td><td>${t.current}</td>
      <td class="${t.pl>=0?'pl-positive':'pl-negative'}">${t.pl>=0?'+':''}${money(t.pl)}</td>
      <td><span class="badge">${t.status}</span></td>
      <td class="actions-cell">
        <button class="tiny-btn" onclick="showToast('Modify order selected')">Modify</button>
        <button class="tiny-btn" onclick="closeTrade('${selectedAccount.accountId}',${index})">Close</button>
        <button class="tiny-btn" onclick="showToast('Partial close panel opened')">Partial</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="8" style="text-align:center;color:#8e99a7;padding:30px">No active trades found.</td></tr>`;
}

function initChart() {
  const el = document.getElementById("equityChart");
  chart = LightweightCharts.createChart(el,{
    width:el.clientWidth,height:260,
    layout:{background:{color:"transparent"},textColor:"#84909e",fontSize:11},
    grid:{vertLines:{color:"rgba(255,255,255,.04)"},horzLines:{color:"rgba(255,255,255,.06)"}},
    rightPriceScale:{borderColor:"rgba(255,255,255,.08)"},
    timeScale:{borderColor:"rgba(255,255,255,.08)",timeVisible:false},
    crosshair:{vertLine:{color:"rgba(0,181,106,.25)"},horzLine:{color:"rgba(0,181,106,.25)"}}
  });
  lineSeries = chart.addAreaSeries({
    lineColor:"#19d987",topColor:"rgba(0,181,106,.30)",bottomColor:"rgba(0,181,106,0)",
    lineWidth:2
  });
  window.addEventListener("resize",()=>chart.applyOptions({width:el.clientWidth}));
}

async function updateChart(accountId) {
  const values = await fetchEquityData(accountId);
  const range = document.getElementById("chartRange").value;
  const source = range==="7" ? values.slice(-7) : range==="30" ? values.slice(-12) : values;
  const data = source.map((value,index)=>({time:1704067200 + index*86400,value}));
  lineSeries.setData(data);
  chart.timeScale().fitContent();
}

async function selectAccount(id) {
  selectedAccount = accounts.find(a=>a.accountId===id);
  document.querySelector(".account-chip").innerHTML = `${selectedAccount.accountId} <span class="copy">⧉</span>`;
  renderStats(selectedAccount);
  renderAccounts();
  await updateChart(id);
  renderTrades(await fetchTrades(id));
}

async function closeTrade(accountId,index){
  const trade = mockTrades[accountId][index];
  if(!trade) return;
  showToast(`${trade.symbol} position closed (demo)`);
  mockTrades[accountId].splice(index,1);
  renderTrades(await fetchTrades(accountId));
}
function showToast(message){
  const toast=document.getElementById("toast");
  toast.textContent=message;toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"),2600);
}
window.showToast=showToast; window.closeTrade=closeTrade;

document.getElementById("symbolFilter").addEventListener("change",async()=>renderTrades(await fetchTrades(selectedAccount.accountId)));
document.getElementById("chartRange").addEventListener("change",()=>updateChart(selectedAccount.accountId));
document.getElementById("refreshBtn").addEventListener("click",async()=>{
  renderTrades(await fetchTrades(selectedAccount.accountId)); showToast("Trade data refreshed");
});
document.querySelector(".copy").addEventListener("click",()=>navigator.clipboard?.writeText(selectedAccount?.accountId||"ACC-123456"));
document.getElementById("hamburger").addEventListener("click",()=>{
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("overlay").classList.toggle("show");
});
document.getElementById("overlay").addEventListener("click",()=>{
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
});

(async function boot(){
  accounts = await fetchAccounts();
  selectedAccount = accounts[0];
  initChart();
  await selectAccount(selectedAccount.accountId);
})();
