'use strict';
const crypto = require('crypto');
const SYMBOLS = Object.freeze({
  EURUSD:{pip:0.0001,contractSize:100000,spread:0.00015},
  GBPUSD:{pip:0.0001,contractSize:100000,spread:0.00015},
  USDJPY:{pip:0.01,contractSize:100000,spread:0.015},
  AUDUSD:{pip:0.0001,contractSize:100000,spread:0.00015},
  XAUUSD:{pip:0.1,contractSize:100,spread:0.00015}
});
function calculatePL(symbol,side,entry,exit,volume){const i=SYMBOLS[symbol];if(!i)throw new Error('Unsupported symbol');const signed=side==='BUY'?exit-entry:entry-exit;return(signed/i.pip)*(i.contractSize*i.pip)*volume;}
function validateOrder({symbol,side,volume,sl,tp}){if(!SYMBOLS[symbol])throw new Error('Invalid symbol');if(side!=='BUY'&&side!=='SELL')throw new Error('Side must be BUY or SELL');const v=Number(volume);if(!Number.isFinite(v)||v<0.01||v>2||Math.round(v*100)!==v*100)throw new Error('Volume must be 0.01 to 2.00 lots in 0.01 steps');if(sl!=null&&sl!==''&&!Number.isFinite(Number(sl)))throw new Error('Invalid stop loss');if(tp!=null&&tp!==''&&!Number.isFinite(Number(tp)))throw new Error('Invalid take profit');}
function validateStops(side,entry,sl,tp){sl=sl==null||sl===''?null:Number(sl);tp=tp==null||tp===''?null:Number(tp);if(side==='BUY'){if(sl!==null&&sl>=entry)throw new Error('BUY stop loss must be below entry');if(tp!==null&&tp<=entry)throw new Error('BUY take profit must be above entry');}else{if(sl!==null&&sl<=entry)throw new Error('SELL stop loss must be above entry');if(tp!==null&&tp>=entry)throw new Error('SELL take profit must be below entry');}return{sl,tp};}
function tradeId(prefix='TR'){return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;}
module.exports={SYMBOLS,calculatePL,validateOrder,validateStops,tradeId};
