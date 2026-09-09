const fs=require('fs'),path=require('path'),os=require('os');
const srcPath=path.join(__dirname,'server.js');
let src=fs.readFileSync(srcPath,'utf8');
if(!src.includes('FUNDFXT_RUNTIME_PATCH_V1')){
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
  src=src.replace("WHERE po.status IN ('REQUESTED', 'LINK_SENT', 'PAYMENT_PENDING')","WHERE po.status IN ('REQUESTED', 'LINK_SENT', 'PAYMENT_LINK_SENT', 'PAYMENT_PENDING')");
  src=src.replace("if ((status === 'PAYMENT_DONE' || status === 'PAYMENT_APPROVED') && order.affiliate_code)","if ((status === 'PAYMENT_DONE' || status === 'PAYMENT_APPROVED' || status === 'ACCOUNT_CREATED') && order.affiliate_code)");
  src=src.replace("UPDATE affiliates SET total_sales = total_sales + 1, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?","UPDATE affiliates SET total_sales = total_sales + 1, total_earnings_cents = total_earnings_cents + ?, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?");
  src=src.replace("[commissionCents, affiliate.affiliate_id]","[commissionCents, commissionCents, affiliate.affiliate_id]");
  const marker='// FUNDFXT_RUNTIME_PATCH_V1';
  const stats=`\n${marker}\napp.get('/api/admin/dashboard-stats', authenticateAdmin, async (req,res)=>{try{\n const [p]=await db.query("SELECT COUNT(*) AS n FROM payment_orders WHERE DATE(created_at)=CURDATE()");\n const [w]=await db.query("SELECT COUNT(*) AS n FROM payout_requests WHERE DATE(created_at)=CURDATE()");\n const [pa]=await db.query("SELECT COUNT(*) AS n FROM accounts WHERE DATE(created_at)=CURDATE() AND status='PASSED'");\n const [fa]=await db.query("SELECT COUNT(*) AS n FROM accounts WHERE DATE(created_at)=CURDATE() AND status IN ('BREACHED','FAILED','EXPIRED','CLOSED')");\n const [rev]=await db.query("SELECT COALESCE(SUM(final_amount_cents),0) AS cents FROM payment_orders WHERE status IN ('PAYMENT_DONE','PAYMENT_APPROVED','ACCOUNT_CREATED')");\n res.json({success:true,stats:{payment_requests_today:Number(p[0].n||0),withdrawal_requests_today:Number(w[0].n||0),passed_accounts_today:Number(pa[0].n||0),failed_accounts_today:Number(fa[0].n||0),successful_revenue_cents:Number(rev[0].cents||0)}});\n}catch(e){console.error('Admin dashboard stats:',e.message);res.status(500).json({error:e.message})}});\n`;
  src=src.replace("const PORT = process.env.PORT || 3000;",stats+"\nconst PORT = process.env.PORT || 3000;");
  const tmp=path.join(os.tmpdir(),'fundfxt-server-patched.js');fs.writeFileSync(tmp,src);require(tmp);
}else require(srcPath);
