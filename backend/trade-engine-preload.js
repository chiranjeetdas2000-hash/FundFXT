const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const originalListen = express.application.listen;
let installed = false;
let engineStarted = false;

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

    jwt.verify(token, process.env.JWT_SECRET || "secret", (error, decoded) => {
        if (error || !decoded?.userId) {
            return res.status(403).json({
                error: "Invalid token",
            });
        }

        req.userId = decoded.userId;
        next();
    });
}

const INSTRUMENTS = {
    EURUSD: {
        pip: 0.0001,
        size: 100000,
    },
    GBPUSD: {
        pip: 0.0001,
        size: 100000,
    },
    USDJPY: {
        pip: 0.01,
        size: 100000,
    },
    USDCHF: {
        pip: 0.0001,
        size: 100000,
    },
    AUDUSD: {
        pip: 0.0001,
        size: 100000,
    },
    USDCAD: {
        pip: 0.0001,
        size: 100000,
    },
    NZDUSD: {
        pip: 0.0001,
        size: 100000,
    },
    EURGBP: {
        pip: 0.0001,
        size: 100000,
    },
    EURJPY: {
        pip: 0.01,
        size: 100000,
    },
    EURAUD: {
        pip: 0.0001,
        size: 100000,
    },
    EURCHF: {
        pip: 0.0001,
        size: 100000,
    },
    EURNZD: {
        pip: 0.0001,
        size: 100000,
    },
    GBPJPY: {
        pip: 0.01,
        size: 100000,
    },
    GBPCHF: {
        pip: 0.0001,
        size: 100000,
    },
    GBPAUD: {
        pip: 0.0001,
        size: 100000,
    },
    GBPNZD: {
        pip: 0.0001,
        size: 100000,
    },
    AUDJPY: {
        pip: 0.01,
        size: 100000,
    },
    AUDNZD: {
        pip: 0.0001,
        size: 100000,
    },
    AUDCAD: {
        pip: 0.0001,
        size: 100000,
    },
    AUDCHF: {
        pip: 0.0001,
        size: 100000,
    },
    CADJPY: {
        pip: 0.01,
        size: 100000,
    },
    CADCHF: {
        pip: 0.0001,
        size: 100000,
    },
    CHFJPY: {
        pip: 0.01,
        size: 100000,
    },
    NZDJPY: {
        pip: 0.01,
        size: 100000,
    },
    NZDCHF: {
        pip: 0.0001,
        size: 100000,
    },
    NZDCAD: {
        pip: 0.0001,
        size: 100000,
    },
    XAUUSD: {
        pip: 0.01,
        size: 100,
    },
    XAGUSD: {
        pip: 0.001,
        size: 5000,
    },
};

function calculatePL(symbol, side, entry, current, volume) {
    const instrument = INSTRUMENTS[symbol];

    if (!instrument) {
        return 0;
    }

    let difference = Number(current) - Number(entry);

    if (side === "SELL") {
        difference = -difference;
    }

    return (difference / instrument.pip)
        * (instrument.size * instrument.pip)
        * Number(volume);
}

function pendingTriggered(order, quote) {
    const type = String(order.order_type || "").toUpperCase();
    const bid = Number(quote?.bid);
    const ask = Number(quote?.ask);
    const entry = Number(order.entry_price);

    if (!Number.isFinite(entry) || !Number.isFinite(bid) || !Number.isFinite(ask)) {
        return false;
    }

    if (type === "BUY_LIMIT") {
        return ask <= entry;
    }

    if (type === "SELL_LIMIT") {
        return bid >= entry;
    }

    if (type === "BUY_STOP") {
        return ask >= entry;
    }

    if (type === "SELL_STOP") {
        return bid <= entry;
    }

    return false;
}

function executionPrice(order, quote) {
    return order.side === "BUY"
        ? Number(quote.ask)
        : Number(quote.bid);
}

async function ensureTradeSchema(db) {
    const [columns] = await db.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'trades'
           AND COLUMN_NAME = 'order_type'`
    );

    if (!columns.length) {
        await db.execute(
            `ALTER TABLE trades
             ADD COLUMN order_type VARCHAR(30) NULL AFTER side`
        );
    }

    await db.execute(
        `UPDATE trades
         SET order_type = 'MARKET'
         WHERE order_type IS NULL
           AND status <> 'PENDING'`
    );
}

async function executePendingOrders(db) {
    const prices = global.priceCache || {};

    const [orders] = await db.execute(
        `SELECT *
         FROM trades
         WHERE status = 'PENDING'
         ORDER BY id ASC`
    );

    for (const order of orders) {
        const quote = prices[order.symbol];

        if (!pendingTriggered(order, quote)) {
            continue;
        }

        const [accounts] = await db.execute(
            `SELECT *
             FROM accounts
             WHERE id = ?
             LIMIT 1`,
            [order.account_id]
        );

        if (!accounts.length || accounts[0].status !== "ACTIVE") {
            continue;
        }

        const account = accounts[0];

        const [openRows] = await db.execute(
            `SELECT id
             FROM trades
             WHERE account_id = ?
               AND status = 'OPEN'
             LIMIT 1`,
            [account.id]
        );

        if (openRows.length) {
            continue;
        }

        const entryPrice = executionPrice(order, quote);

        if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
            continue;
        }

        await db.execute(
            `UPDATE trades
             SET status = 'OPEN',
                 order_type = ?,
                 entry_price = ?,
                 entry_time = NOW(),
                 trading_day = CURDATE(),
                 current_price = ?,
                 floating_profit_cents = 0
             WHERE trade_id = ?
               AND status = 'PENDING'`,
            [
                order.order_type,
                entryPrice,
                entryPrice,
                order.trade_id,
            ]
        );
    }
}

async function installTradeRepair(app) {
    if (installed) {
        return;
    }

    installed = true;

    const db = createDb();

    await ensureTradeSchema(db);

    app.patch(
        "/api/trades/:tradeId",
        authenticateUser,
        async (req, res) => {
            const { stop_loss, take_profit } = req.body;

            try {
                const [trades] = await db.execute(
                    `SELECT *
                     FROM trades
                     WHERE trade_id = ?
                       AND user_id = ?
                       AND status = 'OPEN'
                     LIMIT 1`,
                    [req.params.tradeId, req.userId]
                );

                if (!trades.length) {
                    return res.status(404).json({
                        error: "Open trade not found",
                    });
                }

                const trade = trades[0];
                const side = String(trade.side).toUpperCase();
                const entry = Number(trade.entry_price);
                const sl = stop_loss === null || stop_loss === ""
                    ? null
                    : Number(stop_loss);
                const tp = take_profit === null || take_profit === ""
                    ? null
                    : Number(take_profit);

                if (sl !== null && (!Number.isFinite(sl) || (side === "BUY" ? sl >= entry : sl <= entry))) {
                    return res.status(400).json({
                        error: "Invalid Stop Loss for this position",
                    });
                }

                if (tp !== null && (!Number.isFinite(tp) || (side === "BUY" ? tp <= entry : tp >= entry))) {
                    return res.status(400).json({
                        error: "Invalid Take Profit for this position",
                    });
                }

                await db.execute(
                    `UPDATE trades
                     SET stop_loss = ?,
                         take_profit = ?
                     WHERE trade_id = ?
                       AND user_id = ?
                       AND status = 'OPEN'`,
                    [sl, tp, req.params.tradeId, req.userId]
                );

                return res.json({
                    success: true,
                });
            } catch (error) {
                return res.status(500).json({
                    error: error.message,
                });
            }
        }
    );

    app.post(
        "/api/trades/:tradeId/modify",
        authenticateUser,
        async (req, res) => {
            req.url = `/api/trades/${req.params.tradeId}`;
            return res.status(410).json({
                error: "Use PATCH /api/trades/:tradeId for trade modification",
            });
        }
    );

    app.post(
        "/api/trades/:tradeId/partial-close",
        authenticateUser,
        async (req, res) => {
            const requestedVolume = Number(req.body?.volume);

            try {
                if (!Number.isFinite(requestedVolume) || requestedVolume <= 0) {
                    return res.status(400).json({
                        error: "Invalid close volume",
                    });
                }

                const connection = await db.getConnection();

                try {
                    await connection.beginTransaction();

                    const [rows] = await connection.execute(
                        `SELECT *
                         FROM trades
                         WHERE trade_id = ?
                           AND user_id = ?
                           AND status = 'OPEN'
                         FOR UPDATE`,
                        [req.params.tradeId, req.userId]
                    );

                    if (!rows.length) {
                        await connection.rollback();
                        return res.status(404).json({
                            error: "Open trade not found",
                        });
                    }

                    const trade = rows[0];
                    const currentVolume = Number(trade.volume);

                    if (requestedVolume >= currentVolume) {
                        await connection.rollback();
                        return res.status(400).json({
                            error: "Partial close must be smaller than the current position",
                        });
                    }

                    const quote = (global.priceCache || {})[trade.symbol];
                    if (!quote) {
                        await connection.rollback();
                        return res.status(400).json({
                            error: "Price not available",
                        });
                    }

                    const exitPrice = trade.side === "BUY"
                        ? Number(quote.bid)
                        : Number(quote.ask);

                    const realizedCents = Math.round(
                        calculatePL(
                            trade.symbol,
                            trade.side,
                            trade.entry_price,
                            exitPrice,
                            requestedVolume
                        ) * 100
                    );

                    const remainingVolume = Number(
                        (currentVolume - requestedVolume).toFixed(8)
                    );

                    await connection.execute(
                        `UPDATE trades
                         SET volume = ?,
                             current_price = ?,
                             floating_profit_cents = ?
                         WHERE trade_id = ?
                           AND user_id = ?
                           AND status = 'OPEN'`,
                        [
                            remainingVolume,
                            exitPrice,
                            0,
                            req.params.tradeId,
                            req.userId,
                        ]
                    );

                    await connection.execute(
                        `UPDATE accounts
                         SET balance_cents = balance_cents + ?,
                             equity_cents = equity_cents + ?
                         WHERE id = ?`,
                        [
                            realizedCents,
                            realizedCents,
                            trade.account_id,
                        ]
                    );

                    await connection.execute(
                        `INSERT INTO trades
                         (trade_id, account_id, account_code, user_id, symbol, side, volume,
                          entry_price, entry_time, exit_price, exit_time, trading_day,
                          stop_loss, take_profit, current_price, floating_profit_cents,
                          realized_profit_cents, status, close_reason)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, 'CLOSED', 'PARTIAL_CLOSE')`,
                        [
                            `PC-${Date.now().toString(36).toUpperCase()}`,
                            trade.account_id,
                            trade.account_code,
                            trade.user_id,
                            trade.symbol,
                            trade.side,
                            requestedVolume,
                            trade.entry_price,
                            trade.entry_time,
                            exitPrice,
                            trade.trading_day,
                            trade.stop_loss,
                            trade.take_profit,
                            exitPrice,
                            0,
                            realizedCents,
                        ]
                    );

                    await connection.commit();

                    return res.json({
                        success: true,
                        exit_price: exitPrice,
                        realized_profit: realizedCents / 100,
                        remaining_volume: remainingVolume,
                    });
                } catch (error) {
                    try {
                        await connection.rollback();
                    } catch {}
                    throw error;
                } finally {
                    connection.release();
                }
            } catch (error) {
                return res.status(500).json({
                    error: error.message,
                });
            }
        }
    );

    if (!engineStarted) {
        engineStarted = true;

        setInterval(() => {
            executePendingOrders(db).catch((error) => {
                console.error("Pending trade engine error:", error.message);
            });
        }, 1000);
    }

    console.log("Trade execution repair layer registered");
}

express.application.listen = function (...args) {
    installTradeRepair(this).catch((error) => {
        console.error("Trade repair startup failed:", error.message);
    });

    return originalListen.apply(this, args);
};
