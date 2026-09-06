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

// Account-authoritative trade read route. A valid account owns its complete trade history;
// legacy trade.user_id values are not trusted for terminal visibility.
app.get('/api/trade/get',authenticateToken,async(req,res,next)=>{
  try{
    const accountCode=String(req.query.account_code||'');
    if(!accountCode) return res.status(400).json({success:false,error:'account_code is required'});
    const [a]=await db.execute('SELECT id FROM accounts WHERE account_code=? AND user_id=?',[accountCode,req.userId]);
    if(!a.length) return res.status(404).json({success:false,error:'Account not found'});
    const [trades]=await db.execute('SELECT * FROM trades WHERE account_id=? ORDER BY COALESCE(entry_time,created_at) DESC,id DESC',[a[0].id]);
    return res.json({success:true,trades});
  }catch(e){return next(e);}
});

// Account-authoritative mutation routes. They also enforce the weekend lock themselves,
// because Express route order must never allow a mutation to bypass the global guard.
app.post('/api/trades/:tradeId/close',authenticateToken,async(req,res)=>{try{
  if(rejectWeekendExecution(res))return;
  const [t]=await db.execute("SELECT tr.* FROM trades tr JOIN accounts a ON a.id=tr.account_id WHERE tr.trade_id=? AND a.user_id=? AND tr.status='OPEN'",[req.params.tradeId,req.userId]);
  if(!t.length)return res.status(404).json({error:'Open trade not found'});
  const q=liveQuote(t[0].symbol);if(!q)return res.status(503).json({error:'Live price unavailable'});
  const exit=t[0].side==='BUY'?q.bid:q.ask;
  const c=await closeTradeAtomic(t[0].trade_id,'MANUAL',exit);
  if(!c)return res.status(409).json({error:'Trade was already closed'});
  res.json({success:true,exit_price:exit,realized_profit:c.realized_profit_cents/100});
}catch(e){res.status(500).json({error:e.message});}});

app.patch('/api/trades/:tradeId',authenticateToken,async(req,res)=>{try{
  if(rejectWeekendExecution(res))return;
  const [t]=await db.execute("SELECT tr.* FROM trades tr JOIN accounts a ON a.id=tr.account_id WHERE tr.trade_id=? AND a.user_id=? AND tr.status='OPEN'",[req.params.tradeId,req.userId]);
  if(!t.length)return res.status(404).json({error:'Open trade not found'});
  const sl=req.body.stop_loss===''||req.body.stop_loss==null?null:Number(req.body.stop_loss),tp=req.body.take_profit===''||req.body.take_profit==null?null:Number(req.body.take_profit);
  validateStops(t[0].side,Number(t[0].entry_price),sl,tp);
  await db.execute("UPDATE trades SET stop_loss=?,take_profit=? WHERE trade_id=? AND status='OPEN'",[sl,tp,t[0].trade_id]);
  res.json({success:true});
}catch(e){res.status(400).json({error:e.message});}});

app.get('/api/trades/pending',authenticateToken,async(req,res)=>{try{
  const code=String(req.query.account_code||'');
  const [a]=await db.execute('SELECT id FROM accounts WHERE account_code=? AND user_id=?',[code,req.userId]);
  if(!a.length)return res.status(404).json({success:false,error:'Account not found'});
  const [t]=await db.execute("SELECT * FROM trades WHERE account_id=? AND status='PENDING' ORDER BY id DESC",[a[0].id]);
  res.json({success:true,trades:t});
}catch(e){res.status(500).json({success:false,error:e.message});}});

app.delete('/api/trades/:tradeId',authenticateToken,async(req,res)=>{try{
  if(rejectWeekendExecution(res))return;
  const [r]=await db.execute("UPDATE trades tr JOIN accounts a ON a.id=tr.account_id SET tr.status='CANCELLED',tr.exit_time=NOW(),tr.close_reason='CANCELLED' WHERE tr.trade_id=? AND a.user_id=? AND tr.status='PENDING'",[req.params.tradeId,req.userId]);
  res.json({success:r.affectedRows===1});
}catch(e){res.status(500).json({success:false,error:e.message});}});

// This middleware still protects the original legacy routes below these compatibility
// routes, including pending POST. Direct guards above protect the routes defined here.
app.use((req,res,next)=>{
  if(isForexWeekend() && (
    (req.method==='POST' && /^\/api\/trades\/[^/]+\/close$/.test(req.path)) ||
    (req.method==='PATCH' && /^\/api\/trades\/[^/]+$/.test(req.path)) ||
    (req.method==='DELETE' && /^\/api\/trades\/[^/]+$/.test(req.path)) ||
    (req.method==='POST' && req.path==='/api/trades/pending') ||
    (req.method==='POST' && /^\/api\/accounts\/[^/]+\/flatten$/.test(req.path))
  )) return rejectWeekendExecution(res);
  next();
});
`;
cleanTrading=weekendGuard+cleanTrading;
cleanTrading=cleanTrading.replace("fcs.onmessage=data=>{","fcs.onmessage=data=>{if(isForexWeekend())return;");
cleanTrading=cleanTrading.replace("async function processLivePrices(){","async function processLivePrices(){if(isForexWeekend())return;");
cleanTrading=cleanTrading.replace("app.post('/api/trade/execute',authenticateToken,async(req,res)=>{try{","app.post('/api/trade/execute',authenticateToken,async(req,res)=>{try{if(rejectWeekendExecution(res))return;");
cleanTrading=cleanTrading.replace("app.post('/api/accounts/:id/flatten',authenticateToken,async(req,res)=>{try{","app.post('/api/accounts/:id/flatten',authenticateToken,async(req,res)=>{try{if(rejectWeekendExecution(res))return;");

const transformed=source.slice(0,start)+cleanTrading+'\n'+source.slice(end);
const m=new Module(legacyPath,module.parent);m.filename=legacyPath;m.paths=Module._nodeModulePaths(__dirname);m._compile(transformed,legacyPath);
