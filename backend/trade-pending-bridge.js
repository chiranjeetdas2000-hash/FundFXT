const express = require("express");
const mysql = require("mysql2/promise");

const originalPost = express.application.post;
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    waitForConnections: true,
    connectionLimit: 3,
    ssl: {
        rejectUnauthorized: false,
    },
});

express.application.post = function (path, ...handlers) {
    if (path !== "/api/trades/pending" || !handlers.length) {
        return originalPost.call(this, path, ...handlers);
    }

    const originalHandler = handlers[handlers.length - 1];
    const wrappedHandler = async (req, res, next) => {
        let responseBody = null;
        const originalJson = res.json.bind(res);

        res.json = (body) => {
            responseBody = body;
            return originalJson(body);
        };

        await originalHandler(req, res, next);

        const tradeId = responseBody?.trade_id;
        const orderType = String(req.body?.order_type || "").toUpperCase();

        if (tradeId && [
            "BUY_LIMIT",
            "SELL_LIMIT",
            "BUY_STOP",
            "SELL_STOP",
        ].includes(orderType)) {
            await db.execute(
                `UPDATE trades
                 SET order_type = ?
                 WHERE trade_id = ?
                   AND status = 'PENDING'`,
                [orderType, tradeId]
            );
        }
    };

    return originalPost.call(
        this,
        path,
        ...handlers.slice(0, -1),
        wrappedHandler
    );
};
