'use strict';
const crypto = require('crypto');
const FX=['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD','EURGBP','EURJPY','EURAUD','EURCHF','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPNZD','AUDJPY','AUDNZD','AUDCAD','AUDCHF','CADJPY','CADCHF','CHFJPY','NZDJPY','NZDCHF','NZDCAD'];
const SYMBOLS=Object.freeze(Object.fromEntries([
  ...FX.map(symbol=>[symbol,{pip:/JPY$/.test(symbol)?0.01:0.0001,contractSize:100000,spread:/JPY$/.test(symbol)?0.015:0.00015,base:symbol.slice(0,3),quote:symbol.slice(3,6)}]),
  ['XAUUSD',{pip:0.01,contractSize:100,spread:0.20,base:'XAU',quote:'USD'}],
  ['XAGUSD',{pip:0.001,contractSize:5000,spread:0.02,base:'XAG',quote:'USD'}]
]));

// Returns quote-currency P/L converted to USD. No pip-value shortcut is used.
// For non-USD quote currencies, the live quote at the exit/current price converts the result:
// GBP/CAD/CHF/AUD/NZD/EUR -> corresponding XXXUSD pair; JPY -> inverse USDJPY.
function calculatePL(symbol,side,entry,exit,volume,quotes={}){
  const i=SYMBOLS[symbol];if(!i)throw new Error('Unsupported symbol');
  const signed=(String(side).toUpperCase()==='BUY'?Number(exit)-Number(entry):Number(entry)-Number(exit));
  let quotePnl=signed*i.contractSize*Number(volume);
  if(i.quote==='USD')return quotePnl;
  const direct=i.quote+'USD';
  const inverse='USD'+i.quote;
  const q=quotes[direct]||quotes[inverse];
  if(!q)throw new Error('USD conversion quote unavailable for '+i.quote);
  const mid=Number(q.mid||q.bid||q.ask);
  if(!Number.isFinite(mid)||mid<=0)throw new Error('Invalid USD conversion quote for '+i.quote);
  const usdPerQuote=quotes[direct]?mid:1/mid;
  return quotePnl*usdPerQuote;
}
function validateOrder({symbol,side,volume,sl,tp}){if(!SYMBOLS[symbol])throw new Error('Invalid symbol');if(side!=='BUY'&&side!=='SELL')throw new Error('Side must be BUY or SELL');const v=Number(volume);if(!Number.isFinite(v)||v<0.01||v>2||Math.round(v*100)!==v*100)throw new Error('Volume must be 0.01 to 2.00 lots in 0.01 steps');if(sl!=null&&sl!==''&&!Number.isFinite(Number(sl)))throw new Error('Invalid stop loss');if(tp!=null&&tp!==''&&!Number.isFinite(Number(tp)))throw new Error('Invalid take profit');}
function validateStops(side,entry,sl,tp){sl=sl==null||sl===''?null:Number(sl);tp=tp==null||tp===''?null:Number(tp);if(side==='BUY'){if(sl!==null&&sl>=entry)throw new Error('BUY stop loss must be below entry');if(tp!==null&&tp<=entry)throw new Error('BUY take profit must be above entry');}else{if(sl!==null&&sl<=entry)throw new Error('SELL stop loss must be above entry');if(tp!==null&&tp>=entry)throw new Error('SELL take profit must be below entry');}return{sl,tp};}
function tradeId(prefix='TR'){return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;}
module.exports={SYMBOLS,calculatePL,validateOrder,validateStops,tradeId};
