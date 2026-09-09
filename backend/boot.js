const fs=require('fs'),path=require('path'),os=require('os');
let src=fs.readFileSync(path.join(__dirname,'start.js'),'utf8');
if(!src.includes('FUNDFXT_BOOT_V5')){
  src=src.replace("const marker='// FUNDFXT_RUNTIME_PATCH_V4';","const marker='// FUNDFXT_RUNTIME_PATCH_V4';\\n// FUNDFXT_BOOT_V5");
  src=src.replace("if(requestRef){where.push('po.order_ref = ?');params.push(requestRef)}","if(requestRef){where.push('(po.order_ref = ? OR COALESCE(prl.payment_link,po.payment_link) LIKE ?)');params.push(requestRef,'%'+requestRef+'%')}");
  src=src.replace("if((status==='PAYMENT_DONE'||status==='PAYMENT_APPROVED')&&order.affiliate_code){","if(false&&order.affiliate_code){");
  const needle="await connection.execute(\"UPDATE payment_orders SET status='ACCOUNT_CREATED',account_code=? WHERE id=?\",[accountCode,id]);";
  const commissionParts=[
    needle,
    "    // Affiliate commission is finalized only after the paid account is actually created.",
    "    if(order.affiliate_code){",
    "      const [a]=await connection.execute('SELECT af.id AS affiliate_id FROM affiliates af JOIN users u ON u.id=af.user_id WHERE u.affiliate_code=? LIMIT 1',[order.affiliate_code]);",
    "      if(a.length){",
    "        const commissionCents=Math.floor((Number(order.final_amount_cents||0)*0.20)+100);",
    "        const [existing]=await connection.execute('SELECT id FROM affiliate_commissions WHERE order_id=? LIMIT 1',[id]);",
    "        if(!existing.length){",
    "          await connection.execute('INSERT INTO affiliate_commissions (affiliate_id,order_id,referred_user_id,model,commission_amount_cents,status) VALUES (?,?,?,?,?,\\'PENDING\\')',[a[0].affiliate_id,id,order.user_id,order.model,commissionCents]);",
    "          await connection.execute('UPDATE affiliates SET total_sales=total_sales+1,total_earnings_cents=total_earnings_cents+?,pending_earnings_cents=pending_earnings_cents+? WHERE id=?',[commissionCents,commissionCents,a[0].affiliate_id]);",
    "        }",
    "      }",
    "    }"
  ].join('\\n');
  src=src.replace(needle,commissionParts);
  const tmp=path.join(os.tmpdir(),'fundfxt-start-v5.js');fs.writeFileSync(tmp,src);require(tmp);
}else require(path.join(__dirname,'start.js'));
