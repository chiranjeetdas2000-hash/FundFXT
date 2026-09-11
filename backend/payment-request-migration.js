const mysql = require("mysql2/promise");
require("dotenv").config();

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const [tables] = await db.execute(
      `SELECT TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('payment_requests', 'payment_orders')`
    );
    const state = Object.fromEntries(tables.map((row) => [row.TABLE_NAME, row.TABLE_TYPE]));

    if (!state.payment_requests && state.payment_orders === "BASE TABLE") {
      await db.query("RENAME TABLE payment_orders TO payment_requests");
      console.log("Payment table migrated: payment_orders -> payment_requests");
    }

    const [after] = await db.execute(
      `SELECT TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('payment_requests', 'payment_orders')`
    );
    const current = Object.fromEntries(after.map((row) => [row.TABLE_NAME, row.TABLE_TYPE]));

    if (!current.payment_requests) {
      throw new Error("payment_requests table does not exist");
    }

    // Keep a read/write compatibility view only when the old table name is free.
    // Existing application code that still references payment_orders therefore continues to work,
    // while Database Control lists only physical tables and shows payment_requests.
    if (!current.payment_orders) {
      await db.query("CREATE VIEW payment_orders AS SELECT * FROM payment_requests");
      console.log("Created payment_orders compatibility view");
    } else if (current.payment_orders === "BASE TABLE") {
      console.warn("Both payment_requests and payment_orders exist; leaving both untouched to avoid data loss.");
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Payment request migration failed:", error.message);
  process.exit(1);
});
