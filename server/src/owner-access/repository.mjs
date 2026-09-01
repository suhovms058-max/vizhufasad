import { randomUUID } from "node:crypto";
import { getPool } from "../db/client.mjs";
import { creditWalletWithClient } from "../wallet/repository.mjs";
import { OwnerAccessError } from "./contract.mjs";

const PACKAGE_RANK = Object.freeze({ START: 1, OPTIMUM: 2, MAXIMUM: 3 });

export class OwnerAccessRepository {
  constructor(pool = getPool()) { this.pool = pool; }

  async status(userId) {
    const result = await this.pool.query(
      `select id, activated_at, last_redeemed_at, expires_at
       from owner_access_codes
       where user_id = $1 and is_active = true
         and (expires_at is null or expires_at > now())`,
      [userId],
    );
    if (!result.rowCount) return { eligible: false, activated: false };
    return {
      eligible: true,
      activated: Boolean(result.rows[0].activated_at),
      lastRedeemedAt: result.rows[0].last_redeemed_at,
    };
  }

  async redeem({ userId, codeHash, packageCode, idempotencyKey }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `owner-access:${userId}:${idempotencyKey}`,
      ]);
      const code = await client.query(
        `select id, user_id, activated_at
         from owner_access_codes
         where user_id = $1 and code_hash = $2 and is_active = true
           and (expires_at is null or expires_at > now())
         for update`,
        [userId, codeHash],
      );
      if (!code.rowCount) throw new OwnerAccessError("OWNER_CODE_NOT_AVAILABLE", 403);

      const existing = await client.query(
        `select * from owner_access_redemptions
         where user_id = $1 and idempotency_key = $2`,
        [userId, idempotencyKey],
      );
      if (existing.rowCount) {
        if (existing.rows[0].package_code !== packageCode) {
          throw new OwnerAccessError("OWNER_IDEMPOTENCY_CONFLICT", 409);
        }
        await client.query("commit");
        return { redemption: existing.rows[0], idempotent: true };
      }

      const tariff = await client.query(
        `select code, credits from tariff_plans
         where code = $1 and is_active = true and is_public = true
           and valid_from <= now() and (valid_until is null or valid_until > now())
         order by valid_from desc limit 1`,
        [packageCode],
      );
      if (!tariff.rowCount || !PACKAGE_RANK[tariff.rows[0].code]) {
        throw new OwnerAccessError("OWNER_PACKAGE_NOT_AVAILABLE", 404);
      }
      const credits = Number(tariff.rows[0].credits);
      if (!Number.isSafeInteger(credits) || credits <= 0) {
        throw new OwnerAccessError("OWNER_PACKAGE_NOT_AVAILABLE", 404);
      }

      const redemptionId = randomUUID();
      const inserted = await client.query(
        `insert into owner_access_redemptions
          (id, owner_access_code_id, user_id, package_code, credits, idempotency_key)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [redemptionId, code.rows[0].id, userId, packageCode, credits, idempotencyKey],
      );
      await creditWalletWithClient(client, {
        userId,
        type: "admin_adjustment",
        amount: credits,
        idempotencyKey: `owner-access:${userId}:${idempotencyKey}`,
        referenceType: "owner_access_redemption",
        referenceId: redemptionId,
        metadata: { source: "owner_access_code", packageCode, maximumAccess: true },
      });
      await client.query(
        `update owner_access_codes
         set activated_at = coalesce(activated_at, now()), last_redeemed_at = now(), updated_at = now()
         where id = $1`,
        [code.rows[0].id],
      );
      await client.query(
        `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
         values ($1, 'owner_access.redeemed', 'owner_access_redemption', $2,
           jsonb_build_object('packageCode', $3::text, 'credits', $4::int))`,
        [userId, redemptionId, packageCode, credits],
      );
      await client.query("commit");
      return { redemption: inserted.rows[0], idempotent: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
