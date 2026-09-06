'use strict';
const fs=require('fs');
const Module=require('module');
const path=require('path');
const legacyPath=path.join(__dirname,'server.js');
const source=fs.readFileSync(legacyPath,'utf8');
const start=source.indexOf('// ========== FCS LIVE MARKET DATA ==========');
const end=source.indexOf('// ---------- GET USER ORDERS (Example) ----------');
if(start<0||end<0||end<=start)throw new Error('Unable to locate legacy trading section safely');
let cleanTrading=fs.readFileSync(path.join(__dirname,'clean-trading-section.txt'),'utf8');

// Forex weekend session guard. Friday positions remain open over Saturday/Sunday.
// No new execution, close, SL/TP modification or pending-order cancellation is allowed
// while the forex market is closed. Existing Friday positions remain OPEN.
const weekendGuard = `
function isForexWeekend(){
  const day=new Date().getUTCDay();
  return day===0 || day===6;
}
function rejectWeekendExecution(res){
  if(!isForexWeekend()) return false;
  res.status(409).json({error:'Forex market is closed on Saturday and Sunday. Trading changes are unavailable until the market reopens.'});
  return true;
}

// Compatibility route: return ALL trades belonging to the authenticated account.
// Older OPEN rows may have a stale/missing user_id, while the account itself is valid.
// The terminal must still see OPEN, CLOSED and PENDING records for the selected account.
app.get('/api/trade/get',authenticateToken,async(req,res,next)=>{
  try{
    const accountCode=String(req.query.account_code||'');
    if(!accountCode) return res.status(400).json({success:false,error:'account_code is required'});
    const [a]=await db.execute('SELECT id FROM accounts WHERE account_code=? AND user_id=?',[accountCode,req.userId]);
    if(!a.length) return res.status(404).json({success:false,error:'Account not found'});
    const [trades]=await db.execute('SELECT * FROM trades WHERE account_id=? ORDER BY COALESCE(entry_time,created_at) DESC,id DESC',[a[0].id]);
    return res.json({success:true,trades});
  }catch(e){ return next(e); }
});

// Block all position/order mutations during the weekend. Reads remain available.
app.use((req,res,next)=>{
  if(isForexWeekend() && (
    (req.method==='POST' && /^\\/api\\/trades\\/[^/]+\\/close$/.test(req.path)) ||
    (req.method==='PATCH' && /^\\/api\\/trades\\/[^/]+$/.test(req.path)) ||
    (req.method==='DELETE' && /^\\/api\\/trades\\/[^/]+$/.test(req.path)) ||
    (req.method==='POST' && req.path==='/api/trades/pending')
  )) return rejectWeekendExecution(res);
  next();
});
`;
cleanTrading=weekendGuard+cleanTrading;
cleanTrading=cleanTrading.replace(
  "fcs.onmessage=data=>{",
  "fcs.onmessage=data=>{if(isForexWeekend())return;"
);
cleanTrading=cleanTrading.replace(
  "async function processLivePrices(){",
  "async function processLivePrices(){if(isForexWeekend())return;"
);
cleanTrading=cleanTrading.replace(
  "app.post('/api/trade/execute',authenticateToken,async(req,res)=>{try{",
  "app.post('/api/trade/execute',authenticateToken,async(req,res)=>{try{if(rejectWeekendExecution(res))return;"
);

const transformed=source.slice(0,start)+cleanTrading+'\n'+source.slice(end);
const m=new Module(legacyPath,module.parent);m.filename=legacyPath;m.paths=Module._nodeModulePaths(__dirname);m._compile(transformed,legacyPath);
