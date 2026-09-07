// Render compatibility entrypoint + emergency source repair for the organized backend.
// The actual application remains in backend/server.js.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'server.js');
let source = fs.readFileSync(target, 'utf8');

// Repair the malformed SL/TP SELECT that was introduced during the file organization.
source = source.replace(
  /const \[trades\] = await db\.execute\('SELECT \* FROM trades WHERE trade_id = \? AND user_id = \? AND status = \\\"OPEN\\\", \[req\.params\.tradeId, req\.userId\]\);/g,
  "const [trades] = await db.execute('SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = ?', [req.params.tradeId, req.userId, 'OPEN']);"
);

fs.writeFileSync(target, source, 'utf8');
require('./backend/server.js');
