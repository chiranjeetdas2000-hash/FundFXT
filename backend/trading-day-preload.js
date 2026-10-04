const mysql = require("mysql2/promise");

const originalCreatePool = mysql.createPool;

function currentTradingDay() {
    return new Intl.DateTimeFormat(
        "en-CA",
        {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        },
    ).format(new Date());
}

function splitSqlList(value) {
    const parts = [];
    let current = "";
    let depth = 0;
    let quote = null;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];

        if (quote) {
            current += character;

            if (character === quote && value[index - 1] !== "\\") {
                quote = null;
            }

            continue;
        }

        if (
            character === "'" ||
            character === '"' ||
            character === "`"
        ) {
            quote = character;
            current += character;
            continue;
        }

        if (character === "(") {
            depth += 1;
        }

        if (character === ")") {
            depth -= 1;
        }

        if (character === "," && depth === 0) {
            parts.push(current.trim());
            current = "";
            continue;
        }

        current += character;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts;
}

function prepareTradeInsert(sql, values) {
    if (!/INSERT\s+INTO\s+trades\s*\(/i.test(sql)) {
        return {
            sql,
            values,
        };
    }

    const match = sql.match(
        /INSERT\s+INTO\s+trades\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/is,
    );

    if (!match) {
        return {
            sql,
            values,
        };
    }

    const columns = splitSqlList(match[1]);
    const valueExpressions = splitSqlList(match[2]);
    const tradingDayIndex = columns.findIndex(
        (column) => column.replace(/\s+/g, "").toLowerCase() === "trading_day",
    );

    if (tradingDayIndex === -1) {
        return {
            sql: sql.replace(
                /INSERT\s+INTO\s+trades\s*\(/i,
                "INSERT INTO trades (trading_day, ",
            ).replace(
                /VALUES\s*\(/i,
                "VALUES (CURDATE(), ",
            ),
            values,
        };
    }

    const tradingDayExpression = valueExpressions[tradingDayIndex];

    if (tradingDayExpression === "?") {
        let placeholderIndex = 0;

        for (let index = 0; index < tradingDayIndex; index += 1) {
            if (valueExpressions[index] === "?") {
                placeholderIndex += 1;
            }
        }

        const nextValues = Array.isArray(values)
            ? [...values]
            : values;

        const isNewOrder =
            /status\s*[^,]*['"](?:OPEN|PENDING)['"]/i.test(sql);

        if (
            isNewOrder &&
            Array.isArray(nextValues)
        ) {
            nextValues[placeholderIndex] = currentTradingDay();
        } else if (
            Array.isArray(nextValues) &&
            (nextValues[placeholderIndex] === null ||
                nextValues[placeholderIndex] === undefined ||
                nextValues[placeholderIndex] === "")
        ) {
            nextValues[placeholderIndex] = currentTradingDay();
        }

        return {
            sql,
            values: nextValues,
        };
    }

    return {
        sql,
        values,
    };
}

function prepareTradeUpdate(sql) {
    if (!/UPDATE\s+trades\s+SET/i.test(sql)) {
        return sql;
    }

    if (!/trading_day\s*=\s*CURDATE\(\)/i.test(sql)) {
        return sql;
    }

    if (!/status\s*=\s*['"]OPEN['"]/i.test(sql)) {
        return sql;
    }

    return sql.replace(
        /trading_day\s*=\s*CURDATE\(\)/i,
        "trading_day = COALESCE(trading_day, DATE(created_at), CURDATE())",
    );
}

function wrapConnection(connection) {
    if (!connection || connection.__fundFxtTradingDayWrapped) {
        return connection;
    }

    connection.__fundFxtTradingDayWrapped = true;

    const originalExecute = connection.execute.bind(connection);
    const originalQuery = connection.query.bind(connection);

    connection.execute = async function execute(sql, values) {
        const prepared = prepareTradeInsert(
            prepareTradeUpdate(String(sql)),
            values,
        );

        return originalExecute(
            prepared.sql,
            prepared.values,
        );
    };

    connection.query = async function query(sql, values) {
        const prepared = prepareTradeInsert(
            prepareTradeUpdate(String(sql)),
            values,
        );

        return originalQuery(
            prepared.sql,
            prepared.values,
        );
    };

    return connection;
}

function wrapPool(pool) {
    if (!pool || pool.__fundFxtTradingDayWrapped) {
        return pool;
    }

    pool.__fundFxtTradingDayWrapped = true;

    const originalExecute = pool.execute.bind(pool);
    const originalQuery = pool.query.bind(pool);
    const originalGetConnection = pool.getConnection.bind(pool);

    pool.execute = async function execute(sql, values) {
        const prepared = prepareTradeInsert(
            prepareTradeUpdate(String(sql)),
            values,
        );

        return originalExecute(
            prepared.sql,
            prepared.values,
        );
    };

    pool.query = async function query(sql, values) {
        const prepared = prepareTradeInsert(
            prepareTradeUpdate(String(sql)),
            values,
        );

        return originalQuery(
            prepared.sql,
            prepared.values,
        );
    };

    pool.getConnection = async function getConnection() {
        const connection = await originalGetConnection();
        return wrapConnection(connection);
    };

    return pool;
}

mysql.createPool = function createPool(...args) {
    return wrapPool(
        originalCreatePool.apply(this, args),
    );
};

console.log("Trading-day database guard loaded.");
