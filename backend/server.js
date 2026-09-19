    symbols: BIQUOTE_SYMBOLS,
    prices: global.prices || {},
  });
});

// Same account-scoped trade fetch used by the Account Dashboard.
app.get("/api/trade/get", authenticateToken, async (req, res) => {
  try {
    const accountCode = String(req.query.account_code || "").trim();
    const accountId = Number(req.query.account_id);

    if (!accountCode && !Number.isInteger(accountId))
      return res
        .status(400)
        .json({ success: false, error: "account_code or account_id is required" });

    let accounts;

    if (Number.isInteger(accountId)) {
      const sql =
        "SELECT id, account_code FROM accounts WHERE id = ? AND user_id = ? LIMIT 1";
      const params = [accountId, req.userId];
        [accounts] = await db.execute(sql, params);
    } else {
      // Fetch all user's accounts using numeric user_id matching (works reliably).
      const [allAccounts] = await db.execute(
        "SELECT id, account_code FROM accounts WHERE user_id = ?",
        [req.userId],
      );

      // Match account_code in JavaScript to avoid MySQL string-parameter collation issues.
      accounts = allAccounts.filter(
        (a) => a.account_code === accountCode,
      );

      if (!accounts.length) {
        const normalizedCode = accountCode
          .normalize("NFKC")
          .trim()
          .replace(/[–—−]/g, "-")
          .replace(/[^\x00-\x7F]/g, "");

        const fallback = allAccounts.filter(
          (a) => a.account_code === normalizedCode,
        );

        if (fallback.length) {
          accounts.push(...fallback);
        }
      }
    }

    if (!accounts.length) {
      return res
        .status(404)
        .json({ success: false, error: "Account not found" });
    }

    const [trades] = await db.execute(
      "SELECT * FROM trades WHERE account_id = ? ORDER BY COALESCE(entry_time, created_at) DESC, id DESC",
      [accounts[0].id],
    );

    res.json({
      success: true,
      account_code: accounts[0].account_code,
      account_id: accounts[0].id,
      trades
    });
  } catch (e) {
    console.error("Trade fetch error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== TRADE ENGINE ==========
const instruments = {
  EURUSD: { pip: 0.0001, size: 100000 },
  GBPUSD: { pip: 0.0001, size: 100000 },
  USDCHF: { pip: 0.0001, size: 100000 },
  AUDUSD: { pip: 0.0001, size: 100000 },
  USDCAD: { pip: 0.0001, size: 100000 },
  NZDUSD: { pip: 0.0001, size: 100000 },
  EURGBP: { pip: 0.0001, size: 100000 },
  EURJPY: { pip: 0.01, size: 100000 },
  EURAUD: { pip: 0.0001, size: 100000 },