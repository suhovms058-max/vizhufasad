import { getPool } from "../db/client.mjs";
import { creditWalletWithClient } from "../wallet/repository.mjs";
import { PartnerCreditError } from "./contract.mjs";

export class PartnerCreditRepository {
  constructor(pool = getPool()) { this.pool = pool; }

  async userEmail(userId) {
    const result = await this.pool.query(
      `select email from users where id = $1 and deleted_at is null`,
      [userId],
    );
    if (!result.rowCount) throw new PartnerCreditError("PARTNER_ACCOUNT_NOT_AVAILABLE", 404);
    return result.rows[0].email;
  }

  async register(input) {
    try {
      const result = await this.pool.query(
        `insert into partner_credit_codes
          (code_hash, code_suffix, credits, contract_reference, partner_name,
           recipient_email_hash, recipient_email_masked, expires_at, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true)
         returning id, code_suffix, credits, contract_reference, partner_name,
           recipient_email_masked, expires_at, is_active`,
        [
          input.codeHash, input.codeSuffix, input.credits, input.contractReference,
          input.partnerName, input.recipientEmailHash, input.recipientEmailMasked, input.expiresAt,
        ],
      );
      return result.rows[0];
    } catch (error) {
      if (error?.code === "23505") throw new PartnerCreditError("PARTNER_CODE_ALREADY_REGISTERED", 409);
      throw error;
    }
  }

  async redeem({ userId, codeHash, recipientEmailHash, idempotencyKey }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `select * from partner_credit_codes where code_hash = $1 for update`,
        [codeHash],
      );
      if (!result.rowCount) throw new PartnerCreditError("PARTNER_CODE_NOT_AVAILABLE", 404);
      const code = result.rows[0];
      if (code.recipient_email_hash !== recipientEmailHash) {
        throw new PartnerCreditError("PARTNER_CODE_EMAIL_MISMATCH", 403);
      }
      if (code.redeemed_at) {
        if (code.redeemed_by === userId && code.redemption_idempotency_key === idempotencyKey) {
          await client.query("commit");
          return { credits: Number(code.credits), idempotent: true };
        }
        throw new PartnerCreditError("PARTNER_CODE_ALREADY_REDEEMED", 409);
      }
      if (!code.is_active || (code.expires_at && new Date(code.expires_at) <= new Date())) {
        throw new PartnerCreditError("PARTNER_CODE_NOT_AVAILABLE", 404);
      }
      const credits = Number(code.credits);
      if (!Number.isSafeInteger(credits) || credits <= 0) {
        throw new PartnerCreditError("PARTNER_CODE_NOT_CONFIGURED", 409);
      }
      await creditWalletWithClient(client, {
        userId,
        type: "promo",
        amount: credits,
        idempotencyKey: `partner-credit:${code.id}`,
        referenceType: "partner_credit_code",
        referenceId: code.id,
        metadata: { source: "partner_contract", codeSuffix: code.code_suffix },
      });
      await client.query(
        `update partner_credit_codes
         set redeemed_by = $2, redeemed_at = now(), redemption_idempotency_key = $3,
           is_active = false, updated_at = now()
         where id = $1`,
        [code.id, userId, idempotencyKey],
      );
      await client.query(
        `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
         values ($1, 'partner_credit.redeemed', 'partner_credit_code', $2,
           jsonb_build_object('credits', $3::int, 'codeSuffix', $4::text))`,
        [userId, code.id, credits, code.code_suffix],
      );
      await client.query("commit");
      return { credits, idempotent: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
