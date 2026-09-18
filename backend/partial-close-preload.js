const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const originalListen = express.application.listen;

express.application.listen = function (...args) {
    this.post(
        "/api/trades/:tradeId/partial-close",
        async (req, res) => {
            const authorization = req.headers["authorization"];
            const token = authorization?.split(" ")[1];

            if (!token) {
                return res.status(401).json({
                    error: "No token",
                });
            }

            let decoded;

            try {
                decoded = jwt.verify(
                    token,
                    process.env.JWT_SECRET || "secret",
                );
            } catch {
                return res.status(403).json({
                    error: "Invalid token",
                });
            }

            const userId = decoded.userId;

            const requestedVolume = Number(
                req.body?.volume,
            );

            if (
                !Number.isFinite(requestedVolume)
                || requestedVolume <= 0
            ) {
                return res.status(400).json({
                    error: "Enter a valid lot size.",
                });
            }

            const closeVolume =
                Math.round(requestedVolume * 100) / 100;

            if (
                Math.abs(
                    requestedVolume - closeVolume,
                ) > 0.000001
                || closeVolume < 0.01
            ) {
                return res.status(400).json({
                    error: "Lot size must use 0.01 steps.",
                });
            }

            const db = mysql.createPool({
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

            const connection = await db.getConnection();

            try {
                await connection.beginTransaction();

                const [rows] = await connection.execute(
                    "SELECT * FROM trades WHERE trade_id = ? AND user_id = ? AND status = 'OPEN' FOR UPDATE",
                    [
                        req.params.tradeId,
                        userId,
                    ],
                );

                if (!rows.length) {
                    await connection.rollback();

                    return res.status(404).json({
                        error: "Open trade not found.",
                    });
                }

                const trade = rows[0];

                const currentVolume =
                    Math.round(
                        Number(trade.volume) * 100,
                    ) / 100;

                if (
                    !Number.isFinite(currentVolume)
                    || currentVolume < 0.01
                ) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "Current position volume is invalid.",
                    });
                }

                if (closeVolume >= currentVolume) {
                    await connection.rollback();

                    return res.status(400).json({
                        error:
                            closeVolume === currentVolume
                                ? "Use Close to close the entire position."
                                : "Lots to close cannot exceed the current position size.",
                        current_volume: currentVolume,
                        requested_volume: closeVolume,
                    });
                }

                const remainingVolume =
                    Math.round(
                        (
                            currentVolume
                            - closeVolume
                        ) * 100,
                    ) / 100;

                if (remainingVolume < 0.01) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "At least 0.01 lot must remain open.",
                        current_volume: currentVolume,
                        requested_volume: closeVolume,
                    });
                }

                const price =
                    global.priceCache?.[trade.symbol];

                if (!price) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "Price not available.",
                    });
                }

                const exitPrice =
                    String(trade.side).toUpperCase() === "BUY"
                        ? Number(price.bid)
                        : Number(price.ask);

                if (
                    !Number.isFinite(exitPrice)
                    || exitPrice <= 0
                ) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "Exit price is unavailable.",
                    });
                }

                const symbol =
                    String(trade.symbol).toUpperCase();

                const pip =
                    /JPY$/i.test(symbol)
                        ? 0.01
                        : /XAG|SILVER/i.test(symbol)
                            ? 0.001
                            : 0.0001;

                const contractSize =
                    /XAU|GOLD/i.test(symbol)
                        ? 100
                        : /XAG|SILVER/i.test(symbol)
                            ? 5000
                            : 100000;

                let priceDifference =
                    exitPrice
                    - Number(trade.entry_price);

                if (
                    String(trade.side).toUpperCase()
                    === "SELL"
                ) {
                    priceDifference =
                        -priceDifference;
                }

                const realizedCents =
                    Math.round(
                        (
                            (
                                priceDifference
                                / pip
                            )
                            * (
                                contractSize
                                * pip
                            )
                            * closeVolume
                        ) * 100,
                    );

                const [updateResult] =
                    await connection.execute(
                        "UPDATE trades SET volume = ?, current_price = ?, floating_profit_cents = 0 WHERE trade_id = ? AND user_id = ? AND status = 'OPEN'",
                        [
                            remainingVolume,
                            exitPrice,
                            req.params.tradeId,
                            userId,
                        ],
                    );

                if (
                    updateResult.affectedRows
                    !== 1
                ) {
                    await connection.rollback();

                    return res.status(409).json({
                        error:
                            "Position changed before the partial close could be completed.",
                    });
                }

                const [accountResult] =
                    await connection.execute(
                        "UPDATE accounts SET balance_cents = balance_cents + ?, equity_cents = balance_cents WHERE id = ? AND user_id = ?",
                        [
                            realizedCents,
                            trade.account_id,
                            userId,
                        ],
                    );

                if (
                    accountResult.affectedRows
                    !== 1
                ) {
                    throw new Error(
                        "Account settlement failed.",
                    );
                }

                const partialTradeId =
                    "PC-"
                    + Date.now()
                        .toString(36)
                        .toUpperCase()
                    + "-"
                    + crypto
                        .randomBytes(3)
                        .toString("hex")
                        .toUpperCase();

                try {
                    await connection.execute(
                        "INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, exit_price, exit_time, trading_day, stop_loss, take_profit, current_price, floating_profit_cents, realized_profit_cents, status, close_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, ?, 'CLOSED', 'PARTIAL_CLOSE')",
                        [
                            partialTradeId,
                            trade.account_id,
                            trade.account_code,
                            trade.user_id,
                            trade.symbol,
                            trade.side,
                            closeVolume,
                            trade.entry_price,
                            trade.entry_time,
                            exitPrice,
                            trade.trading_day,
                            trade.stop_loss,
                            trade.take_profit,
                            exitPrice,
                            0,
                            realizedCents,
                        ],
                    );
                } catch (historyError) {
                    await connection.execute(
                        "INSERT INTO trades (trade_id, account_id, account_code, user_id, symbol, side, volume, entry_price, entry_time, exit_price, exit_time, trading_day, stop_loss, take_profit, current_price, floating_profit_cents, realized_profit_cents, status, close_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, 'CLOSED', 'MANUAL')",
                        [
                            partialTradeId,
                            trade.account_id,
                            trade.account_code,
                            trade.user_id,
                            trade.symbol,
                            trade.side,
                            closeVolume,
                            trade.entry_price,
                            trade.entry_time,
                            exitPrice,
                            trade.trading_day,
                            trade.stop_loss,
                            trade.take_profit,
                            exitPrice,
                            0,
                            realizedCents,
                        ],
                    );

                    console.warn(
                        "Partial close history reason fallback:",
                        historyError.message,
                    );
                }

                await connection.commit();

                return res.json({
                    success: true,
                    trade_id: trade.trade_id,
                    closed_trade_id: partialTradeId,
                    closed_volume: closeVolume,
                    remaining_volume: remainingVolume,
                    exit_price: exitPrice,
                    realized_profit:
                        realizedCents / 100,
                });
            } catch (error) {
                try {
                    await connection.rollback();
                } catch {}

                console.error(
                    "Partial close override error:",
                    error,
                );

                return res.status(500).json({
                    error: error.message,
                });
            } finally {
                connection.release();
                await db.end();
            }
        },
    );

    return originalListen.apply(this, args);
};
