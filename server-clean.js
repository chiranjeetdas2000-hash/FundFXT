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
// On the first valid FCS quote after the weekend, live P/L and SL/TP are evaluated
// against that opening quote (including gaps through the SL/TP level).
const weekendGuard = `
function isForexWeekend(){
  const day=new Date().getUTCDay();
  return day===0 || day===6;
}
function rejectWeekendExecution(res){
  if(!isForexWeekend()) return false;
  res.status(409).json({error:'Forex market is closed on Saturday and Sunday. Orders cannot execute during the weekend.'});
  return true;
}
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
