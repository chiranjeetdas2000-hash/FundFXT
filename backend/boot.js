const fs=require('fs'),path=require('path'),os=require('os');
let src=fs.readFileSync(path.join(__dirname,'start.js'),'utf8');
if(!src.includes('FUNDFXT_BOOT_V6')){
  src=src.replace("const marker='// FUNDFXT_RUNTIME_PATCH_V4';","const marker='// FUNDFXT_RUNTIME_PATCH_V4';\n// FUNDFXT_BOOT_V6");

  // V5 search: allow admin to search by Request ID OR the saved Razorpay payment link.
  src=src.replace("if(requestRef){where.push('po.order_ref = ?');params.push(requestRef)}","if(requestRef){where.push('(po.order_ref = ? OR COALESCE(prl.payment_link,po.payment_link) LIKE ?)');params.push(requestRef,'%'+requestRef+'%')}");

  // Commission is finalized only after the challenge account is actually created.
  src=src.replace("if((status==='PAYMENT_DONE'||status==='PAYMENT_APPROVED')&&order.affiliate_code){","if(false&&order.affiliate_code){");
  const needle="await connection.execute(\"UPDATE payment_orders SET status='ACCOUNT_CREATED',account_code=? WHERE id=?\",[accountCode,id]);";
  const commissionParts=[
    needle,
    "    if(order.affiliate_code){",
    "      const [a]=await connection.execute('SELECT af.id AS affiliate_id FROM affiliates af JOIN users u ON u.id=af.user_id WHERE u.affiliate_code=? LIMIT 1',[order.affiliate_code]);",
    "      if(a.length){",
    "        const commissionCents=Math.floor((Number(order.final_amount_cents||0)*0.20)+100);",
    "        const [existing]=await connection.execute('SELECT id FROM affiliate_commissions WHERE order_id=? LIMIT 1',[id]);",
    "        if(!existing.length){",
    "          await connection.execute(\"INSERT INTO affiliate_commissions (affiliate_id,order_id,referred_user_id,model,commission_amount_cents,status) VALUES (?,?,?,?,?,'PENDING')\",[a[0].affiliate_id,id,order.user_id,order.model,commissionCents]);",
    "          await connection.execute('UPDATE affiliates SET total_sales=total_sales+1,total_earnings_cents=total_earnings_cents+?,pending_earnings_cents=pending_earnings_cents+? WHERE id=?',[commissionCents,commissionCents,a[0].affiliate_id]);",
    "        }",
    "      }",
    "    }"
  ].join('\n');
  src=src.replace(needle,commissionParts);

  // Hard intercept the Save Link + Email Support request BEFORE any legacy route.
  // This prevents the old route from ever executing SQL such as status=link_sent,
  // which caused the recurring MySQL "Unknown column 'link_sent'" error.
  const intercept=`
const FUNDFXT_V6_PAYMENT_LINK_INTERCEPT = async (req,res,next) => {
  if(req.method !== 'POST' || !req.path.startsWith('/api/admin/payment-requests/') || !req.path.endsWith('/mark-link-sent')) return next();
  try{
    const orderId=Number(req.path.split('/')[4]);
    const paymentLink=String(req.body?.payment_link||'').trim();
    if(!orderId) return res.status(400).json({error:'Invalid payment request ID'});
    if(!/^https:\\/\\//i.test(paymentLink)) return res.status(400).json({error:'Please enter a valid HTTPS Razorpay payment link'});

    await db.query(\`CREATE TABLE IF NOT EXISTS payment_request_links (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci\`);

    const [rows]=await db.query(\`SELECT po.*,u.legal_name,u.email AS user_email,u.phone AS user_phone,u.address AS user_address,au.legal_name AS affiliate_name
      FROM payment_orders po JOIN users u ON u.id=po.user_id LEFT JOIN users au ON au.id=po.affiliate_id WHERE po.id=? LIMIT 1\`,[orderId]);
    if(!rows.length) return res.status(404).json({error:'Payment request not found'});
    const o=rows[0];
    const adminEmail='support.fundfxt@gmail.com';

    // Save the link snapshot and set the REAL payment_orders status safely with a bound parameter.
    await db.query(\`INSERT INTO payment_request_links
      (payment_order_id,request_ref,user_id,user_name,user_email,user_phone,user_address,challenge_model,affiliate_code,affiliate_name,original_amount_cents,discount_amount_cents,final_amount_cents,currency,payment_link,status,sent_to_admin_email,sent_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
      ON DUPLICATE KEY UPDATE payment_link=VALUES(payment_link),status='LINK_SENT',sent_to_admin_email=VALUES(sent_to_admin_email),sent_at=NOW(),updated_at=NOW()\`,
      [o.id,o.order_ref,o.user_id,o.legal_name,o.user_email,o.user_phone,o.user_address,o.model,o.affiliate_code||null,o.affiliate_name||null,o.original_amount_cents,o.discount_amount_cents,o.final_amount_cents,o.currency||'USD',paymentLink,'LINK_SENT',adminEmail]);

    await db.execute('UPDATE payment_orders SET status=? WHERE id=?',['LINK_SENT',o.id]);

    const money=(c,cur)=>{const n=(Number(c||0)/100).toFixed(2);return (cur||'USD')==='USD'?'$'+n:(cur||'USD')+' '+n};
    const esc=v=>String(v??'—').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c));
    const html=\`<div style="font-family:Arial,sans-serif;background:#f5f7f9;padding:28px;color:#17202a"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="background:#0f0f0f;padding:22px 26px;color:#fff;font-size:24px;font-weight:800">Fund<span style="color:#00b56a">FXT</span></div><div style="padding:26px"><h2 style="margin:0 0 8px">Payment Link Request</h2><p style="color:#667085">A customer has requested a FundFXT challenge payment link. Please review the details and forward the link to the customer.</p><table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td>Request ID</td><td>\${esc(o.order_ref)}</td></tr><tr><td>Customer Name</td><td>\${esc(o.legal_name)}</td></tr><tr><td>Customer Email</td><td>\${esc(o.user_email)}</td></tr><tr><td>Customer Phone</td><td>\${esc(o.user_phone)}</td></tr><tr><td>Customer Address</td><td>\${esc(o.user_address)}</td></tr><tr><td>Challenge</td><td>\${esc(o.model)}</td></tr><tr><td>Original Amount</td><td>\${money(o.original_amount_cents,o.currency)}</td></tr><tr><td>Discount</td><td>\${money(o.discount_amount_cents,o.currency)}</td></tr><tr><td>Final Payable</td><td><b>\${money(o.final_amount_cents,o.currency)}</b></td></tr><tr><td>Affiliate Code</td><td>\${esc(o.affiliate_code||'None')}</td></tr><tr><td>Affiliate Name</td><td>\${esc(o.affiliate_name||'—')}</td></tr></table><div style="background:#f0fff8;border:1px solid #b7efd8;border-radius:10px;padding:16px"><b>Razorpay Payment Link</b><div style="margin-top:8px;word-break:break-all"><a href="\${esc(paymentLink)}">\${esc(paymentLink)}</a></div></div><p style="margin-top:22px;font-size:12px;color:#667085">Security notice: Trust payment-related emails only from <b>support.fundfxt@gmail.com</b>.</p></div></div></div>\`;
    await sendEmail(adminEmail,\`FundFXT Payment Request — \${o.order_ref}\`,html);
    return res.json({success:true,request_ref:o.order_ref,payment_link:paymentLink,status:'LINK_SENT',emailed_to:adminEmail});
  }catch(e){console.error('V6 payment link intercept:',e);return res.status(500).json({error:e.message||'Unable to save payment link'});}
};
app.use(FUNDFXT_V6_PAYMENT_LINK_INTERCEPT);
`;
  src=src.replace("app.use(express.json());",intercept+"\napp.use(express.json());");

  const tmp=path.join(os.tmpdir(),'fundfxt-start-v6.js');
  fs.writeFileSync(tmp,src);
  require(tmp);
}else require(path.join(__dirname,'start.js'));
