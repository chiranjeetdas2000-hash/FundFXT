const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const originalPost = express.application.post;
const originalGet = express.application.get;
const originalPut = express.application.put;
const originalListen = express.application.listen;

let installed = false;
let db = null;

function createDb() {
    return mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT),
        waitForConnections: true,
        connectionLimit: 5,
        ssl: {
            rejectUnauthorized: false,
        },
    });
}

function authenticateUser(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            error: "No token",
        });
    }

    jwt.verify(
        token,
        process.env.JWT_SECRET || "secret",
        (error, decoded) => {
            if (error || !decoded?.userId) {
                return res.status(403).json({
                    error: "Invalid token",
                });
            }

            req.userId = decoded.userId;
            next();
        },
    );
}

const SUPPORTED_SYMBOLS = new Set([
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "AUDUSD",
    "USDCAD",
    "NZDUSD",
    "EURGBP",
    "EURJPY",
    "EURAUD",
    "EURCHF",
    "EURNZD",
    "GBPJPY",
    "GBPCHF",
    "GBPAUD",
    "GBPNZD",
    "AUDJPY",
    "AUDNZD",
    "AUDCAD",
    "AUDCHF",
    "CADJPY",
    "CADCHF",
    "CHFJPY",
    "NZDJPY",
    "NZDCHF",
    "NZDCAD",
    "XAUUSD",
    "XAGUSD",
]);

const PENDING_TYPES = new Set([
    "BUY_LIMIT",
    "SELL_LIMIT",
    "BUY_STOP",
    "SELL_STOP",
]);

function validNumber(value) {
    return Number.isFinite(Number(value));
}

function pendingPriceIsValid(orderType, side, entry, bid, ask) {
    if (!validNumber(entry)) {
        return false;
    }

    if (!validNumber(bid) || !validNumber(ask)) {
        return true;
    }

    if (orderType === "BUY_LIMIT" && side === "BUY") {
        return entry < ask;
    }

    if (orderType === "SELL_LIMIT" && side === "SELL") {
        return entry > bid;
    }

    if (orderType === "BUY_STOP" && side === "BUY") {
        return entry > ask;
    }

    if (orderType === "SELL_STOP" && side === "SELL") {
        return entry < bid;
    }

    return false;
}

function slTpIsValid(side, entry, stopLoss, takeProfit) {
    if (!validNumber(entry)) {
        return false;
    }

    if (stopLoss !== null && validNumber(stopLoss)) {
        if (side === "BUY" && Number(stopLoss) >= entry) {
            return false;
        }

        if (side === "SELL" && Number(stopLoss) <= entry) {
            return false;
        }
    }

    if (takeProfit !== null && validNumber(takeProfit)) {
        if (side === "BUY" && Number(takeProfit) <= entry) {
            return false;
        }

        if (side === "SELL" && Number(takeProfit) >= entry) {
            return false;
        }
    }

    return true;
}

async function ensureFavoriteSchema() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS account_favorite_pairs (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            account_id BIGINT NOT NULL,
            symbol VARCHAR(20) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_account_favorite_pair (account_id, symbol),
            KEY idx_account_favorite_pairs_account (account_id)
        )
    `);
}

async function ensurePendingSchema() {
    const [columns] = await db.execute(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'trades'
          AND COLUMN_NAME = 'order_type'
    `);

    if (!columns.length) {
        await db.execute(`
            ALTER TABLE trades
            ADD COLUMN order_type VARCHAR(30) NULL AFTER side
        `);
    }

    await db.execute(`
        UPDATE trades
        SET order_type = 'MARKET'
        WHERE order_type IS NULL
          AND status <> 'PENDING'
    `);
}

async function findAccount(accountCode, userId) {
    const [accounts] = await db.execute(
        `SELECT id, account_code, status
         FROM accounts
         WHERE account_code = ?
           AND user_id = ?
         LIMIT 1`,
        [accountCode, userId],
    );

    return accounts[0] || null;
}

async function install() {
    if (installed) {
        return;
    }

    installed = true;
    db = createDb();

    await ensureFavoriteSchema();
    await ensurePendingSchema();

    console.log("Trading terminal pair/order bridge registered");
}

express.application.get = function (path, ...handlers) {
    if (path !== "/api/trading/favorites" || !handlers.length) {
        return originalGet.call(this, path, ...handlers);
    }

    return originalGet.call(
        this,
        path,
        ...handlers.slice(0, -1),
        authenticateUser,
        async (req, res) => {
            const accountCode = String(req.query.account_code || "")
                .trim();

            if (!accountCode) {
                return res.status(400).json({
                    success: false,
                    error: "account_code is required",
                });
            }

            try {
                const account = await findAccount(accountCode, req.userId);

                if (!account) {
                    return res.status(404).json({
                        success: false,
                        error: "Account not found",
                    });
                }

                const [rows] = await db.execute(
                    `SELECT symbol
                     FROM account_favorite_pairs
                     WHERE account_id = ?
                     ORDER BY id ASC`,
                    [account.id],
                );

                res.json({
                    success: true,
                    account_code: account.account_code,
                    favorites: rows.map((row) => row.symbol),
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message,
                });
            }
        },
    );
};

express.application.put = function (path, ...handlers) {
    if (path !== "/api/trading/favorites" || !handlers.length) {
        return originalPut.call(this, path, ...handlers);
    }

    return originalPut.call(
        this,
        path,
        ...handlers.slice(0, -1),
        authenticateUser,
        async (req, res) => {
            const accountCode = String(req.body?.account_code || "")
                .trim();
            const requested = Array.isArray(req.body?.favorites)
                ? req.body.favorites
                : [];

            if (!accountCode) {
                return res.status(400).json({
                    success: false,
                    error: "account_code is required",
                });
            }

            const favorites = [
                ...new Set(
                    requested
                        .map((symbol) => String(symbol).trim().toUpperCase())
                        .filter((symbol) => SUPPORTED_SYMBOLS.has(symbol)),
                ),
            ];

            if (!favorites.length) {
                return res.status(400).json({
                    success: false,
                    error: "At least one supported favorite pair is required",
                });
            }

            try {
                const account = await findAccount(accountCode, req.userId);

                if (!account) {
                    return res.status(404).json({
                        success: false,
                        error: "Account not found",
                    });
                }

                const connection = await db.getConnection();

                try {
                    await connection.beginTransaction();

                    await connection.execute(
                        `DELETE FROM account_favorite_pairs
                         WHERE account_id = ?`,
                        [account.id],
                    );

                    for (const symbol of favorites) {
                        await connection.execute(
                            `INSERT INTO account_favorite_pairs
                             (account_id, symbol)
                             VALUES (?, ?)`,
                            [account.id, symbol],
                        );
                    }

                    await connection.commit();
                } catch (error) {
                    await connection.rollback();
                    throw error;
                } finally {
                    connection.release();
                }

                res.json({
                    success: true,
                    account_code: account.account_code,
                    favorites,
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message,
                });
            }
        },
    );
};

express.application.post = function (path, ...handlers) {
    if (path !== "/api/trades/pending" || !handlers.length) {
        return originalPost.call(this, path, ...handlers);
    }

    const originalHandler = handlers[handlers.length - 1];

    const wrappedHandler = async (req, res, next) => {
        const body = req.body || {};
        const orderType = String(body.order_type || "")
            .trim()
            .toUpperCase();
        const side = String(body.side || "")
            .trim()
            .toUpperCase();
        const symbol = String(body.symbol || "")
            .trim()
            .toUpperCase();
        const entry = Number(body.limit_price);
        const stopLoss = body.sl === null || body.sl === ""
            ? null
            : Number(body.sl);
        const takeProfit = body.tp === null || body.tp === ""
            ? null
            : Number(body.tp);

        if (!PENDING_TYPES.has(orderType)) {
            return res.status(400).json({
                success: false,
                error: "Invalid pending order type",
            });
        }

        if (!SUPPORTED_SYMBOLS.has(symbol)) {
            return res.status(400).json({
                success: false,
                error: "Invalid symbol",
            });
        }

        if (!["BUY", "SELL"].includes(side)) {
            return res.status(400).json({
                success: false,
                error: "Invalid order side",
            });
        }

        const prices = global.priceCache || {};
        const quote = prices[symbol] || {};

        if (!pendingPriceIsValid(
            orderType,
            side,
            entry,
            Number(quote.bid),
            Number(quote.ask),
        )) {
            return res.status(400).json({
                success: false,
                error: "Pending order entry price is on the wrong side of the live market",
            });
        }

        if (!slTpIsValid(side, entry, stopLoss, takeProfit)) {
            return res.status(400).json({
                success: false,
                error: "Stop Loss or Take Profit is invalid for this order side",
            });
        }

        let responseBody = null;
        const originalJson = res.json.bind(res);

        res.json = (bodyResponse) => {
            responseBody = bodyResponse;
            return originalJson(bodyResponse);
        };

        await originalHandler(req, res, next);

        const tradeId = responseBody?.trade_id;

        if (tradeId) {
            await db.execute(
                `UPDATE trades
                 SET order_type = ?
                 WHERE trade_id = ?
                   AND user_id = ?
                   AND status = 'PENDING'`,
                [orderType, tradeId, req.userId],
            );
        }
    };

    return originalPost.call(
        this,
        path,
        ...handlers.slice(0, -1),
        wrappedHandler,
    );
};

express.application.listen = function (...args) {
    install().catch((error) => {
        console.error("Trading terminal bridge startup failed:", error.message);
    });

    return originalListen.apply(this, args);
};
