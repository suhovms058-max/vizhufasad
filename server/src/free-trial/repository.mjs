import { getPool } from "../db/client.mjs";
import { grantFreeBonusWithClient } from "../wallet/repository.mjs";

const POLICY_VERSION = "free-trial-v1";
const RETENTION_DAYS = 180;

export function perceptualHashDistance(left, right) {
  if (!/^[0-9a-f]{16}$/iu.test(String(left || "")) || !/^[0-9a-f]{16}$/iu.test(String(right || ""))) {
    return Number.POSITIVE_INFINITY;
  }
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (value) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

async function lock(client, key) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

export class FreeTrialRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async createPending(userId, deviceHash = null) {
    await this.pool.query(
      `insert into free_trial_entitlements (user_id, device_hash, expires_at)
       values ($1, $2, now() + interval '${RETENTION_DAYS} days')
       on conflict (user_id) where user_id is not null do nothing`,
      [userId, deviceHash],
    );
  }

  async hasSpendablePaidCredits(userId, actionCode) {
    const result = await this.pool.query(
      `select coalesce(sum(case
          when transaction.type in ('purchase', 'subscription') and transaction.status = 'committed'
            then transaction.amount
          when transaction.type = 'generation_charge' and transaction.status in ('reserved', 'committed')
            and transaction.metadata->>'funding' is distinct from 'free_trial'
            then transaction.amount
          else 0 end), 0) >= coalesce((
            select credits from action_costs where code = $2 and is_active = true
              and valid_from <= now() and (valid_until is null or valid_until > now())
            order by valid_from desc limit 1
          ), 1) as available
       from wallet_transactions transaction
       join wallets wallet on wallet.id = transaction.wallet_id
       where wallet.user_id = $1`,
      [userId, actionCode],
    );
    return result.rows[0]?.available === true;
  }

  async authorizeAndReserve({
    userId, sourceImageId, generationId, deviceHash, ipHash, networkHash,
    actionCode, idempotencyKey, freeBonusCredits = 1,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await lock(client, `free-trial:user:${userId}`);
      if (deviceHash) await lock(client, `free-trial:device:${deviceHash}`);
      await lock(client, idempotencyKey);

      const existingCharge = await client.query(
        `select transaction.* from wallet_transactions transaction
         join wallets wallet on wallet.id = transaction.wallet_id
         where wallet.user_id = $1 and transaction.idempotency_key = $2`,
        [userId, idempotencyKey],
      );
      if (existingCharge.rowCount) {
        await client.query("commit");
        return { decision: "allowed", transaction: existingCharge.rows[0], idempotent: true };
      }

      if (!deviceHash) {
        await this.#recordDecision(client, { userId, deviceHash, ipHash, networkHash, decision: "review_required", reasonCode: "DEVICE_SIGNAL_MISSING" });
        await client.query("commit");
        return { decision: "review_required", reasonCode: "DEVICE_SIGNAL_MISSING" };
      }

      const image = await client.query(
        `select i.perceptual_hash from source_images i
         join projects p on p.id = i.project_id
         where i.id = $1 and p.user_id = $2 and i.status = 'ready'`,
        [sourceImageId, userId],
      );
      const photoHash = image.rows[0]?.perceptual_hash || null;
      if (!photoHash) {
        await this.#recordDecision(client, { userId, deviceHash, ipHash, networkHash, decision: "review_required", reasonCode: "PHOTO_HASH_MISSING" });
        await client.query("commit");
        return { decision: "review_required", reasonCode: "PHOTO_HASH_MISSING" };
      }

      let entitlementResult = await client.query(
        "select * from free_trial_entitlements where user_id = $1 for update",
        [userId],
      );
      if (!entitlementResult.rowCount) {
        entitlementResult = await client.query(
          `insert into free_trial_entitlements (user_id, device_hash, expires_at)
           values ($1, $2, now() + interval '${RETENTION_DAYS} days') returning *`,
          [userId, deviceHash],
        );
      }
      const entitlement = entitlementResult.rows[0];
      if (["consumed", "denied", "review_required"].includes(entitlement.status)
        || entitlement.status === "granted" && entitlement.generation_id !== generationId) {
        const reasonCode = entitlement.reason_code || "FREE_TRIAL_ALREADY_USED";
        await this.#recordDecision(client, { userId, deviceHash, ipHash, networkHash, photoHash, decision: "denied", reasonCode });
        await client.query("commit");
        return { decision: "denied", reasonCode };
      }

      const usedDevice = await client.query(
        `select 1 from free_trial_entitlements
         where device_hash = $1 and user_id is distinct from $2
           and status in ('granted', 'consumed') and created_at > now() - interval '${RETENTION_DAYS} days'
         limit 1`,
        [deviceHash, userId],
      );
      if (usedDevice.rowCount) {
        await this.#deny(client, entitlement.id, { userId, deviceHash, ipHash, networkHash, photoHash, reasonCode: "FREE_TRIAL_DEVICE_USED" });
        await client.query("commit");
        return { decision: "denied", reasonCode: "FREE_TRIAL_DEVICE_USED" };
      }

      const priorPhotos = await client.query(
        `select photo_perceptual_hash from free_trial_entitlements
         where user_id is distinct from $1 and status in ('granted', 'consumed')
           and photo_perceptual_hash is not null
           and created_at > now() - interval '${RETENTION_DAYS} days'`,
        [userId],
      );
      if (priorPhotos.rows.some((row) => perceptualHashDistance(photoHash, row.photo_perceptual_hash) <= 6)) {
        await this.#deny(client, entitlement.id, { userId, deviceHash, ipHash, networkHash, photoHash, reasonCode: "FREE_TRIAL_PHOTO_USED" });
        await client.query("commit");
        return { decision: "denied", reasonCode: "FREE_TRIAL_PHOTO_USED" };
      }

      await grantFreeBonusWithClient(client, { userId, credits: freeBonusCredits, source: "free_trial_approved" });
      const cost = await client.query(
        `select credits from action_costs where code = $1 and is_active = true
           and valid_from <= now() and (valid_until is null or valid_until > now())
         order by valid_from desc limit 1`,
        [actionCode],
      );
      if (!cost.rowCount) throw new Error("ACTION_COST_NOT_FOUND");
      const wallet = await client.query(
        "select * from wallets where user_id = $1 and currency = 'CREDIT' for update",
        [userId],
      );
      const credits = Number(cost.rows[0].credits);
      const updatedWallet = await client.query(
        `update wallets set balance = balance - $2, updated_at = now()
         where id = $1 and balance >= $2 returning *`,
        [wallet.rows[0]?.id, credits],
      );
      if (!updatedWallet.rowCount) throw new Error("INSUFFICIENT_CREDITS");
      const charge = await client.query(
        `insert into wallet_transactions (
          wallet_id, type, status, amount, balance_after, idempotency_key,
          action_code, reference_type, reference_id, metadata
        ) values ($1, 'generation_charge', 'reserved', $2, $3, $4, $5, 'generation', $6,
          jsonb_build_object('funding', 'free_trial')) returning *`,
        [wallet.rows[0].id, -credits, updatedWallet.rows[0].balance, idempotencyKey, actionCode, generationId],
      );
      await client.query(
        `update free_trial_entitlements set status = 'granted', reason_code = null,
           device_hash = $2, ip_hash = $3, network_hash = $4, photo_perceptual_hash = $5,
           generation_id = $6, granted_at = coalesce(granted_at, now()), updated_at = now()
         where id = $1`,
        [entitlement.id, deviceHash, ipHash, networkHash, photoHash, generationId],
      );
      await this.#recordDecision(client, { userId, deviceHash, ipHash, networkHash, photoHash, decision: "allowed", reasonCode: null });
      await client.query("commit");
      return { decision: "allowed", transaction: charge.rows[0], idempotent: false, funding: "free_trial" };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async consume(generationId) {
    await this.pool.query(
      `update free_trial_entitlements set status = 'consumed', consumed_at = now(), updated_at = now()
       where generation_id = $1 and status = 'granted'`,
      [generationId],
    );
  }

  async release(generationId) {
    await this.pool.query(
      `update free_trial_entitlements set status = 'pending', generation_id = null,
         reason_code = null, updated_at = now()
       where generation_id = $1 and status = 'granted'`,
      [generationId],
    );
  }

  async cleanupExpired() {
    const result = await this.pool.query("delete from free_trial_risk_events where expires_at <= now()");
    return result.rowCount;
  }

  async #deny(client, entitlementId, input) {
    await client.query(
      `update free_trial_entitlements set status = 'denied', reason_code = $2,
         device_hash = $3, ip_hash = $4, network_hash = $5, photo_perceptual_hash = $6, updated_at = now()
       where id = $1`,
      [entitlementId, input.reasonCode, input.deviceHash, input.ipHash, input.networkHash, input.photoHash],
    );
    await this.#recordDecision(client, { ...input, decision: "denied" });
  }

  async #recordDecision(client, input) {
    await client.query(
      `insert into free_trial_risk_events (
        user_id, event_type, decision, reason_code, device_hash, ip_hash,
        network_hash, photo_perceptual_hash, policy_version, expires_at
      ) values ($1, 'free_generation_attempt', $2, $3, $4, $5, $6, $7, $8,
        now() + interval '${RETENTION_DAYS} days')`,
      [input.userId, input.decision, input.reasonCode || null, input.deviceHash || null,
        input.ipHash || null, input.networkHash || null, input.photoHash || null, POLICY_VERSION],
    );
  }
}
