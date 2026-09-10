const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'backend', 'server.js');
let src = fs.readFileSync(file, 'utf8');

function replaceOnce(label, from, to) {
  if (!src.includes(from)) {
    if (src.includes(to)) return;
    throw new Error(`Affiliate repair could not find: ${label}`);
  }
  src = src.replace(from, to);
}

// 1) Commission creation: keep the existing business rule (20% + $1),
// but persist the calculation inputs so the affiliate history is auditable.
replaceOnce(
  'commission insert',
  `          const commissionCents = Math.floor(\n            order.final_amount_cents * 0.2 + 100,\n          );\n          const [existingComm] = await connection.execute(\n            "SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1",\n            [id],\n          );\n          if (existingComm.length === 0) {\n            await connection.execute(\n              \`INSERT INTO affiliate_commissions (affiliate_id, order_id, referred_user_id, model, commission_amount_cents, status) \n                         VALUES (?, ?, ?, ?, ?, 'PENDING')\`,\n              [\n                affiliate.affiliate_id,\n                id,\n                order.user_id,\n                order.model,\n                commissionCents,\n              ],\n            );\n            await connection.execute(\n              \`UPDATE affiliates SET total_sales = total_sales + 1, pending_earnings_cents = pending_earnings_cents + ? WHERE id = ?\`,\n              [commissionCents, affiliate.affiliate_id],\n            );\n          }`,
  `          const commissionRateBps = 2000; // 20%\n          const fixedBonusCents = 100; // $1.00\n          const commissionCents = Math.floor(\n            order.final_amount_cents * commissionRateBps / 10000 + fixedBonusCents,\n          );\n          const [existingComm] = await connection.execute(\n            "SELECT id FROM affiliate_commissions WHERE order_id = ? LIMIT 1",\n            [id],\n          );\n          if (existingComm.length === 0) {\n            await connection.execute(\n              \`INSERT INTO affiliate_commissions (\n                affiliate_id, order_id, referred_user_id, model,\n                commission_amount_cents, original_amount_cents,\n                discount_amount_cents, final_amount_cents, commission_rate_bps,\n                fixed_bonus_cents, paid_amount_cents, status\n              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING')\`,\n              [\n                affiliate.affiliate_id,\n                id,\n                order.user_id,\n                order.model,\n                commissionCents,\n                order.original_amount_cents || 0,\n                order.discount_amount_cents || 0,\n                order.final_amount_cents || 0,\n                commissionRateBps,\n                fixedBonusCents,\n              ],\n            );\n            await connection.execute(\n              \`UPDATE affiliates\n               SET total_sales = total_sales + 1,\n                   total_earnings_cents = COALESCE(total_earnings_cents, 0) + ?,\n                   pending_earnings_cents = COALESCE(pending_earnings_cents, 0) + ?\n               WHERE id = ?\`,\n              [commissionCents, commissionCents, affiliate.affiliate_id],\n            );\n          }`,
);

// 2) Rich affiliate dashboard: expose enough information to reconcile every commission.
replaceOnce(
  'dashboard commission query',
  `      \`SELECT \n        ac.id,\n        po.request_id AS order_ref,\n        ac.model,\n        po.paid_amount_cents,\n        ac.commission_amount_cents AS commission_cents,\n        ac.status,\n        ac.created_at,\n        u.legal_name AS customer_name\n       FROM affiliate_commissions ac\n       LEFT JOIN payment_orders po ON po.id = ac.order_id\n       LEFT JOIN users u ON u.id = ac.referred_user_id\n       WHERE ac.affiliate_id = ?\n       ORDER BY ac.created_at DESC\n       LIMIT 50\`,`,
  `      \`SELECT \n        ac.id,\n        po.request_id AS order_ref,\n        ac.model,\n        po.original_amount_cents,\n        po.discount_amount_cents,\n        po.final_amount_cents,\n        po.paid_amount_cents,\n        ac.commission_amount_cents AS commission_cents,\n        COALESCE(ac.paid_amount_cents, 0) AS paid_commission_cents,\n        ac.commission_rate_bps,\n        ac.fixed_bonus_cents,\n        ac.status,\n        ac.paid_at,\n        ac.created_at,\n        u.legal_name AS customer_name,\n        u.email AS customer_email,\n        po.affiliate_code\n       FROM affiliate_commissions ac\n       LEFT JOIN payment_orders po ON po.id = ac.order_id\n       LEFT JOIN users u ON u.id = ac.referred_user_id\n       WHERE ac.affiliate_id = ?\n       ORDER BY ac.created_at DESC\n       LIMIT 50\``,`,
);

replaceOnce(
  'dashboard totals',
  `    const totalEarnings = commissions.reduce(\n      (sum, c) => sum + Number(c.commission_cents || 0), 0\n    );\n    const pendingEarnings = commissions\n      .filter(c => String(c.status).toUpperCase() === 'PENDING')\n      .reduce((sum, c) => sum + Number(c.commission_cents || 0), 0);`,
  `    const [commissionTotals] = await db.execute(\n      \`SELECT\n        COALESCE(SUM(commission_amount_cents), 0) AS total_earnings_cents,\n        COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents, 0), 0)), 0) AS pending_earnings_cents,\n        COALESCE(SUM(COALESCE(paid_amount_cents, 0)), 0) AS paid_earnings_cents\n       FROM affiliate_commissions\n       WHERE affiliate_id = ?\`,\n      [affiliate.id]\n    );\n    const totalEarnings = Number(commissionTotals[0]?.total_earnings_cents || 0);\n    const pendingEarnings = Number(commissionTotals[0]?.pending_earnings_cents || 0);\n    const paidEarnings = Number(commissionTotals[0]?.paid_earnings_cents || 0);`,
);

replaceOnce(
  'dashboard response',
  `      total_earnings_cents: totalEarnings,\n      available_earnings_cents: pendingEarnings,\n      commissions: commissions`,
  `      total_earnings_cents: totalEarnings,\n      available_earnings_cents: pendingEarnings,\n      pending_earnings_cents: pendingEarnings,\n      paid_earnings_cents: paidEarnings,\n      commissions: commissions`,
);

// 3) Do not mark every pending commission PAID when a partial affiliate payout is paid.
replaceOnce(
  'affiliate payout paid handling',
  `      // If PAID, mark associated commissions as PAID\n      if (status === "PAID") {\n        await db.execute(\n          \`UPDATE affiliate_commissions SET status = 'PAID' \n                 WHERE affiliate_id = (SELECT id FROM affiliates WHERE user_id = ?) \n                 AND status = 'PENDING'\`,\n          [payout.user_id],\n        );\n        // Update affiliate paid earnings\n        await db.execute(\n          \`UPDATE affiliates SET paid_earnings_cents = paid_earnings_cents + ? WHERE user_id = ?\`,\n          [payout.amount_cents, payout.user_id],\n        );\n      }`,
  `      // If PAID, allocate this payout against the oldest unpaid commission balances.\n      if (status === "PAID") {\n        let remaining = Number(payout.amount_cents || 0);\n        const [pendingCommissions] = await db.execute(\n          \`SELECT id, commission_amount_cents, COALESCE(paid_amount_cents, 0) AS paid_amount_cents\n           FROM affiliate_commissions\n           WHERE affiliate_id = (SELECT id FROM affiliates WHERE user_id = ?)\n             AND status IN ('PENDING', 'PARTIALLY_PAID')\n           ORDER BY created_at ASC, id ASC\`,\n          [payout.user_id],\n        );\n\n        for (const commission of pendingCommissions) {\n          if (remaining <= 0) break;\n          const outstanding = Math.max(\n            0,\n            Number(commission.commission_amount_cents || 0) -\n              Number(commission.paid_amount_cents || 0),\n          );\n          if (!outstanding) continue;\n          const allocation = Math.min(remaining, outstanding);\n          const newPaid = Number(commission.paid_amount_cents || 0) + allocation;\n          const newStatus = newPaid >= Number(commission.commission_amount_cents || 0)\n            ? 'PAID'\n            : 'PARTIALLY_PAID';\n\n          await db.execute(\n            \`UPDATE affiliate_commissions\n             SET paid_amount_cents = ?, status = ?, paid_at = CASE WHEN ? = 'PAID' THEN NOW() ELSE paid_at END\n             WHERE id = ?\`,\n            [newPaid, newStatus, newStatus, commission.id],\n          );\n          remaining -= allocation;\n        }\n\n        await db.execute(\n          \`UPDATE affiliates SET paid_earnings_cents = COALESCE(paid_earnings_cents, 0) + ? WHERE user_id = ?\`,\n          [Number(payout.amount_cents || 0) - remaining, payout.user_id],\n        );\n      }`,
);

// 4) Run the database migration/backfill before the HTTP server starts.
const migrationMarker = '// ========== AFFILIATE SCHEMA SELF-HEAL ==========';
if (!src.includes(migrationMarker)) {
  const migration = `\n${migrationMarker}\nasync function ensureAffiliateSchema() {\n  const addColumnIfMissing = async (table, column, definition) => {\n    const [rows] = await db.execute(\n      \`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS\n       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?\`,\n      [table, column],\n    );\n    if (!Number(rows[0]?.n)) {\n      await db.execute(\`ALTER TABLE \\`${table}\\` ADD COLUMN \\`${column}\\` ${definition}\`);\n    }\n  };\n\n  await addColumnIfMissing('affiliates', 'total_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');\n  await addColumnIfMissing('affiliates', 'pending_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');\n  await addColumnIfMissing('affiliates', 'paid_earnings_cents', 'BIGINT NOT NULL DEFAULT 0');\n  await addColumnIfMissing('affiliate_commissions', 'original_amount_cents', 'BIGINT NOT NULL DEFAULT 0');\n  await addColumnIfMissing('affiliate_commissions', 'discount_amount_cents', 'BIGINT NOT NULL DEFAULT 0');\n  await addColumnIfMissing('affiliate_commissions', 'final_amount_cents', 'BIGINT NOT NULL DEFAULT 0');\n  await addColumnIfMissing('affiliate_commissions', 'commission_rate_bps', 'INT NOT NULL DEFAULT 2000');\n  await addColumnIfMissing('affiliate_commissions', 'fixed_bonus_cents', 'BIGINT NOT NULL DEFAULT 100');\n  await addColumnIfMissing('affiliate_commissions', 'paid_amount_cents', 'BIGINT NOT NULL DEFAULT 0');\n  await addColumnIfMissing('affiliate_commissions', 'paid_at', 'DATETIME NULL');\n\n  // Preserve historical PAID rows when the new paid_amount ledger is introduced.\n  await db.execute(\n    \`UPDATE affiliate_commissions\n     SET paid_amount_cents = commission_amount_cents, paid_at = COALESCE(paid_at, created_at)\n     WHERE status = 'PAID' AND COALESCE(paid_amount_cents, 0) = 0\`\n  );\n\n  // Backfill historical commission calculation inputs from the payment order.\n  await db.execute(\n    \`UPDATE affiliate_commissions ac\n     JOIN payment_orders po ON po.id = ac.order_id\n     SET ac.original_amount_cents = COALESCE(po.original_amount_cents, 0),\n         ac.discount_amount_cents = COALESCE(po.discount_amount_cents, 0),\n         ac.final_amount_cents = COALESCE(po.final_amount_cents, 0)\n     WHERE COALESCE(ac.final_amount_cents, 0) = 0\`\n  );\n\n  // Reconcile the affiliate summary ledger from the commission source of truth.\n  await db.execute(\n    \`UPDATE affiliates a\n     LEFT JOIN (\n       SELECT affiliate_id,\n              COUNT(*) AS sales,\n              COALESCE(SUM(commission_amount_cents), 0) AS total_earnings,\n              COALESCE(SUM(GREATEST(commission_amount_cents - COALESCE(paid_amount_cents, 0), 0)), 0) AS pending_earnings,\n              COALESCE(SUM(COALESCE(paid_amount_cents, 0)), 0) AS paid_earnings\n       FROM affiliate_commissions\n       GROUP BY affiliate_id\n     ) c ON c.affiliate_id = a.id\n     SET a.total_sales = COALESCE(c.sales, 0),\n         a.total_earnings_cents = COALESCE(c.total_earnings, 0),\n         a.pending_earnings_cents = COALESCE(c.pending_earnings, 0),\n         a.paid_earnings_cents = COALESCE(c.paid_earnings, 0)\`\n  );\n\n  console.log('Affiliate schema/ledger repair completed');\n}\n`;
  replaceOnce(
    'affiliate schema insertion point',
    '// ========== AFFILIATE STATS (Frontend Dashboard) ==========',
    migration + '\n// ========== AFFILIATE STATS (Frontend Dashboard) ==========',
  );
}

// Make startup wait for the self-heal migration before accepting traffic.
replaceOnce(
  'server startup',
  `const PORT = process.env.PORT || 3000;\nconst server = app.listen(PORT, () =>\n  console.log(\`🚀 Server running on port \${PORT}\`),\n);`,
  `const PORT = process.env.PORT || 3000;\nlet server;\n(async () => {\n  try {\n    await ensureAffiliateSchema();\n  } catch (migrationError) {\n    console.error('Affiliate schema repair failed:', migrationError.message);\n  }\n  server = app.listen(PORT, () =>\n    console.log(\`🚀 Server running on port \${PORT}\`),\n  );\n})();`,
);

fs.writeFileSync(file, src);
console.log('FundFXT affiliate backend repair applied successfully.');
