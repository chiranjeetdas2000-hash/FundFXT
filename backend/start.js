const fs=require('fs'),path=require('path'),os=require('os');
const srcPath=path.join(__dirname,'server.js');
let src=fs.readFileSync(srcPath,'utf8');
if(!src.includes('FUNDFXT_RUNTIME_PATCH_V4')){
  src=src.replace(/async function getPaymentMode\(\)\s*\{[\s\S]*?\n\}/g,`async function getPaymentMode(){
    try{
        const [rows]=await db.query('SELECT * FROM settings WHERE setting_key = ?', ['payment_mode']);
        if(!rows.length) return 'MANUAL';
        const raw=rows[0].setting_value ?? rows[0].value ?? rows[0].config ?? rows[0].data;
        if(raw==null) return 'MANUAL';
        let obj=raw; if(typeof raw==='string'){try{obj=JSON.parse(raw)}catch(_){}}
        const mode=(obj&&typeof obj==='object'?(obj.mode||obj.value):obj);
        return String(mode||'MANUAL').toUpperCase()==='AUTO'?'AUTO':'MANUAL';
    }catch(e){console.warn('Payment mode lookup failed; using MANUAL:',e.message);return 'MANUAL';}
}`);
  src=src.replace("SELECT po.*, u.legal_name, u.email as user_email FROM payment_orders po JOIN users u ON po.user_id = u.id","SELECT po.*, u.legal_name, u.email as user_email, au.legal_name AS affiliate_name FROM payment_orders po JOIN users u ON po.user_id = u.id LEFT JOIN users au ON au.id = po.affiliate_id");
  src=src.replace("SELECT id, trader_id, legal_name, email, phone, kyc_status, is_verified, affiliate_code, created_at FROM users ORDER BY created_at DESC","SELECT id, trader_id, legal_name, email, phone, address, kyc_status, is_verified, affiliate_code, created_at FROM users ORDER BY created_at DESC");
  src=src.replace("WHERE po.status IN ('REQUESTED', 'LINK_SENT', 'PAYMENT_PENDING')","WHERE po.status IN ('REQUESTED', 'LINK_SENT', 'PAYMENT_LINK_SENT', 'PAYMENT_PENDING')");
  src=src.replace("if ((status === 'PAYMENT_DONE' || status === 'PAYMENT_APPROVED') && order.affiliate_code)","if ((status === 'PAYMENT_DONE' || status === 'PAYMENT_APPROVED' || status === 'ACCOUNT_CREATED') && order.affiliate_code)");
  src=src.replace("UPDATE affiliates SET total_sales = total_sales + 1, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?","UPDATE affiliates SET total_sales = total_sales + 1, total_earnings_cents = total_earnings_cents + ?, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?");
  src=src.replace("[commissionCents, affiliate.affiliate_id]","[commissionCents, commissionCents, affiliate.affiliate_id]");
  const marker='// FUNDFXT_RUNTIME_PATCH_V4';
  const patch=`
${marker}
// Dedicated storage for manually issued Razorpay links. It snapshots the exact request so admin can safely search and forward it.
const paymentLinkTableReady=db.query(\`CREATE TABLE IF NOT EXISTS payment_request_links (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 payment_order_id BIGINT UNSIGNED NOT NULL,
 request_ref VARCHAR(100) NOT NULL,
 user_id BIGINT UNSIGNED NULL,
 user_name VARCHAR(255) NULL,
 user_email VARCHAR(255) NULL,
 user_phone VARCHAR(100) NULL,
 user_address TEXT NULL,
 challenge_model VARCHAR(100) NULL,
 affiliate_code VARCHAR(100) NULL,
 affiliate_name VARCHAR(255) NULL,
 original_amount_cents BIGINT NULL,
 discount_amount_cents BIGINT NULL,
 final_amount_cents BIGINT NULL,
 currency VARCHAR(10) NULL,
 payment_link TEXT NULL,
 status VARCHAR(50) NOT NULL DEFAULT 'LINK_SENT',
 sent_to_admin_email VARCHAR(255) NULL,
 sent_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_payment_order_id (payment_order_id),
 KEY idx_request_ref (request_ref),
 KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci\`).catch(e=>console.error('Payment link table init:',e.message));
function removeRoute(pathname){const r=app.router||app._router;if(r&&r.stack)r.stack=r.stack.filter(layer=>!(layer.route&&layer.route.path===pathname));}

// Payment list: exact Request ID search + status overlay from the dedicated link table.
removeRoute('/api/admin/payment-orders');
app.get('/api/admin/payment-orders',authenticateAdmin,async(req,res)=>{
  try{
    const status=String(req.query.status||'').trim();
    const requestRef=String(req.query.request_ref||'').trim();
    let q=\`SELECT po.*,u.legal_name,u.email AS user_email,au.legal_name AS affiliate_name,
      COALESCE(prl.status,po.status) AS status,
      COALESCE(prl.payment_link,po.payment_link) AS payment_link
      FROM payment_orders po JOIN users u ON u.id=po.user_id
      LEFT JOIN users au ON au.id=po.affiliate_id
      LEFT JOIN payment_request_links prl ON prl.payment_order_id=po.id\`;
    const params=[];const where=[];
    if(requestRef){where.push('po.order_ref = ?');params.push(requestRef)}
    if(status){where.push('COALESCE(prl.status,po.status) = ?');params.push(status)}
    if(where.length)q+=' WHERE '+where.join(' AND ');
    q+=' ORDER BY po.created_at DESC';
    const [orders]=await db.execute(q,params);res.json({success:true,orders});
  }catch(e){console.error('Admin payment-order listing:',e);res.status(500).json({error:e.message});}
});

// Admin manually verifies Razorpay, then selects the business status.
removeRoute('/api/admin/payment-orders/:id/status');
app.post('/api/admin/payment-orders/:id/status',authenticateAdmin,async(req,res)=>{
  const id=Number(req.params.id),status=String(req.body?.status||'').trim().toUpperCase();
  const allowed=['PAYMENT_DONE','PAYMENT_APPROVED','REJECTED','CANCELLED','PAYMENT_PENDING'];
  if(!id||!allowed.includes(status))return res.status(400).json({error:'Invalid payment status'});
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [orders]=await connection.execute('SELECT * FROM payment_orders WHERE id = ? FOR UPDATE',[id]);
    if(!orders.length){await connection.rollback();return res.status(404).json({error:'Payment request not found'});}
    const order=orders[0];
    if(order.status==='ACCOUNT_CREATED')return res.status(400).json({error:'Account is already created for this request'});
    await connection.execute('UPDATE payment_orders SET status = ? WHERE id = ?',[status,id]);
    if((status==='PAYMENT_DONE'||status==='PAYMENT_APPROVED')&&order.affiliate_code){
      const [a]=await connection.execute('SELECT af.id AS affiliate_id FROM affiliates af JOIN users u ON u.id=af.user_id WHERE u.affiliate_code=? LIMIT 1',[order.affiliate_code]);
      if(a.length){
        const commissionCents=Math.floor((Number(order.final_amount_cents||0)*0.20)+100);
        const [existing]=await connection.execute('SELECT id FROM affiliate_commissions WHERE order_id=? LIMIT 1',[id]);
        if(!existing.length){
          await connection.execute(\`INSERT INTO affiliate_commissions (affiliate_id,order_id,referred_user_id,model,commission_amount_cents,status) VALUES (?,?,?,?,?,'PENDING')\`,[a[0].affiliate_id,id,order.user_id,order.model,commissionCents]);
          await connection.execute(\`UPDATE affiliates SET total_sales=total_sales+1,total_earnings_cents=total_earnings_cents+?,pending_earnings_cents=pending_earnings_cents+? WHERE id=?\`,[commissionCents,commissionCents,a[0].affiliate_id]);
        }
      }
    }
    await connection.commit();
    res.json({success:true,status});
  }catch(e){await connection.rollback();console.error('Payment status update:',e);res.status(500).json({error:e.message});}finally{connection.release();}
});

// Account creation is available only after PAYMENT_APPROVED and is idempotent.
removeRoute('/api/admin/payment-orders/:id/create-account');
app.post('/api/admin/payment-orders/:id/create-account',authenticateAdmin,async(req,res)=>{
  const id=Number(req.params.id);const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [orders]=await connection.execute('SELECT * FROM payment_orders WHERE id=? FOR UPDATE',[id]);
    if(!orders.length){await connection.rollback();return res.status(404).json({error:'Payment request not found'});}
    const order=orders[0];
    if(order.status==='ACCOUNT_CREATED'&&order.account_code){await connection.commit();return res.json({success:true,account_code:order.account_code,already_created:true});}
    if(order.status!=='PAYMENT_APPROVED'){await connection.rollback();return res.status(400).json({error:'Approve the payment first before creating the account'});}
    const [existing]=await connection.execute("SELECT account_code FROM accounts WHERE user_id=? AND challenge_model=? AND status IN ('ACTIVE','PASSED') ORDER BY id DESC LIMIT 1",[order.user_id,order.model]);
    if(existing.length){await connection.execute("UPDATE payment_orders SET status='ACCOUNT_CREATED',account_code=? WHERE id=?",[existing[0].account_code,id]);await connection.commit();return res.json({success:true,account_code:existing[0].account_code,already_created:true});}
    const [configs]=await connection.execute('SELECT * FROM challenge_configs WHERE model_key=? LIMIT 1',[order.model]);
    if(!configs.length){await connection.rollback();return res.status(404).json({error:'Challenge config not found for '+order.model});}
    const config=configs[0];
    const accountCode='ACC-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
    await connection.execute(\`INSERT INTO accounts (account_code,user_id,challenge_model,phase,initial_balance_cents,balance_cents,equity_cents,status) VALUES (?,?,?,'PHASE_1',?,?,?,'ACTIVE')\`,[accountCode,order.user_id,order.model,config.starting_balance_cents,config.starting_balance_cents,config.starting_balance_cents]);
    await connection.execute("UPDATE payment_orders SET status='ACCOUNT_CREATED',account_code=? WHERE id=?",[accountCode,id]);
    await connection.commit();
    res.json({success:true,account_code:accountCode});
  }catch(e){await connection.rollback();console.error('Create approved account:',e);res.status(500).json({error:e.message});}finally{connection.release();}
});

// Save the manually created Razorpay link in a dedicated table and email the complete request to support.
removeRoute('/api/admin/payment-requests/:id/mark-link-sent');
app.post('/api/admin/payment-requests/:id/mark-link-sent',authenticateAdmin,async(req,res)=>{
  try{
    await paymentLinkTableReady;
    const orderId=Number(req.params.id);const paymentLink=String(req.body?.payment_link||'').trim();
    if(!orderId)return res.status(400).json({error:'Invalid payment request ID'});
    if(!paymentLink.toLowerCase().startsWith('https://'))return res.status(400).json({error:'Please enter a valid HTTPS payment link'});
    const [rows]=await db.query(\`SELECT po.*,u.legal_name,u.email AS user_email,u.phone AS user_phone,u.address AS user_address,au.legal_name AS affiliate_name FROM payment_orders po JOIN users u ON u.id=po.user_id LEFT JOIN users au ON au.id=po.affiliate_id WHERE po.id=? LIMIT 1\`,[orderId]);
    if(!rows.length)return res.status(404).json({error:'Payment request not found'});const o=rows[0];const adminEmail='support.fundfxt@gmail.com';
    await db.query(\`INSERT INTO payment_request_links (payment_order_id,request_ref,user_id,user_name,user_email,user_phone,user_address,challenge_model,affiliate_code,affiliate_name,original_amount_cents,discount_amount_cents,final_amount_cents,currency,payment_link,status,sent_to_admin_email,sent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE payment_link=VALUES(payment_link),status='LINK_SENT',sent_to_admin_email=VALUES(sent_to_admin_email),sent_at=NOW(),updated_at=NOW()\`,[o.id,o.order_ref,o.user_id,o.legal_name,o.user_email,o.user_phone,o.user_address,o.model,o.affiliate_code||null,o.affiliate_name||null,o.original_amount_cents,o.discount_amount_cents,o.final_amount_cents,o.currency||'USD',paymentLink,'LINK_SENT',adminEmail]);
    const money=(c,cur)=>{const n=(Number(c||0)/100).toFixed(2);return (cur||'USD')==='USD'?'$'+n:(cur||'USD')+' '+n};
    const html=\`<div style="font-family:Arial,sans-serif;background:#f5f7f9;padding:28px;color:#17202a"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="background:#0f0f0f;padding:22px 26px;color:#fff;font-size:24px;font-weight:800">Fund<span style="color:#00b56a">FXT</span></div><div style="padding:26px"><h2 style="margin:0 0 8px">Payment Link Request</h2><p style="color:#667085">A customer has requested a FundFXT challenge payment link. Please review the details and forward the link to the customer.</p><table style="width:100%;border-collapse:collapse;margin:20px 0">\${[['Request ID',o.order_ref],['Customer Name',o.legal_name],['Customer Email',o.user_email],['Customer Phone',o.user_phone||'—'],['Customer Address',o.user_address||'—'],['Challenge',o.model],['Original Amount',money(o.original_amount_cents,o.currency)],['Discount',money(o.discount_amount_cents,o.currency)],['Final Payable',money(o.final_amount_cents,o.currency)],['Affiliate Code',o.affiliate_code||'None'],['Affiliate Name',o.affiliate_name||'—']].map(([k,v])=>\`<tr><td style="padding:9px;border-bottom:1px solid #eee;width:42%;color:#667085">\${k}</td><td style="padding:9px;border-bottom:1px solid #eee">\${String(v??'—')}</td></tr>\`).join('')}\</table><div style="background:#f0fff8;border:1px solid #b7efd8;border-radius:10px;padding:16px"><b>Razorpay Payment Link</b><div style="margin-top:8px;word-break:break-all"><a href="\${paymentLink}" style="color:#087f5b">\${paymentLink}</a></div></div><p style="margin-top:22px;font-size:12px;color:#667085">Security notice: Trust payment-related emails only from <b>support.fundfxt@gmail.com</b>.</p></div></div></div>\`;
    await sendEmail(adminEmail,\`FundFXT Payment Request — \${o.order_ref}\`,html);
    res.json({success:true,request_ref:o.order_ref,payment_link:paymentLink,status:'LINK_SENT',emailed_to:adminEmail});
  }catch(e){console.error('Payment link submission error:',e);res.status(500).json({error:e.message||'Unable to save payment link'});}
});
`;
  src=src.replace("const PORT = process.env.PORT || 3000;",patch+"\nconst PORT = process.env.PORT || 3000;");
  const tmp=path.join(os.tmpdir(),'fundfxt-server-patched-v4.js');fs.writeFileSync(tmp,src);require(tmp);
}else require(srcPath);
