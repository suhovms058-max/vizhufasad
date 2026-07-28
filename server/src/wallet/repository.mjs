import { getPool } from "../db/client.mjs";

export class WalletRepositoryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function lockIdempotency(client, key) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

function sameReference(transaction, input, { compareAmount = false } = {}) {
  return transaction.type === input.type
    && (!compareAmount || Number(transaction.amount) === Number(input.amount))
    && (transaction.action_code || null) === (input.actionCode || null)
    && (transaction.reference_type || null) === (input.referenceType || null)
    && (transaction.reference_id || null) === (input.referenceId || null);
}

export async function grantFreeBonusWithClient(client, {
  userId,
  credits = 2,
  source = "new_account",
}) {
  const key = `free_bonus:${userId}`;
  await lockIdempotency(client, key);
  const existing = await client.query(
    `select transaction.*
     from wallet_transactions transaction
     join wallets wallet on wallet.id = transaction.wallet_id
     where transaction.idempotency_key = $1 and wallet.user_id = $2`,
    [key, userId],
  );
  if (existing.rowCount) return { transaction: existing.rows[0], idempotent: true };
  const wallet = await client.query(
    "select * from wallets where user_id = $1 and currency = 'CREDIT' for update",
    [userId],
  );
  if (!wallet.rowCount) throw new WalletRepositoryError("WALLET_NOT_FOUND", 404);
  const updated = await client.query(
    `update wallets set balance = balance + $2, updated_at = now()
     where id = $1 returning *`,
    [wallet.rows[0].id, credits],
  );
  const transaction = await client.query(
    `insert into wallet_transactions (
      wallet_id, type, status, amount, balance_after, idempotency_key,
      reference_type, reference_id, metadata, committed_at
    ) values ($1, 'free_bonus', 'committed', $2, $3, $4, 'user', $5, $6, now())
    returning *`,
    [
      wallet.rows[0].id,
      credits,
      updated.rows[0].balance,
      key,
      userId,
      { source },
    ],
  );
  return { transaction: transaction.rows[0], idempotent: false };
}

export class WalletRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async summary(userId) {
    const result = await this.pool.query(
      `select id, currency, balance, created_at, updated_at
       from wallets where user_id = $1 and currency = 'CREDIT'`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async history(userId, limit = 50) {
    const result = await this.pool.query(
      `select transaction.id, transaction.type, transaction.status, transaction.amount,
        transaction.balance_after, transaction.action_code, transaction.reference_type,
        transaction.reference_id, transaction.related_transaction_id,
        transaction.created_at, transaction.committed_at, transaction.refunded_at
       from wallet_transactions transaction
       join wallets wallet on wallet.id = transaction.wallet_id
       where wallet.user_id = $1 and wallet.currency = 'CREDIT'
       order by transaction.created_at desc, transaction.id desc limit $2`,
      [userId, limit],
    );
    return result.rows;
  }

  async grantFreeBonus(userId, credits = 2, source = "wallet_service") {
    return inTransaction(this.pool, (client) => grantFreeBonusWithClient(client, {
      userId, credits, source,
    }));
  }

  async listTariffs(at = new Date()) {
    const result = await this.pool.query(
      `select id, code, name, description, price_minor, currency, credits,
        valid_from, valid_until
       from tariff_plans
       where is_active = true and is_public = true
         and valid_from <= $1 and (valid_until is null or valid_until > $1)
       order by price_minor asc, credits asc`,
      [at],
    );
    return result.rows;
  }

  async listActionCosts(at = new Date()) {
    const result = await this.pool.query(
      `select id, code, name, credits, valid_from, valid_until
       from action_costs
       where is_active = true and valid_from <= $1
         and (valid_until is null or valid_until > $1)
       order by credits asc, code asc`,
      [at],
    );
    return result.rows;
  }

  async scheduleTariffVersion(input) {
    return inTransaction(this.pool, async (client) => {
      await lockIdempotency(client, `tariff:${input.code}:${input.validFrom.toISOString()}`);
      const duplicate = await client.query(
        "select * from tariff_plans where code = $1 and valid_from = $2",
        [input.code, input.validFrom],
      );
      if (duplicate.rowCount) {
        const row = duplicate.rows[0];
        const unchanged = row.name === input.name
          && Number(row.price_minor) === Number(input.priceMinor)
          && Number(row.credits) === Number(input.credits);
        if (!unchanged) throw new WalletRepositoryError("TARIFF_VERSION_CONFLICT", 409);
        return { tariff: row, idempotent: true };
      }
      await client.query(
        `select id from tariff_plans where code = $1
         and valid_from < $2 and (valid_until is null or valid_until > $2)
         for update`,
        [input.code, input.validFrom],
      );
      await client.query(
        `update tariff_plans set valid_until = $2, updated_at = now()
         where code = $1 and valid_from < $2 and (valid_until is null or valid_until > $2)`,
        [input.code, input.validFrom],
      );
      const inserted = await client.query(
        `insert into tariff_plans (
          code, name, description, price_minor, currency, credits,
          is_active, is_public, valid_from
        ) values ($1, $2, $3, $4, 'RUB', $5, true, true, $6) returning *`,
        [
          input.code, input.name, input.description || null,
          input.priceMinor, input.credits, input.validFrom,
        ],
      );
      return { tariff: inserted.rows[0], idempotent: false };
    });
  }

  async credit({
    userId,
    type,
    amount,
    idempotencyKey,
    referenceType,
    referenceId,
    metadata = {},
  }) {
    return inTransaction(this.pool, async (client) => {
      await lockIdempotency(client, idempotencyKey);
      const existing = await client.query(
        `select wt.*
         from wallet_transactions wt
         join wallets wallet on wallet.id = wt.wallet_id
         where wt.idempotency_key = $1 and wallet.user_id = $2`,
        [idempotencyKey, userId],
      );
      const expected = { type, amount, referenceType, referenceId };
      if (existing.rowCount) {
        if (!sameReference(existing.rows[0], expected, { compareAmount: true })) {
          throw new WalletRepositoryError("IDEMPOTENCY_KEY_CONFLICT", 409);
        }
        return { transaction: existing.rows[0], idempotent: true };
      }
      const wallet = await client.query(
        "select * from wallets where user_id = $1 and currency = 'CREDIT' for update",
        [userId],
      );
      if (!wallet.rowCount) throw new WalletRepositoryError("WALLET_NOT_FOUND", 404);
      const updated = await client.query(
        `update wallets set balance = balance + $2, updated_at = now()
         where id = $1 and balance + $2 >= 0 returning *`,
        [wallet.rows[0].id, amount],
      );
      if (!updated.rowCount) throw new WalletRepositoryError("INSUFFICIENT_CREDITS", 409);
      const transaction = await client.query(
        `insert into wallet_transactions (
          wallet_id, type, status, amount, balance_after, idempotency_key,
          reference_type, reference_id, metadata, committed_at
        ) values ($1, $2, 'committed', $3, $4, $5, $6, $7, $8, now()) returning *`,
        [
          wallet.rows[0].id, type, amount, updated.rows[0].balance,
          idempotencyKey, referenceType || null, referenceId || null, metadata,
        ],
      );
      return { transaction: transaction.rows[0], idempotent: false };
    });
  }

  async reserve({ userId, actionCode, idempotencyKey, referenceType, referenceId }) {
    return inTransaction(this.pool, async (client) => {
      await lockIdempotency(client, idempotencyKey);
      const existing = await client.query(
        `select transaction.*
         from wallet_transactions transaction
         join wallets wallet on wallet.id = transaction.wallet_id
         where transaction.idempotency_key = $1 and wallet.user_id = $2`,
        [idempotencyKey, userId],
      );
      const expected = {
        type: "generation_charge",
        actionCode,
        referenceType,
        referenceId,
      };
      if (existing.rowCount) {
        if (!sameReference(existing.rows[0], expected)) {
          throw new WalletRepositoryError("IDEMPOTENCY_KEY_CONFLICT", 409);
        }
        return { transaction: existing.rows[0], idempotent: true };
      }
      const cost = await client.query(
        `select credits from action_costs
         where code = $1 and is_active = true and valid_from <= now()
           and (valid_until is null or valid_until > now())
         order by valid_from desc limit 1`,
        [actionCode],
      );
      if (!cost.rowCount) throw new WalletRepositoryError("ACTION_COST_NOT_FOUND", 404);
      const credits = Number(cost.rows[0].credits);
      if (credits <= 0) throw new WalletRepositoryError("ACTION_IS_FREE", 409);
      const wallet = await client.query(
        "select * from wallets where user_id = $1 and currency = 'CREDIT' for update",
        [userId],
      );
      if (!wallet.rowCount) throw new WalletRepositoryError("WALLET_NOT_FOUND", 404);
      const updated = await client.query(
        `update wallets set balance = balance - $2, updated_at = now()
         where id = $1 and balance >= $2 returning *`,
        [wallet.rows[0].id, credits],
      );
      if (!updated.rowCount) throw new WalletRepositoryError("INSUFFICIENT_CREDITS", 409);
      const transaction = await client.query(
        `insert into wallet_transactions (
          wallet_id, type, status, amount, balance_after, idempotency_key,
          action_code, reference_type, reference_id, metadata
        ) values ($1, 'generation_charge', 'reserved', $2, $3, $4, $5, $6, $7, '{}'::jsonb)
        returning *`,
        [
          wallet.rows[0].id, -credits, updated.rows[0].balance,
          idempotencyKey, actionCode, referenceType || null, referenceId || null,
        ],
      );
      return { transaction: transaction.rows[0], idempotent: false };
    });
  }

  async commit({ userId, reservationId }) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `select transaction.*
         from wallet_transactions transaction
         join wallets wallet on wallet.id = transaction.wallet_id
         where transaction.id = $1 and wallet.user_id = $2
           and transaction.type = 'generation_charge'
         for update of transaction`,
        [reservationId, userId],
      );
      if (!result.rowCount) throw new WalletRepositoryError("RESERVATION_NOT_FOUND", 404);
      const reservation = result.rows[0];
      if (reservation.status === "committed") {
        return { transaction: reservation, idempotent: true };
      }
      if (reservation.status === "refunded") {
        throw new WalletRepositoryError("RESERVATION_ALREADY_REFUNDED", 409);
      }
      const updated = await client.query(
        `update wallet_transactions set status = 'committed', committed_at = now()
         where id = $1 returning *`,
        [reservationId],
      );
      return { transaction: updated.rows[0], idempotent: false };
    });
  }

  async refund({ userId, reservationId, idempotencyKey, reason = "technical_failure" }) {
    return inTransaction(this.pool, async (client) => {
      await lockIdempotency(client, idempotencyKey);
      const byKey = await client.query(
        `select transaction.*
         from wallet_transactions transaction
         join wallets wallet on wallet.id = transaction.wallet_id
         where transaction.idempotency_key = $1 and wallet.user_id = $2`,
        [idempotencyKey, userId],
      );
      if (byKey.rowCount) {
        if (
          byKey.rows[0].type !== "generation_refund"
          || byKey.rows[0].related_transaction_id !== reservationId
        ) {
          throw new WalletRepositoryError("IDEMPOTENCY_KEY_CONFLICT", 409);
        }
        return { transaction: byKey.rows[0], idempotent: true };
      }
      const chargeResult = await client.query(
        `select transaction.*
         from wallet_transactions transaction
         join wallets wallet on wallet.id = transaction.wallet_id
         where transaction.id = $1 and wallet.user_id = $2
           and transaction.type = 'generation_charge'
         for update of transaction`,
        [reservationId, userId],
      );
      if (!chargeResult.rowCount) throw new WalletRepositoryError("RESERVATION_NOT_FOUND", 404);
      const charge = chargeResult.rows[0];
      if (charge.status === "refunded") {
        const prior = await client.query(
          "select * from wallet_transactions where related_transaction_id = $1 and type = 'generation_refund'",
          [reservationId],
        );
        return { transaction: prior.rows[0], idempotent: true };
      }
      const credits = Math.abs(Number(charge.amount));
      const wallet = await client.query(
        `update wallets set balance = balance + $2, updated_at = now()
         where id = $1 returning *`,
        [charge.wallet_id, credits],
      );
      const refund = await client.query(
        `insert into wallet_transactions (
          wallet_id, type, status, amount, balance_after, idempotency_key,
          action_code, related_transaction_id, reference_type, reference_id,
          metadata, committed_at
        ) values ($1, 'generation_refund', 'committed', $2, $3, $4, $5, $6, $7, $8, $9, now())
        returning *`,
        [
          charge.wallet_id, credits, wallet.rows[0].balance, idempotencyKey,
          charge.action_code, charge.id, charge.reference_type, charge.reference_id, { reason },
        ],
      );
      await client.query(
        "update wallet_transactions set status = 'refunded', refunded_at = now() where id = $1",
        [charge.id],
      );
      return { transaction: refund.rows[0], idempotent: false };
    });
  }
}
