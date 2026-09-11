const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const originalListen = express.application.listen;
let installed = false;

function quoteIdentifier(value) { return "`" + String(value).replace(/`/g, "``") + "`"; }
function validIdentifier(value) { return /^[A-Za-z0-9_$-]+$/.test(String(value || "")); }

function installDatabaseControl(app) {
  if (installed) return;
  installed = true;
  const db = mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,port:Number(process.env.DB_PORT),waitForConnections:true,connectionLimit:5,ssl:{rejectUnauthorized:false}});

  function authenticateDatabaseAdmin(req,res,next){
    const token=req.headers.authorization?.split(" ")[1];
    if(!token)return res.status(401).json({error:"No admin token"});
    jwt.verify(token,process.env.JWT_SECRET||"secret",(err,decoded)=>{if(err||!decoded?.adminId)return res.status(403).json({error:"Invalid admin token"});req.adminId=decoded.adminId;req.adminRole=decoded.role;next()});
  }

  async function getTableMeta(table){
    if(!validIdentifier(table))throw new Error("Invalid table name");
    const [tables]=await db.execute("SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_ROWS,CREATE_TIME,UPDATE_TIME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1",[table]);
    if(!tables.length)throw new Error("Table not found");
    const [columns]=await db.execute("SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_KEY,EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",[table]);
    return {table:tables[0],columns};
  }

  async function sendSupportEmail(to, subject, html) {
    const key = process.env.EMAIL_PASS;
    if (!key || !to) return false;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_USER || "onboarding@resend.dev", to: [to], subject, html }),
    });
    if (!response.ok) throw new Error("Email API Error: " + response.status);
    return true;
  }

  function accountCode(){return "ACC-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomBytes(3).toString("hex").toUpperCase();}

  async function createAccountAndCommission(connection, order) {
    if (order.account_code) return order.account_code;
    const [configs] = await connection.execute("SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1", [order.model]);
    if (!configs.length) throw new Error("Challenge config not found for model: " + order.model);
    const config = configs[0];
    const code = accountCode();
    await connection.execute(`INSERT INTO accounts (account_code,user_id,challenge_model,phase,initial_balance_cents,balance_cents,equity_cents,status) VALUES (?, ?, ?, 'PHASE_1', ?, ?, ?, 'ACTIVE')`, [code, order.user_id, order.model, config.starting_balance_cents, config.starting_balance_cents, config.starting_balance_cents]);

    let affiliateId = null;
    let commissionCents = 0;
    if (order.affiliate_code) {
      const [affiliateRows] = await connection.execute("SELECT a.id AS affiliate_id FROM affiliates a JOIN users u ON u.id = a.user_id WHERE u.affiliate_code = ? LIMIT 1", [String(order.affiliate_code).trim()]);
      if (affiliateRows.length) {
        affiliateId = affiliateRows[0].affiliate_id;
        commissionCents = Math.floor(Number(order.final_amount_cents || 0) * 0.20 + 100);
        const [existingComm] = await connection.execute("SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1", [order.id]);
        if (!existingComm.length) {
          await connection.execute(`INSERT INTO affiliate_commissions (affiliate_id,order_id,referred_user_id,model,commission_amount_cents,original_amount_cents,discount_amount_cents,final_amount_cents,commission_rate_bps,fixed_bonus_cents,paid_amount_cents,status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2000, 100, 0, 'PENDING')`, [affiliateId, order.id, order.user_id, order.model, commissionCents, order.original_amount_cents || 0, order.discount_amount_cents || 0, order.final_amount_cents || 0]);
          await connection.execute(`UPDATE affiliates SET total_sales=COALESCE(total_sales,0)+1,total_earnings_cents=COALESCE(total_earnings_cents,0)+?,pending_earnings_cents=COALESCE(pending_earnings_cents,0)+? WHERE id=?`, [commissionCents, commissionCents, affiliateId]);
        }
      }
    }

    if (affiliateId) {
      await connection.execute(`INSERT INTO affiliate_sales (affiliate_id,order_id,request_id,affiliate_code,model,original_amount_cents,discount_amount_cents,final_amount_cents,commission_rate_bps,fixed_bonus_cents,commission_amount_cents,status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2000, 100, ?, 'PAYMENT_DONE') ON DUPLICATE KEY UPDATE request_id=VALUES(request_id),affiliate_code=VALUES(affiliate_code),model=VALUES(model),original_amount_cents=VALUES(original_amount_cents),discount_amount_cents=VALUES(discount_amount_cents),final_amount_cents=VALUES(final_amount_cents),commission_amount_cents=VALUES(commission_amount_cents),status='PAYMENT_DONE'`, [affiliateId, order.id, order.request_id, order.affiliate_code, order.model, order.original_amount_cents || 0, order.discount_amount_cents || 0, order.final_amount_cents || 0, commissionCents]);
    }
    await connection.execute("UPDATE payment_requests SET account_code=?,updated_at=NOW() WHERE id=?", [code, order.id]);
    return code;
  }

  app.get("/api/admin/database/tables",authenticateDatabaseAdmin,async(req,res)=>{try{const [tables]=await db.execute(`SELECT t.TABLE_NAME AS name,t.TABLE_TYPE AS type,t.ENGINE AS engine,t.TABLE_ROWS AS estimated_rows,t.CREATE_TIME AS created_at,t.UPDATE_TIME AS updated_at,(SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME) AS column_count FROM INFORMATION_SCHEMA.TABLES t WHERE t.TABLE_SCHEMA=DATABASE() ORDER BY t.TABLE_NAME ASC`);res.json({success:true,database:process.env.DB_NAME,tables})}catch(error){res.status(500).json({error:error.message})}});

  app.get("/api/admin/database/tables/:table/schema",authenticateDatabaseAdmin,async(req,res)=>{try{const meta=await getTableMeta(req.params.table);const [indexes]=await db.execute(`SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX`,[req.params.table]);res.json({success:true,...meta,indexes})}catch(error){res.status(400).json({error:error.message})}});

  app.get("/api/admin/database/tables/:table/rows",authenticateDatabaseAdmin,async(req,res)=>{try{
    const meta=await getTableMeta(req.params.table), page=Math.max(Number.parseInt(req.query.page,10)||1,1), pageSize=Math.min(Math.max(Number.parseInt(req.query.pageSize,10)||50,1),200), search=String(req.query.search||"").trim();
    const where=[],params=[];
    if(search){const searchable=meta.columns.slice(0,40);where.push("("+searchable.map(c=>`CAST(${quoteIdentifier(c.COLUMN_NAME)} AS CHAR) LIKE ?`).join(" OR ")+")");searchable.forEach(()=>params.push(`%${search}%`))}
    const whereSql=where.length?" WHERE "+where.join(" AND "):"";
    const [countRows]=await db.execute(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(req.params.table)}${whereSql}`,params);
    const total=Number(countRows[0]?.total||0),totalPages=Math.max(Math.ceil(total/pageSize),1),safePage=Math.min(page,totalPages),offset=(safePage-1)*pageSize;
    const pk=meta.columns.find(c=>c.COLUMN_KEY==='PRI'),orderColumn=pk?.COLUMN_NAME||meta.columns[0]?.COLUMN_NAME;
    const orderSql=orderColumn?` ORDER BY ${quoteIdentifier(orderColumn)} DESC`:"";
    const [rows]=await db.execute(`SELECT * FROM ${quoteIdentifier(req.params.table)}${whereSql}${orderSql} LIMIT ? OFFSET ?`,[...params,pageSize,offset]);
    res.json({success:true,table:meta.table,columns:meta.columns,rows,page:safePage,pageSize,total,totalPages});
  }catch(error){res.status(400).json({error:error.message})}});

  app.post("/api/admin/database/tables/:table/rows",authenticateDatabaseAdmin,async(req,res)=>{try{const table=req.params.table,meta=await getTableMeta(table),input=req.body?.data;if(!input||typeof input!=="object"||Array.isArray(input))return res.status(400).json({error:"data object is required"});const allowed=new Set(meta.columns.map(c=>c.COLUMN_NAME)),entries=Object.entries(input).filter(([key])=>allowed.has(key));if(!entries.length)return res.status(400).json({error:"No valid columns supplied"});const names=entries.map(([key])=>quoteIdentifier(key)).join(", "),placeholders=entries.map(()=>"?").join(", "),values=entries.map(([,value])=>value===""?null:value);const [result]=await db.execute(`INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders})`,values);res.json({success:true,insertId:result.insertId})}catch(error){res.status(400).json({error:error.message})}});

  app.patch("/api/admin/database/tables/:table/rows/:id",authenticateDatabaseAdmin,async(req,res)=>{try{const table=req.params.table,meta=await getTableMeta(table),primary=meta.columns.filter(c=>c.COLUMN_KEY==='PRI');if(primary.length!==1)return res.status(400).json({error:"Edit requires exactly one primary key column"});const pk=primary[0].COLUMN_NAME,input=req.body?.data;if(!input||typeof input!=="object"||Array.isArray(input))return res.status(400).json({error:"data object is required"});const allowed=new Set(meta.columns.map(c=>c.COLUMN_NAME)),entries=Object.entries(input).filter(([key])=>allowed.has(key)&&key!==pk);if(!entries.length)return res.status(400).json({error:"No editable columns supplied"});const setSql=entries.map(([key])=>`${quoteIdentifier(key)}=?`).join(", "),values=entries.map(([,value])=>value===""?null:value);values.push(req.params.id);const [result]=await db.execute(`UPDATE ${quoteIdentifier(table)} SET ${setSql} WHERE ${quoteIdentifier(pk)}=? LIMIT 1`,values);res.json({success:true,affectedRows:result.affectedRows})}catch(error){res.status(400).json({error:error.message})}});

  app.delete("/api/admin/database/tables/:table/rows/:id",authenticateDatabaseAdmin,async(req,res)=>{try{const table=req.params.table,meta=await getTableMeta(table),primary=meta.columns.filter(c=>c.COLUMN_KEY==='PRI');if(primary.length!==1)return res.status(400).json({error:"Delete requires exactly one primary key column"});const pk=primary[0].COLUMN_NAME;const [result]=await db.execute(`DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(pk)}=? LIMIT 1`,[req.params.id]);res.json({success:true,affectedRows:result.affectedRows})}catch(error){res.status(400).json({error:error.message})}});

  app.post("/api/admin/database/payment-requests/:id/link",authenticateDatabaseAdmin,async(req,res)=>{
    const link=String(req.body?.razorpay_link||"").trim();
    let parsed;
    try { parsed=new URL(link); } catch { return res.status(400).json({error:"Enter a valid HTTPS Razorpay payment link."}); }
    if(parsed.protocol!=="https:") return res.status(400).json({error:"Payment link must use HTTPS."});
    const connection=await db.getConnection();
    try{
      await connection.beginTransaction();
      const [rows]=await connection.execute(`SELECT pr.*,u.email AS user_email,u.legal_name FROM payment_requests pr LEFT JOIN users u ON u.id=pr.user_id WHERE pr.id=? FOR UPDATE`,[req.params.id]);
      if(!rows.length)throw new Error("Payment request not found");
      const request=rows[0];
      if(!["REQUESTED","LINK_SENT","PAYMENT_PENDING"].includes(String(request.status).toUpperCase()))throw new Error(`Payment link cannot be changed from ${request.status}.`);
      // Some existing databases use a short/ENUM status column that rejects LINK_SENT.
      // PAYMENT_PENDING is the canonical compatible state after a Razorpay link is attached.
      await connection.execute("UPDATE payment_requests SET razorpay_link=?,status='PAYMENT_PENDING',updated_at=NOW() WHERE id=?",[link,request.id]);
      await connection.commit();
      let emailSent=false;
      try{emailSent=await sendSupportEmail(request.user_email,`FundFXT payment link — ${request.request_id}`,`<h2>FundFXT Payment</h2><p>Hello ${request.legal_name||"Trader"},</p><p>Your request <b>${request.request_id}</b> is ready for payment.</p><p>Challenge: <b>${request.model}</b></p><p>Payable: <b>${(Number(request.final_amount_cents||0)/100).toFixed(2)} ${request.currency}</b></p><p><a href="${link}">Pay Now</a></p>`);}catch(error){console.error("Payment link email failed:",error.message);}
      res.json({success:true,status:"PAYMENT_PENDING",emailed_to:emailSent?request.user_email:null,email_sent:emailSent,customer_name:request.legal_name||null,customer_email:request.user_email||null});
    }catch(error){try{await connection.rollback()}catch{}console.error("Payment link save failed:",error);res.status(500).json({error:error.message})}finally{connection.release()}
  });

  app.post("/api/admin/database/payment-requests/:id/status",authenticateDatabaseAdmin,async(req,res)=>{
    const requested=String(req.body?.status||"").trim().toUpperCase();
    const nextStatus=requested==="PAYMENT_APPROVED"||requested==="PAYMENT_DONE"?"PAYMENT_DONE":requested==="CANCELLED"||requested==="REJECTED"||requested==="PAYMENT_CANCELLED"?"PAYMENT_CANCELLED":requested==="PAYMENT_PENDING"?"PAYMENT_PENDING":requested;
    if(!["PAYMENT_DONE","PAYMENT_CANCELLED","PAYMENT_PENDING"].includes(nextStatus))return res.status(400).json({error:"Allowed payment outcomes are PAYMENT_PENDING, PAYMENT_DONE or PAYMENT_CANCELLED."});
    const connection=await db.getConnection();
    try{
      await connection.beginTransaction();
      const [rows]=await connection.execute("SELECT * FROM payment_requests WHERE id=? FOR UPDATE",[req.params.id]);
      if(!rows.length)throw new Error("Payment request not found");
      const request=rows[0];
      if(request.status==="PAYMENT_CANCELLED"&&nextStatus!=="PAYMENT_CANCELLED")throw new Error("A cancelled payment cannot be reopened.");
      if(!["REQUESTED","PAYMENT_PENDING","LINK_SENT","PAYMENT_DONE","PAYMENT_CANCELLED"].includes(String(request.status).toUpperCase()))throw new Error(`Payment outcome cannot be set from ${request.status}`);
      let code=request.account_code||null;
      if(nextStatus==="PAYMENT_DONE")code=await createAccountAndCommission(connection,request);
      await connection.execute("UPDATE payment_requests SET status=?,paid_amount_cents=?,updated_at=NOW() WHERE id=?",[nextStatus,nextStatus==="PAYMENT_DONE"?Number(request.final_amount_cents||0):0,request.id]);
      await connection.commit();
      res.json({success:true,status:nextStatus,account_code:code});
    }catch(error){try{await connection.rollback()}catch{}console.error("Payment outcome failed:",error);res.status(500).json({error:error.message})}finally{connection.release()}
  });

  console.log("Database Control API registered");
}
express.application.listen=function(...args){installDatabaseControl(this);return originalListen.apply(this,args)};
