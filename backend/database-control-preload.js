console.log("[PRELOAD-LOAD] database-control loaded");
const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const originalListen = express.application.listen;
let installed = false;

function quoteIdentifier(value) { return "`" + String(value).replace(/`/g, "``") + "`"; }
function validIdentifier(value) { return /^[A-Za-z0-9_$-]+$/.test(String(value || "")); }

function installDatabaseControl(app) {
  console.log("[PRELOAD] database-control installer called");
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
    const sender = process.env.EMAIL_USER || "onboarding@resend.dev";
    if (!sender || !sender.includes("@")) {
      console.error("Email FROM address invalid:", sender);
      return false;
    }

    console.log("Sending email via Resend:", { from: sender, to });

    const key = process.env.EMAIL_PASS;
    if (!key || !to) return false;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: [to], subject, html }),
    });
    if (!response.ok) {
      const errBody = await response.text();
      console.error("Resend API error response:", response.status, errBody);
      throw new Error("Email API Error: " + response.status + " — " + errBody);
    }
    return true;
  }

  function accountCode(){return "ACC-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomBytes(3).toString("hex").toUpperCase();}

  async function createAccountAndCommission(connection, order) {
    if (order.account_code) return order.account_code;
    const parsed = ({
      warrior_5k: { model_key: "warrior", size_key: "5k" },
      warrior_10k: { model_key: "warrior", size_key: "10k" },
      warrior_15k: { model_key: "warrior", size_key: "15k" },
      warrior_25k: { model_key: "warrior", size_key: "25k" },
      prototype_5k: { model_key: "prototype", size_key: "5k" },
      prototype: { model_key: "prototype", size_key: "5k" },
      warrior: { model_key: "warrior", size_key: "5k" },
    })[String(order.model || "").trim()] || null;

    let startingBalanceCents;
    let resolvedModel = order.model;
    let initialPhase = "PHASE_1";

    if (parsed) {
      const [sizes] = await connection.execute(
        "SELECT * FROM challenge_sizes WHERE model_key = ? AND size_key = ? AND is_active = 1 LIMIT 1",
        [parsed.model_key, parsed.size_key]
      );

      if (sizes.length) {
        const size = sizes[0];
        startingBalanceCents = Number(size.starting_balance_cents);
        resolvedModel = parsed.model_key + "_" + parsed.size_key;

        if (parsed.model_key === "prototype") {
          initialPhase = "FUNDED";
        } else {
          initialPhase = "PHASE_1";
        }
      }
    }

    if (startingBalanceCents === undefined) {
      const [configs] = await connection.execute(
        "SELECT * FROM challenge_configs WHERE model_key = ? LIMIT 1",
        [order.model]
      );
      if (!configs.length) throw new Error("Challenge config not found for model: " + order.model);
      const config = configs[0];
      startingBalanceCents = Number(config.starting_balance_cents);

      if (order.model === "prototype_5k") {
        initialPhase = "FUNDED";
      } else {
        initialPhase = "PHASE_1";
      }
    }

    const code = accountCode();
    await connection.execute(
      `INSERT INTO accounts
       (account_code,user_id,challenge_model,phase,initial_balance_cents,balance_cents,equity_cents,day_start_balance_cents,day_start_equity_cents,equity_hwm_cents,status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [code, order.user_id, resolvedModel, initialPhase, startingBalanceCents, startingBalanceCents, startingBalanceCents, startingBalanceCents, startingBalanceCents, startingBalanceCents]
    );

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
      try{emailSent=await sendSupportEmail("support.fundfxt@gmail.com","FundFXT Payment Link — "+request.request_id+" — Customer: "+(request.legal_name||"—"),"<!DOCTYPE html><html><body style=\"margin:0;padding:0;background:#0b0e14;font-family:Arial,Helvetica,sans-serif;color:#e5e9ec;\">"+"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#0b0e14;margin:0;padding:0;width:100%;\"><tr><td align=\"center\" style=\"padding:32px 12px;\">"+"<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;max-width:600px;background:#151924;border:1px solid #2a2e39;border-radius:12px;overflow:hidden;\">"+"<tr><td align=\"center\" style=\"padding:28px 24px;background:#0b0e14;background:linear-gradient(135deg,#0b0e14,#151924);\"><div style=\"font-size:26px;font-weight:700;letter-spacing:1px;color:#e5e9ec;\">Fund<span style=\"color:#00e59a;\">FXT</span></div><div style=\"margin-top:8px;font-size:22px;font-weight:700;color:#e5e9ec;\">Payment Link Ready</div></td></tr>"+"<tr><td style=\"padding:24px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;background:#0b0e14;border:1px solid #2a2e39;border-radius:12px;\">"+"<tr><td style=\"padding:20px;\"><div style=\"font-size:12px;color:#8996a2;text-transform:uppercase;letter-spacing:.6px;\">Request ID</div><div style=\"margin-top:5px;font-family:Consolas,Monaco,monospace;font-size:14px;font-weight:700;color:#00e59a;\">"+request.request_id+"</div>"+"<div style=\"height:16px;line-height:16px;\">&nbsp;</div><div style=\"font-size:12px;color:#8996a2;text-transform:uppercase;letter-spacing:.6px;\">Customer Name</div><div style=\"margin-top:5px;font-size:15px;color:#e5e9ec;\">"+(request.legal_name||"—")+"</div>"+"<div style=\"height:16px;line-height:16px;\">&nbsp;</div><div style=\"font-size:12px;color:#8996a2;text-transform:uppercase;letter-spacing:.6px;\">Customer Email</div><div style=\"margin-top:5px;font-size:15px;\"><a href=\"mailto:"+ (request.user_email||"")+"\" style=\"color:#e5e9ec;text-decoration:none;\">"+(request.user_email||"—")+"</a></div>"+"<div style=\"height:16px;line-height:16px;\">&nbsp;</div><div style=\"font-size:12px;color:#8996a2;text-transform:uppercase;letter-spacing:.6px;\">Challenge Model</div><div style=\"margin-top:5px;font-size:15px;color:#e5e9ec;\">"+request.model+"</div>"+"<div style=\"height:18px;line-height:18px;\">&nbsp;</div><div style=\"font-size:12px;color:#8996a2;text-transform:uppercase;letter-spacing:.6px;\">Amount Payable</div><div style=\"margin-top:5px;font-size:25px;font-weight:700;color:#00e59a;\">"+(Number(request.final_amount_cents||0)/100).toFixed(2)+" "+request.currency+"</div></td></tr></table></td></tr>"+"<tr><td style=\"padding:0 24px 24px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;background:#101b1a;border:1px solid #00e59a;border-radius:12px;\"><tr><td align=\"center\" style=\"padding:24px;\"><div style=\"font-size:18px;font-weight:700;color:#e5e9ec;\">Payment Link</div><div style=\"margin-top:8px;font-size:14px;color:#8996a2;\">Forward this link to the customer</div><div style=\"margin-top:18px;\"><a href=\""+link+"\" style=\"display:inline-block;background:#00e59a;color:#0b0e14;text-decoration:none;font-size:15px;font-weight:700;padding:13px 30px;border-radius:8px;\">Pay Now</a></div><div style=\"margin-top:18px;font-size:12px;line-height:18px;word-break:break-all;\"><a href=\""+link+"\" style=\"color:#00e59a;text-decoration:none;\">"+link+"</a></div></td></tr></table></td></tr>"+"<tr><td style=\"padding:20px 24px 28px;border-top:1px solid #2a2e39;text-align:center;\"><div style=\"font-size:12px;color:#8996a2;\">FundFXT Support · support.fundfxt@gmail.com</div><div style=\"margin-top:6px;font-size:11px;color:#8996a2;\">This email was automatically generated by FundFXT.</div></td></tr></table></td></tr></table></body></html>");}catch(error){console.error("Payment link email failed:",error.message);}
      res.json({success:true,status:"PAYMENT_PENDING",emailed_to:emailSent?request.user_email:null,email_sent:emailSent,customer_name:request.legal_name||null,customer_email:request.user_email||null});
    }catch(error){try{await connection.rollback()}catch{}console.error("Payment link save failed:",error);res.status(500).json({error:error.message})}finally{connection.release()}
  });

  app.post("/api/admin/database/payment-requests/:id/status",authenticateDatabaseAdmin,async(req,res)=>{
    const requested=String(req.body?.status||"").trim().toUpperCase();
    const nextStatus=requested;
    if(!["REQUESTED","PAYMENT_PENDING","PAYMENT_DONE","REJECTED","CANCELLED"].includes(nextStatus))return res.status(400).json({error:"Allowed payment statuses are REQUESTED, PAYMENT_PENDING, PAYMENT_DONE, REJECTED or CANCELLED."});
    const connection=await db.getConnection();
    try{
      await connection.beginTransaction();
      const [rows]=await connection.execute("SELECT * FROM payment_requests WHERE id=? FOR UPDATE",[req.params.id]);
      if(!rows.length)throw new Error("Payment request not found");
      const request=rows[0];
      if(request.status==="CANCELLED"&&nextStatus!=="CANCELLED")throw new Error("A cancelled payment cannot be reopened.");
      if(!["REQUESTED","PAYMENT_PENDING","LINK_SENT","PAYMENT_DONE","CANCELLED"].includes(String(request.status).toUpperCase()))throw new Error(`Payment outcome cannot be set from ${request.status}`);
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
