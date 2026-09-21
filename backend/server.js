app.post(
  "/api/user/wallet/request-affiliate-transfer",
  authenticateToken,
  async (req, res) => {
    const { amount_cents, reason } = req.body;

    try {
      const amount = Number(amount_cents);

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          error: "amount_cents must be a positive integer",
        });
      }

      const minimumTransfer = 1000;

      if (amount < minimumTransfer) {
        return res.status(400).json({
          error: "Minimum affiliate transfer is $10.00",
        });
      }

      const transferMode = await getAffiliateTransferMode();

      const [affiliates] = await db.execute(
        `SELECT id, wallet_balance_cents
         FROM affiliates
         WHERE user_id = ?
         LIMIT 1`,
        [req.userId],
      );

      if (!affiliates.length) {
        return res.status(404).json({
          error: "Affiliate account not found",
        });
      }

      const affiliate = affiliates[0];
      const affiliateBalance = Number(
        affiliate.wallet_balance_cents || 0,
      );

      if (affiliateBalance < amount) {
        return res.status(400).json({
          error: "Insufficient affiliate wallet balance",
        });
      }

      const [[pendingRow]] = await db.query(
        `SELECT id
         FROM affiliate_wallet_transfers
         WHERE user_id = ?
           AND status = 'PENDING'
         LIMIT 1`,
        [req.userId],
      );

      if (pendingRow) {
        return res.status(409).json({
          error: "A wallet transfer is already pending",
        });
      }

      const transferRef =
        "AWT-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        crypto.randomBytes(3).toString("hex").toUpperCase();

      const cleanReason =
        reason == null
          ? null
          : String(reason).trim().slice(0, 255);

      if (transferMode === "AUTO") {
        const connection = await db.getConnection();

        try {
          await connection.beginTransaction();

          const [affiliateRows] = await connection.query(
            `SELECT id, wallet_balance_cents
             FROM affiliates
             WHERE id = ?
             FOR UPDATE`,
            [affiliate.id],
          );

          if (!affiliateRows.length) {
            await connection.rollback();
            return res.status(404).json({ error: "Affiliate account not found" });
          }

          const lockedAffiliate = affiliateRows[0];
          const lockedAffiliateBalance = Number(
            lockedAffiliate.wallet_balance_cents || 0,
          );

          if (lockedAffiliateBalance < amount) {
            await connection.rollback();
            return res.status(400).json({
              error: "Insufficient affiliate wallet balance",
            });
          }

          const [[pendingRow]] = await connection.query(
            `SELECT id
             FROM affiliate_wallet_transfers
             WHERE user_id = ?
               AND status = 'PENDING'
             LIMIT 1
             FOR UPDATE`,
            [req.userId],
          );

          if (pendingRow) {
            await connection.rollback();
            return res.status(409).json({
              error: "A wallet transfer is already pending",
            });
          }

          const autoTransferRef =
            "AWT-" +
            Date.now().toString(36).toUpperCase() +
            "-" +
            crypto.randomBytes(3).toString("hex").toUpperCase();

          const [transferResult] = await connection.execute(
            `INSERT INTO affiliate_wallet_transfers
             (
               transfer_ref,
               user_id,
               affiliate_id,
               amount_cents,
               status,
               reason,
               processed_at,
               processed_by_admin_id
             )
             VALUES (?, ?, ?, ?, 'APPROVED', ?, NOW(), NULL)`,
            [
              autoTransferRef,
              req.userId,
              affiliate.id,
              amount,
              cleanReason,
            ],
          );

          const affiliateBalanceAfter = lockedAffiliateBalance - amount;

          await connection.execute(
            `UPDATE affiliates
             SET wallet_balance_cents = wallet_balance_cents - ?
             WHERE id = ?
               AND wallet_balance_cents >= ?`,
            [amount, affiliate.id, amount],
          );

          const [affiliateTxnResult] = await connection.execute(
            `INSERT INTO affiliate_wallet_transactions
             (
               affiliate_id,
               txn_type,
               source,
               amount_cents,
               balance_after_cents,
               reference_type,
               reference_id,
               description
             )
             VALUES (?, 'DEBIT', 'MOVE_TO_WALLET', ?, ?, 'WALLET_TRANSFER', ?, ?)`,
            [
              affiliate.id,
              amount,
              affiliateBalanceAfter,
              transferResult.insertId,
              "Moved to FundFXT Wallet",
            ],
          );

          await connection.execute(
            `INSERT INTO user_wallets
             (
               user_id,
               balance_cents,
               total_received_cents
             )
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
               balance_cents = balance_cents + VALUES(balance_cents),
               total_received_cents =
                 total_received_cents + VALUES(total_received_cents)`,
            [req.userId, amount, amount],
          );

          const [walletRows] = await connection.query(
            `SELECT id, balance_cents
             FROM user_wallets
             WHERE user_id = ?
             FOR UPDATE`,
            [req.userId],
          );

          if (!walletRows.length) {
            throw new Error("User wallet could not be created");
          }

          const walletBalanceAfter = Number(walletRows[0].balance_cents || 0);

          const [userTxnResult] = await connection.execute(
            `INSERT INTO user_wallet_transactions
             (
               user_id,
               txn_type,
               source,
               amount_cents,
               balance_after_cents,
               reference_type,
               reference_id,
               description
             )
             VALUES (?, 'CREDIT', 'AFFILIATE_TRANSFER', ?, ?, 'WALLET_TRANSFER', ?, 'Transferred from affiliate earnings')`,
            [
              req.userId,
              amount,
              walletBalanceAfter,
              transferResult.insertId,
            ],
          );

          await connection.execute(
            `UPDATE affiliate_wallet_transfers
             SET user_wallet_txn_id = ?, affiliate_txn_id = ?
             WHERE id = ?`,
            [
              userTxnResult.insertId,
              affiliateTxnResult.insertId,
              transferResult.insertId,
            ],
          );

          await connection.commit();

          const [userRows] = await db.execute(
            `SELECT email, trader_id, legal_name
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [req.userId],
          );
          const user = userRows[0];

          await sendWalletTransferEmail(
            user?.email,
            user?.legal_name || user?.trader_id,
            user?.trader_id,
            "APPROVED",
            amount,
            autoTransferRef,
          );

          return res.json({
            success: true,
            transfer_ref: autoTransferRef,
            amount_cents: amount,
            status: "APPROVED",
            new_wallet_balance: walletBalanceAfter,
          });
        } catch (error) {
          await connection.rollback().catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
      }

      await db.execute(
        `INSERT INTO affiliate_wallet_transfers
         (
           transfer_ref,
           user_id,
           affiliate_id,
           amount_cents,
           status,
           reason
         )
         VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        [
          transferRef,
          req.userId,
          affiliate.id,
          amount,
          cleanReason,
        ],
      );

      res.json({
        success: true,
        transfer_ref: transferRef,
        amount_cents: amount,
        status: "PENDING",
      });
    } catch (error) {
      console.error("Affiliate wallet transfer request error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);
