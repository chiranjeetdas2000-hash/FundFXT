// Render compatibility entrypoint + startup repair for the organized backend.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'server.js');
let source = fs.readFileSync(target, 'utf8');

const broken = "const [trades] = await db.execute('SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = \"OPEN\", [req.params.tradeId, req.userId]);";
const fixed = "const [trades] = await db.execute('SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = ?', [req.params.tradeId, req.userId, 'OPEN']);";

if (source.includes(broken)) {
  source = source.split(broken).join(fixed);
  fs.writeFileSync(target, source, 'utf8');
  console.log('FundFXT: repaired malformed SL/TP SQL before startup.');
}

require('./backend/server.js');
