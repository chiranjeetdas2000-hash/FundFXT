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

// Replace the legacy FCS quote engine with BiQuote. BiQuote exposes live bid/ask,
// spread and day percentage change over a public REST API and also offers SignalR.
// We use its batched REST endpoint here so the server remains dependency-free.
const biquoteTrading=`// ========== BIQUOTE LIVE MARKET DATA + CLEAN TRADE ENGINE ==========
const { SYMBOLS, calculatePL: calcPL, validateOrder, validateStops, tradeId } = require('./trade-engine-v2');
const BIQUOTE_BASE='https://biquote.io';
global.priceCache=global.priceCache||{};
global.prices=global.prices||{};
function liveQuote(symbol){const p=global.priceCache[String(symbol).toUpperCase()];return p&&Number.isFinite(p.bid)&&Number.isFinite(p.ask)?p:null;}
function normalizeBiQuoteTick(t){
  if(!t||!t.symbol)return null;
  const symbol=String(t.symbol).toUpperCase();
  const bid=Number(t.bid),ask=Number(t.ask),mid=Number(t.mid);
  if(!Number.isFinite(bid)||!Number.isFinite(ask))return null;
  const m=Number.isFinite(mid)?mid:(bid+ask)/2;
  const spread=Number.isFinite(Number(t.spread))?Number(t.spread):Math.abs(ask-bid);
  const dayPct=Number(t.dayDiffPercent??t.changePercent??t.chp);
  const change=Number(t.changeAmount??t.change??t.ch);
  const previous=Number(t.previousClose??t.prevClose??t.previous);
  return {symbol,bid,ask,mid:m,last:Number.isFinite(Number(t.last))?Number(t.last):m,spread,spreadPercent:m?spread/m*100:0,change:Number.isFinite(change)?change:(Number.isFinite(dayPct)?m*dayPct/100:0),changePercent:Number.isFinite(dayPct)?dayPct:0,previous:Number.isFinite(previous)?previous:null,marketState:t.marketState||'open',stale:Boolean(t.stale),quoteAgeSeconds:Number(t.quoteAgeSeconds||0),updatedAt:Date.now(),source:'BiQuote'};
}
async function refreshBiQuotePrices(){
  const symbols=Object.keys(SYMBOLS);
  const qs=symbols.map(s=>'symbols='+encodeURIComponent(s)).join('&');
  const r=await fetch(BIQUOTE_BASE+'/api/latest?'+qs,{headers:{accept:'application/json'}});
  if(!r.ok)throw new Error('BiQuote HTTP '+r.status);
  const body=await r.json();
  const ticks=Array.isArray(body)?body:(Array.isArray(body.ticks)?body.ticks:(Array.isArray(body.data)?body.data:[]));
  const list=ticks.length?ticks:Object.entries(body||{}).map(([symbol,t])=>({...t,symbol}));
  for(const raw of list){const p=normalizeBiQuoteTick(raw);if(!p||!SYMBOLS[p.symbol])continue;global.priceCache[p.symbol]=p;global.prices[p.symbol]=p;}
  if(!isForexWeekend()&&typeof processLivePrices==='function')processLivePrices().catch(e=>console.error('BiQuote trade engine:',e.message));
  return global.prices;
}
refreshBiQuotePrices().then(()=>console.log('BiQuote live feed connected')).catch(e=>console.error('BiQuote initial fetch failed:',e.message));
setInterval(()=>refreshBiQuotePrices().catch(e=>console.error('BiQuote refresh failed:',e.message)),1000);

async function closeTradeAtomic(id,reason,exitPrice,expected='OPEN'){const c=await db.getConnection();try{await c.beginTransaction();const[r]=await c.execute('SELECT * FROM trades WHERE trade_id=? FOR UPDATE',[id]);if(!r.length||r[0].status!==expected){await c.rollback();return null;}const t=r[0],pnl=Math.round(calcPL(t.symbol,t.side,Number(t.entry_price),Number(exitPrice),Number(t.volume))*100);await c.execute(\`UPDATE trades SET status='CLOSED',exit_price=?,exit_time=NOW(),current_price=?,floating_profit_cents=0,realized_profit_cents=?,close_reason=? WHERE trade_id=? AND status=?\`,[exitPrice,exitPrice,pnl,reason,id,expected]);await c.execute('UPDATE accounts SET balance_cents=balance_cents+?,equity_cents=balance_cents+? WHERE id=?',[pnl,pnl,t.account_id]);await c.commit();return{...t,realized_profit_cents:pnl,exit_price:exitPrice};}catch(e){await c.rollback();throw e;}finally{c.release();}}
async function checkAndBreachAccount(id){const c=await db.getConnection();try{await c.beginTransaction();const[r]=await c.execute('SELECT * FROM accounts WHERE id=? FOR UPDATE',[id]);if(!r.length||r[0].status!=='ACTIVE'){await c.rollback();return false;}const a=r[0],cfg=await getChallengeConfig(a.challenge_model),dailyLimit=Number(cfg.daily_dd_bps)/10000*Number(a.day_start_balance_cents),base=a.challenge_model==='prototype_5k'?Number(a.equity_hwm_cents):Number(a.initial_balance_cents),maxLimit=Number(cfg.max_dd_bps)/10000*base,dailyLoss=Number(a.day_start_balance_cents)-Number(a.equity_cents),maxLoss=base-Number(a.equity_cents);let reason=null;if(dailyLoss>=dailyLimit)reason='DAILY_LOSS_BREACH';else if(maxLoss>=maxLimit)reason='MAX_DRAWDOWN_BREACH';if(!reason){await c.rollback();return false;}const[t]=await c.execute("SELECT * FROM trades WHERE account_id=? AND status='OPEN' FOR UPDATE",[id]);let balance=Number(a.balance_cents);for(const tr of t){const q=liveQuote(tr.symbol);if(!q)continue;const exit=tr.side==='BUY'?q.bid:q.ask,pnl=Math.round(calcPL(tr.symbol,tr.side,Number(tr.entry_price),exit,Number(tr.volume))*100);balance+=pnl;await c.execute(\`UPDATE trades SET status='CLOSED',exit_price=?,exit_time=NOW(),current_price=?,floating_profit_cents=0,realized_profit_cents=?,close_reason='BREACH' WHERE trade_id=? AND status='OPEN'\`,[exit,exit,pnl,tr.trade_id]);}await c.execute("UPDATE accounts SET balance_cents=?,equity_cents=?,status='BREACHED',breached_at=NOW(),breach_reason=? WHERE id=?",[balance,balance,reason,id]);await c.commit();return true;}catch(e){await c.rollback();throw e;}finally{c.release();}}
async function processPendingOrders(){const[o]=await db.execute("SELECT * FROM trades WHERE status='PENDING'");for(const order of o){const q=liveQuote(order.symbol);if(!q)continue;const type=String(order.order_type||'').toUpperCase(),entry=Number(order.entry_price);let trigger=false;if(order.side==='BUY'&&type==='LIMIT')trigger=q.ask<=entry;else if(order.side==='SELL'&&type==='LIMIT')trigger=q.bid>=entry;else if(order.side==='BUY'&&type==='STOP')trigger=q.ask>=entry;else if(order.side==='SELL'&&type==='STOP')trigger=q.bid<=entry;if(!trigger)continue;const c=await db.getConnection();try{await c.beginTransaction();const[a]=await c.execute('SELECT * FROM accounts WHERE id=? FOR UPDATE',[order.account_id]);if(!a.length||a[0].status!=='ACTIVE'){await c.rollback();continue;}const[open]=await c.execute("SELECT id FROM trades WHERE account_id=? AND status='OPEN' LIMIT 1",[order.account_id]);if(open.length){await c.rollback();continue;}const[cnt]=await c.execute("SELECT COUNT(*) c FROM trades WHERE account_id=? AND trading_day=CURDATE() AND status IN ('OPEN','CLOSED')",[order.account_id]),cfg=await getChallengeConfig(a[0].challenge_model);if(Number(cnt[0].c)>=Number(cfg.max_trades_per_day)){await c.rollback();continue;}const execution=order.side==='BUY'?q.ask:q.bid,stops=validateStops(order.side,execution,order.stop_loss,order.take_profit);await c.execute("UPDATE trades SET status='OPEN',entry_price=?,entry_time=NOW(),stop_loss=?,take_profit=?,current_price=?,floating_profit_cents=0 WHERE trade_id=? AND status='PENDING'",[execution,stops.sl,stops.tp,execution,order.trade_id]);await c.commit();}catch(e){await c.rollback();console.error('Pending execution:',e.message);}finally{c.release();}}}
async function processLivePrices(){const[t]=await db.execute("SELECT * FROM trades WHERE status='OPEN'");const accounts=new Set();for(const tr of t){const q=liveQuote(tr.symbol);if(!q)continue;const current=tr.side==='BUY'?q.bid:q.ask,pnl=Math.round(calcPL(tr.symbol,tr.side,Number(tr.entry_price),current,Number(tr.volume))*100);let reason=null;if(tr.side==='BUY'){if(tr.stop_loss!=null&&current<=Number(tr.stop_loss))reason='SL';else if(tr.take_profit!=null&&current>=Number(tr.take_profit))reason='TP';}else{if(tr.stop_loss!=null&&current>=Number(tr.stop_loss))reason='SL';else if(tr.take_profit!=null&&current<=Number(tr.take_profit))reason='TP';}if(reason){await closeTradeAtomic(tr.trade_id,reason,current);accounts.add(tr.account_id);}else{await db.execute("UPDATE trades SET current_price=?,floating_profit_cents=? WHERE trade_id=? AND status='OPEN'",[current,pnl,tr.trade_id]);accounts.add(tr.account_id);}}for(const id of accounts){const[a]=await db.execute('SELECT * FROM accounts WHERE id=?',[id]);if(!a.length)continue;const[f]=await db.execute("SELECT COALESCE(SUM(floating_profit_cents),0) floating FROM trades WHERE account_id=? AND status='OPEN'",[id]);const equity=Number(a[0].balance_cents)+Number(f[0].floating||0);let hwm=Number(a[0].equity_hwm_cents||0);if(a[0].challenge_model==='prototype_5k'&&equity>hwm)hwm=equity;await db.execute('UPDATE accounts SET equity_cents=?,equity_hwm_cents=? WHERE id=?',[equity,hwm,id]);await checkAndBreachAccount(id);}await processPendingOrders();}
async function checkRiskForRequest(a){const[o]=await db.execute("SELECT id FROM trades WHERE account_id=? AND status='OPEN' LIMIT 1",[a.id]);if(o.length)throw new Error('Only one open position allowed');const cfg=await getChallengeConfig(a.challenge_model),[cnt]=await db.execute("SELECT COUNT(*) c FROM trades WHERE account_id=? AND trading_day=CURDATE() AND status IN ('OPEN','CLOSED')",[a.id]);if(Number(cnt[0].c)>=Number(cfg.max_trades_per_day))throw new Error(\`Max ${cfg.max_trades_per_day} trades per day reached\`);}
app.post('/api/trade/execute',authenticateToken,async(req,res)=>{try{const{account_code,symbol,side,volume,sl,tp}=req.body;validateOrder({symbol,side,volume,sl,tp});const[a]=await db.execute('SELECT * FROM accounts WHERE account_code=? AND user_id=?',[account_code,req.userId]);if(!a.length)return res.status(404).json({error:'Account not found'});if(a[0].status!=='ACTIVE')return res.status(403).json({error:'Account is not active for trading'});await checkRiskForRequest(a[0]);const q=liveQuote(symbol);if(!q)return res.status(503).json({error:'BiQuote live price unavailable'});const entry=side==='BUY'?q.ask:q.bid,stops=validateStops(side,entry,sl,tp),id=tradeId('TR');await db.execute(\`INSERT INTO trades (trade_id,account_id,account_code,user_id,symbol,side,volume,entry_price,entry_time,trading_day,stop_loss,take_profit,status,current_price,floating_profit_cents,realized_profit_cents) VALUES (?,?,?,?,?,?,?, ?,NOW(),CURDATE(),?,?, 'OPEN',?,0,0)\`,[id,a[0].id,account_code,req.userId,symbol,side,Number(volume),entry,stops.sl,stops.tp,entry]);res.json({success:true,trade_id:id,entry_price:entry,bid:q.bid,ask:q.ask,source:'BiQuote'});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/trades/pending',authenticateToken,async(req,res)=>{try{const{account_code,symbol,side,volume,order_type,limit_price,sl,tp}=req.body;validateOrder({symbol,side,volume,sl,tp});const type=String(order_type||'').toUpperCase();if(!['LIMIT','STOP'].includes(type))throw new Error('Order type must be LIMIT or STOP');const price=Number(limit_price);if(!Number.isFinite(price)||price<=0)throw new Error('Invalid pending price');const[a]=await db.execute('SELECT * FROM accounts WHERE account_code=? AND user_id=?',[account_code,req.userId]);if(!a.length)return res.status(404).json({error:'Account not found'});if(a[0].status!=='ACTIVE')throw new Error('Account is not active for trading');await checkRiskForRequest(a[0]);validateStops(side,price,sl,tp);const q=liveQuote(symbol);if(!q)throw new Error('BiQuote live price unavailable');if(type==='LIMIT'&&((side==='BUY'&&price>=q.ask)||(side==='SELL'&&price<=q.bid)))throw new Error('Invalid LIMIT price for current market');if(type==='STOP'&&((side==='BUY'&&price<=q.ask)||(side==='SELL'&&price>=q.bid)))throw new Error('Invalid STOP price for current market');const id=tradeId('PD');await db.execute(\`INSERT INTO trades (trade_id,account_id,account_code,user_id,symbol,side,volume,entry_price,entry_time,trading_day,stop_loss,take_profit,status,order_type) VALUES (?,?,?,?,?,?,?, ?,NOW(),CURDATE(),?,?, 'PENDING',?)\`,[id,a[0].id,account_code,req.userId,symbol,side,Number(volume),price,sl??null,tp??null,type]);res.json({success:true,trade_id:id,source:'BiQuote'});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/trades/:tradeId/close',authenticateToken,async(req,res)=>{try{const[t]=await db.execute("SELECT * FROM trades WHERE trade_id=? AND user_id=? AND status='OPEN'",[req.params.tradeId,req.userId]);if(!t.length)return res.status(404).json({error:'Open trade not found'});const q=liveQuote(t[0].symbol);if(!q)return res.status(503).json({error:'BiQuote live price unavailable'});const exit=t[0].side==='BUY'?q.bid:q.ask,c=await closeTradeAtomic(t[0].trade_id,'MANUAL',exit);if(!c)return res.status(409).json({error:'Trade was already closed'});res.json({success:true,exit_price:exit,realized_profit:c.realized_profit_cents/100,source:'BiQuote'});}catch(e){res.status(500).json({error:e.message});}});
app.patch('/api/trades/:tradeId',authenticateToken,async(req,res)=>{try{const[t]=await db.execute("SELECT * FROM trades WHERE trade_id=? AND user_id=? AND status='OPEN'",[req.params.tradeId,req.userId]);if(!t.length)return res.status(404).json({error:'Open trade not found'});const sl=req.body.stop_loss===''||req.body.stop_loss==null?null:Number(req.body.stop_loss),tp=req.body.take_profit===''||req.body.take_profit==null?null:Number(req.body.take_profit);validateStops(t[0].side,Number(t[0].entry_price),sl,tp);await db.execute("UPDATE trades SET stop_loss=?,take_profit=? WHERE trade_id=? AND status='OPEN'",[sl,tp,t[0].trade_id]);res.json({success:true});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/trades/pending',authenticateToken,async(req,res)=>{const[t]=await db.execute("SELECT * FROM trades WHERE account_code=? AND user_id=? AND status='PENDING' ORDER BY id DESC",[req.query.account_code,req.userId]);res.json({success:true,trades:t});});
app.delete('/api/trades/:tradeId',authenticateToken,async(req,res)=>{const[r]=await db.execute("UPDATE trades SET status='CANCELLED',exit_time=NOW(),close_reason='CANCELLED' WHERE trade_id=? AND user_id=? AND status='PENDING'",[req.params.tradeId,req.userId]);res.json({success:r.affectedRows===1});});
app.post('/api/accounts/:id/flatten',authenticateToken,async(req,res)=>{try{const[a]=await db.execute('SELECT * FROM accounts WHERE id=? AND user_id=?',[req.params.id,req.userId]);if(!a.length)return res.status(404).json({error:'Account not found'});const[t]=await db.execute("SELECT * FROM trades WHERE account_id=? AND status='OPEN'",[a[0].id]);let closed=0;for(const tr of t){const q=liveQuote(tr.symbol);if(q){await closeTradeAtomic(tr.trade_id,'FLATTEN',tr.side==='BUY'?q.bid:q.ask);closed++;}}res.json({success:true,closed});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/trade/get',authenticateToken,async(req,res)=>{try{const[t]=await db.execute('SELECT * FROM trades WHERE account_code=? AND user_id=? ORDER BY entry_time DESC,id DESC',[req.query.account_code,req.userId]);res.json({success:true,trades:t});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/accounts/:id/trades',authenticateToken,async(req,res)=>{try{const[a]=await db.execute('SELECT id FROM accounts WHERE id=? AND user_id=?',[req.params.id,req.userId]);if(!a.length)return res.status(404).json({error:'Account not found'});const[t]=await db.execute('SELECT * FROM trades WHERE account_id=? ORDER BY entry_time DESC,id DESC',[req.params.id]);res.json({success:true,trades:t});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/prices',(req,res)=>res.json({success:true,prices:global.prices||{},symbols:Object.keys(SYMBOLS),source:'BiQuote',timestamp:Date.now()}));`;
cleanTrading=cleanTrading.replace(/\/\/ ========== FCS LIVE MARKET DATA \+ CLEAN TRADE ENGINE ==========\n[\s\S]*?(?=async function closeTradeAtomic)/,biquoteTrading+'\n');

// Forex weekend session guard. Friday positions remain open over Saturday/Sunday.
// New trading mutations remain blocked while the forex market is closed.
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

app.get('/api/trade/get',authenticateToken,async(req,res,next)=>{
  try{
    const accountCode=String(req.query.account_code||'').trim();
    if(!accountCode) return res.status(400).json({success:false,error:'account_code is required'});
    const [a]=await db.execute('SELECT id,account_code FROM accounts WHERE account_code=? AND user_id=?',[accountCode,req.userId]);
    if(!a.length) return res.status(404).json({success:false,error:'Account not found'});
    const [trades]=await db.execute('SELECT * FROM trades WHERE account_id=? ORDER BY COALESCE(entry_time,created_at) DESC,id DESC',[a[0].id]);
    return res.json({success:true,trades});
  }catch(e){return next(e);}
});

app.get('/api/accounts/:id/trades',authenticateToken,async(req,res,next)=>{
  try{
    const accountId=Number(req.params.id);
    if(!Number.isInteger(accountId)||accountId<=0)return res.status(400).json({success:false,error:'Invalid account id'});
    const [a]=await db.execute('SELECT id,account_code,status FROM accounts WHERE id=? AND user_id=?',[accountId,req.userId]);
    if(!a.length)return res.status(404).json({success:false,error:'Account not found'});
    const [trades]=await db.execute('SELECT * FROM trades WHERE account_id=? ORDER BY COALESCE(entry_time,created_at) DESC,id DESC',[accountId]);
    return res.json({success:true,trades,account:a[0],market_closed:isForexWeekend()});
  }catch(e){return next(e);}
});

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

const transformed=source.slice(0,start)+cleanTrading+'\n'+source.slice(end);
const m=new Module(legacyPath,module.parent);m.filename=legacyPath;m.paths=Module._nodeModulePaths(__dirname);m._compile(transformed,legacyPath);
