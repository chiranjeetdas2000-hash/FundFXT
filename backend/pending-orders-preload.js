/* FundFXT pending-order engine preload.
   Loaded before backend/server.js so pending orders have their own SQL table,
   authenticated API, live trigger engine, and execution-time trade creation. */
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const express = require('express');

const originalExpress = express;
const originalFactory = function (...args) { const app = originalExpress(...args); global.__fundfxtPendingApp = app; return app; };
Object.assign(originalFactory, originalExpress);
require.cache[require.resolve('express')].exports = originalFactory;

const originalCreatePool = mysql.createPool;
let capturedPool = null;
mysql.createPool = function (...args) {
  const pool = originalCreatePool.apply(this, args);
  capturedPool = pool;
  return pool;
};

const SYMBOLS = new Set(['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD','EURGBP','EURJPY','EURAUD','EURCHF','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPNZD','AUDJPY','AUDNZD','AUDCAD','AUDCHF','CADJPY','CADCHF','CHFJPY','NZDJPY','NZDCHF','NZDCAD','XAUUSD','XAGUSD']);
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const id = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const auth = (req,res,next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({error:'No token'});
  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err,decoded)=>{
    if(err) return res.status(403).json({error:'Invalid token'});
    req.userId=decoded.userId; next();
  });
};
function validStops(side,entry,sl,tp){
  if(sl!=null && ((side==='BUY'&&sl>=entry)||(side==='SELL'&&sl<=entry))) throw new Error('Invalid Stop Loss for this direction');
  if(tp!=null && ((side==='BUY'&&tp<=entry)||(side==='SELL'&&tp>=entry))) throw new Error('Invalid Take Profit for this direction');
}
function validPending(side,type,entry,bid,ask){
  if(type==='LIMIT' && side==='BUY' && entry>=ask) throw new Error('BUY LIMIT entry must be below current ask');
  if(type==='LIMIT' && side==='SELL' && entry<=bid) throw new Error('SELL LIMIT entry must be above current bid');
  if(type==='STOP' && side==='BUY' && entry<=ask) throw new Error('BUY STOP entry must be above current ask');
  if(type==='STOP' && side==='SELL' && entry>=bid) throw new Error('SELL STOP entry must be below current bid');
}
async function setup(){
  if(!capturedPool || !global.__fundfxtPendingApp) return setTimeout(setup,50);
  const db=capturedPool, app=global.__fundfxtPendingApp;
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS pending_orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(64) NOT NULL UNIQUE,
      account_id BIGINT NOT NULL,
      account_code VARCHAR(64) NOT NULL,
      user_id BIGINT NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      side VARCHAR(4) NOT NULL,
      order_type VARCHAR(10) NOT NULL,
      volume DECIMAL(10,2) NOT NULL,
      entry_price DECIMAL(20,8) NOT NULL,
      stop_loss DECIMAL(20,8) NULL,
      take_profit DECIMAL(20,8) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      triggered_at TIMESTAMP NULL,
      canceled_at TIMESTAMP NULL,
      KEY idx_pending_account (account_id,status),
      KEY idx_pending_symbol (symbol,status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('FundFXT: pending-orders SQL table ready.');
  } catch(e){ console.error('Pending order table init:',e.message); return; }

  app.get('/api/pending-orders',auth,async(req,res)=>{
    try{
      const [rows]=await db.execute('SELECT * FROM pending_orders WHERE user_id=? AND status=\'PENDING\' ORDER BY created_at DESC',[req.userId]);
      res.json({success:true,orders:rows});
    }catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/pending-orders',auth,async(req,res)=>{
    try{
      const {account_code,symbol,side,order_type,volume,entry_price,sl,tp}=req.body;
      const type=String(order_type||'').toUpperCase(), direction=String(side||'').toUpperCase();
      if(!SYMBOLS.has(String(symbol||'').toUpperCase())) return res.status(400).json({error:'Invalid symbol'});
      if(!['BUY','SELL'].includes(direction)) return res.status(400).json({error:'Invalid side'});
      if(!['LIMIT','STOP'].includes(type)) return res.status(400).json({error:'Invalid pending order type'});
      const vol=n(volume),entry=n(entry_price); if(vol<0.01||vol>2||Math.round(vol*100)!==vol*100) return res.status(400).json({error:'Volume must be 0.01 to 2.00 lots'});
      if(entry<=0) return res.status(400).json({error:'Invalid entry price'});
      const stop=sl===''||sl==null?null:n(sl),take=tp===''||tp==null?null:n(tp); validStops(direction,entry,stop,take);
      const [accounts]=await db.execute('SELECT * FROM accounts WHERE user_id=?',[req.userId]);
      const account=accounts.find(a=>String(a.account_code)===String(account_code))||accounts[0]; if(!account)return res.status(404).json({error:'Trading account not found'});
      if(String(account.status).toUpperCase()==='BREACHED')return res.status(400).json({error:'Account is breached'});
      const [today]=await db.execute("SELECT COUNT(*) AS count FROM trades WHERE account_id=? AND trading_day=CURDATE()",[account.id]);
      const [cfg]=await db.execute('SELECT * FROM challenge_configs WHERE model_key=? LIMIT 1',[account.challenge_model]);
      const maxTrades=n(account.max_trades_per_day||account.max_daily_trades||cfg[0]?.max_trades_per_day)||3;
      if(Number(today[0]?.count||0)>=maxTrades)return res.status(400).json({error:`Daily trade limit reached (${maxTrades}).`});
      const q=await fetch('https://biquote.io/api/'+encodeURIComponent(String(symbol).toUpperCase())).then(r=>r.json());
      const bid=n(q.bid),ask=n(q.ask); if(!bid||!ask)return res.status(503).json({error:'Live price unavailable'});
      validPending(direction,type,entry,bid,ask);
      const orderId=id('PO');
      await db.execute('INSERT INTO pending_orders(order_id,account_id,account_code,user_id,symbol,side,order_type,volume,entry_price,stop_loss,take_profit,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,\'PENDING\')',[orderId,account.id,account.account_code,req.userId,String(symbol).toUpperCase(),direction,type,vol,entry,stop,take]);
      res.json({success:true,order_id:orderId,status:'PENDING'});
    }catch(e){res.status(400).json({error:e.message});}
  });

  app.post('/api/pending-orders/:orderId/modify',auth,async(req,res)=>{
    try{
      const [rows]=await db.execute("SELECT * FROM pending_orders WHERE order_id=? AND user_id=? AND status='PENDING'",[req.params.orderId,req.userId]); if(!rows.length)return res.status(404).json({error:'Pending order not found'});
      const o=rows[0],entry=Object.prototype.hasOwnProperty.call(req.body,'entry_price')?n(req.body.entry_price):n(o.entry_price),stop=req.body.sl===''||req.body.sl==null?null:n(req.body.sl),take=req.body.tp===''||req.body.tp==null?null:n(req.body.tp);
      if(entry<=0)return res.status(400).json({error:'Invalid entry price'}); validStops(o.side,entry,stop,take);
      const q=await fetch('https://biquote.io/api/'+encodeURIComponent(o.symbol)).then(r=>r.json()),bid=n(q.bid),ask=n(q.ask); if(!bid||!ask)return res.status(503).json({error:'Live price unavailable'}); validPending(o.side,o.order_type,entry,bid,ask);
      await db.execute('UPDATE pending_orders SET entry_price=?,stop_loss=?,take_profit=? WHERE order_id=?',[entry,stop,take,o.order_id]); res.json({success:true,order_id:o.order_id});
    }catch(e){res.status(400).json({error:e.message});}
  });

  app.post('/api/pending-orders/:orderId/cancel',auth,async(req,res)=>{try{const[r]=await db.execute("UPDATE pending_orders SET status='CANCELED',canceled_at=NOW() WHERE order_id=? AND user_id=? AND status='PENDING'",[req.params.orderId,req.userId]);if(!r.affectedRows)return res.status(404).json({error:'Pending order not found'});res.json({success:true});}catch(e){res.status(500).json({error:e.message})}});

  let busy=false;
  setInterval(async()=>{
    if(busy)return; busy=true;
    try{
      const [orders]=await db.execute("SELECT * FROM pending_orders WHERE status='PENDING' ORDER BY id ASC LIMIT 100"); if(!orders.length)return;
      const symbols=[...new Set(orders.map(o=>o.symbol))]; const qs=new URLSearchParams();symbols.forEach(s=>qs.append('symbols',s));
      const response=await fetch('https://biquote.io/api/latest?'+qs.toString()); const quotes=await response.json();
      for(const o of orders){
        const q=quotes[o.symbol]||{};const bid=n(q.bid),ask=n(q.ask);if(!bid||!ask)continue;
        let hit=false;if(o.side==='BUY'&&o.order_type==='LIMIT')hit=ask<=n(o.entry_price);if(o.side==='BUY'&&o.order_type==='STOP')hit=ask>=n(o.entry_price);if(o.side==='SELL'&&o.order_type==='LIMIT')hit=bid>=n(o.entry_price);if(o.side==='SELL'&&o.order_type==='STOP')hit=bid<=n(o.entry_price);if(!hit)continue;
        const [accRows]=await db.execute('SELECT * FROM accounts WHERE id=?',[o.account_id]);const account=accRows[0];if(!account)continue;
        const [today]=await db.execute("SELECT COUNT(*) AS count FROM trades WHERE account_id=? AND trading_day=CURDATE()",[o.account_id]);const [cfg]=await db.execute('SELECT * FROM challenge_configs WHERE model_key=? LIMIT 1',[account.challenge_model]);const maxTrades=n(account.max_trades_per_day||account.max_daily_trades||cfg[0]?.max_trades_per_day)||3;if(Number(today[0]?.count||0)>=maxTrades){await db.execute("UPDATE pending_orders SET status='CANCELED',canceled_at=NOW() WHERE order_id=?",[o.order_id]);continue;}
        const tradeId=id('TR'); const fill=n(o.entry_price);
        await db.execute("INSERT INTO trades(trade_id,account_id,account_code,user_id,symbol,side,volume,entry_price,entry_time,trading_day,stop_loss,take_profit,status,current_price,floating_profit_cents,realized_profit_cents) VALUES(?,?,?,?,?,?,?, ?,NOW(),CURDATE(),?,?, 'OPEN', ?,0,0)",[tradeId,o.account_id,o.account_code,o.user_id,o.symbol,o.side,o.volume,fill,o.stop_loss,o.take_profit,fill]);
        await db.execute("UPDATE pending_orders SET status='TRIGGERED',triggered_at=NOW() WHERE order_id=?",[o.order_id]);
      }
    }catch(e){console.error('Pending trigger engine:',e.message)}finally{busy=false}
  },1000);
}
setTimeout(setup,100);
