const mysql = require("mysql2/promise");

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const [requests] = await db.execute(
      `SELECT TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('payment_requests', 'payment_orders')`
    );
    const map = Object.fromEntries(requests.map((row) => [row.TABLE_NAME, row.TABLE_TYPE]));

    if (!map.payment_requests && map.payment_orders === "BASE TABLE") {
      await db.query("RENAME TABLE payment_orders TO payment_requests");
      console.log("Payment table renamed: payment_orders -> payment_requests");
    }

    const [after] = await db.execute(
      `SELECT TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('payment_requests', 'payment_orders')`
    );
    const current = Object.fromEntries(after.map((row) => [row.TABLE_NAME, row.TABLE_TYPE]));

    if (!current.payment_requests) {
      throw new Error("payment_requests table does not exist and payment_orders could not be migrated");
    }

    if (!current.payment_orders) {
      await db.query(
        "CREATE VIEW payment_orders AS SELECT * FROM payment_requests"
      );
      console.log("Created payment_orders compatibility view");
    } else if (current.payment_orders === "BASE TABLE") {
      throw new Error("Both payment_requests and payment_orders are physical tables; migration stopped to prevent data loss");
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Payment request migration failed:", error.message);
  process.exit(1);
});
