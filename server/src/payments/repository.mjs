import { createHash } from "node:crypto";
import { getPool } from "../db/client.mjs";
import { creditWalletWithClient, WalletRepositoryError } from "../wallet/repository.mjs";
import { PaymentError } from "./contract.mjs";

async function transaction(pool, operation) {
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

async function lock(client, value) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [value]);
}

async function releaseExpiredPayments(client) {
  const expired = await client.query(
    `select payment.id, payment.promo_code_id from payments payment
     where payment.status in ('created', 'pending') and payment.checkout_expires_at <= now()
     for update skip locked`,
  );
  for (const payment of expired.rows) {
    if (payment.promo_code_id) {
      const released = await client.query(
        "delete from promo_redemptions where payment_id = $1 returning id",
        [payment.id],
      );
      if (released.rowCount) {
        await client.query(
          "update promo_codes set redemption_count = greatest(0, redemption_count - 1), updated_at = now() where id = $1",
          [payment.promo_code_id],
        );
      }
    }
  }
  if (expired.rowCount) {
    await client.query(
      "update payments set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = any($1::uuid[])",
      [expired.rows.map((payment) => payment.id)],
    );
  }
}

function publicPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    tariffPlanId: row.tariff_plan_id,
    tariffName: row.tariff_name,
    amountMinor: Number(row.amount_minor),
    originalAmountMinor: Number(row.original_amount_minor),
    currency: row.currency,
    credits: Number(row.credits),
    promoCredits: Number(row.promo_credits || 0),
    description: row.description,
    checkoutExpiresAt: row.checkout_expires_at,
    paidAt: row.paid_at,
    cancelledAt: row.cancelled_at,
    refundedAt: row.refunded_at,
    refundable: row.status === "paid" && Boolean(row.metadata?.operationKey),
    createdAt: row.created_at,
  };
}

export class PaymentRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async create({ userId, tariffPlanId, promoCode, idempotencyKey, expiresAt }) {
    return transaction(this.pool, async (client) => {
      await releaseExpiredPayments(client);
      await lock(client, `payment:${userId}:${idempotencyKey}`);
      const existing = await client.query(
        "select payment.*, tariff.name tariff_name from payments payment left join tariff_plans tariff on tariff.id = payment.tariff_plan_id where payment.user_id = $1 and payment.idempotency_key = $2",
        [userId, idempotencyKey],
      );
      if (existing.rowCount) {
        if (
          existing.rows[0].tariff_plan_id !== tariffPlanId
          || (existing.rows[0].metadata?.promoCode || null) !== (promoCode || null)
        ) {
          throw new PaymentError("IDEMPOTENCY_KEY_CONFLICT", 409);
        }
        return { payment: existing.rows[0], idempotent: true };
      }
      const tariff = await client.query(
        `select * from tariff_plans where id = $1 and is_active = true and is_public = true
         and price_minor > 0 and valid_from <= now()
         and (valid_until is null or valid_until > now()) for update`,
        [tariffPlanId],
      );
      if (!tariff.rowCount) throw new PaymentError("TARIFF_NOT_AVAILABLE", 404);
      const selected = tariff.rows[0];
      let promo = null;
      let amountMinor = Number(selected.price_minor);
      let promoCredits = 0;
      if (promoCode) {
        const promoResult = await client.query(
          `select * from promo_codes where upper(code) = upper($1) and is_active = true
           and starts_at <= now() and (expires_at is null or expires_at > now()) for update`,
          [promoCode],
        );
        if (!promoResult.rowCount) throw new PaymentError("PROMO_NOT_AVAILABLE", 409);
        promo = promoResult.rows[0];
        if (promo.max_redemptions !== null && promo.redemption_count >= promo.max_redemptions) {
          throw new PaymentError("PROMO_LIMIT_REACHED", 409);
        }
        const prior = await client.query(
          "select 1 from promo_redemptions where promo_code_id = $1 and user_id = $2",
          [promo.id, userId],
        );
        if (prior.rowCount >= Number(promo.max_per_user)) {
          throw new PaymentError("PROMO_ALREADY_USED", 409);
        }
        if (promo.kind === "discount") {
          amountMinor = Math.max(1, Math.round(amountMinor * (100 - promo.discount_percent) / 100));
        } else {
          promoCredits = Number(promo.bonus_credits);
        }
      }
      const inserted = await client.query(
        `insert into payments (
          user_id, tariff_plan_id, provider, provider_payment_id, idempotency_key,
          status, amount_minor, original_amount_minor, currency, credits,
          promo_credits, promo_code_id, description, checkout_expires_at, metadata
        ) values (
          $1, $2, 'robokassa', nextval('payment_provider_invoice_seq')::text, $3,
          'created', $4, $5, $6, $7, $8, $9, $10, $11, $12
        ) returning *`,
        [
          userId, selected.id, idempotencyKey, amountMinor, selected.price_minor,
          selected.currency, selected.credits, promoCredits, promo?.id || null,
          `Пакет «${selected.name}» — ${selected.credits + promoCredits} кредитов ВИЖУФАСАД`,
          expiresAt,
          { tariffCode: selected.code, promoCode: promo?.code || null },
        ],
      );
      const payment = inserted.rows[0];
      if (promo) {
        await client.query(
          "insert into promo_redemptions (promo_code_id, user_id, payment_id) values ($1, $2, $3)",
          [promo.id, userId, payment.id],
        );
        await client.query(
          "update promo_codes set redemption_count = redemption_count + 1, updated_at = now() where id = $1",
          [promo.id],
        );
      }
      payment.tariff_name = selected.name;
      return { payment, idempotent: false };
    });
  }

  async markPending(paymentId) {
    const result = await this.pool.query(
      `update payments set status = 'pending', updated_at = now()
       where id = $1 and status = 'created' returning *`,
      [paymentId],
    );
    return result.rows[0] || this.findInternal(paymentId);
  }

  async markFailed(paymentId, code) {
    await this.pool.query(
      `update payments set status = 'failed', failed_at = now(), updated_at = now(),
       metadata = metadata || jsonb_build_object('failureCode', $2::text)
       where id = $1 and status in ('created', 'pending')`,
      [paymentId, code],
    );
  }

  async findInternal(paymentId, userId = null) {
    const values = [paymentId];
    let ownership = "";
    if (userId) {
      values.push(userId);
      ownership = " and payment.user_id = $2";
    }
    const result = await this.pool.query(
      `select payment.*, tariff.name tariff_name, users.email user_email
       from payments payment
       left join tariff_plans tariff on tariff.id = payment.tariff_plan_id
       join users on users.id = payment.user_id
       where payment.id = $1${ownership}`,
      values,
    );
    return result.rows[0] || null;
  }

  async history(userId, limit = 50) {
    const result = await this.pool.query(
      `select payment.*, tariff.name tariff_name,
        coalesce(json_agg(json_build_object(
          'id', receipt.id, 'type', receipt.type, 'status', receipt.status,
          'receiptUrl', receipt.receipt_url, 'issuedAt', receipt.issued_at
        ) order by receipt.created_at) filter (where receipt.id is not null), '[]') receipts
       from payments payment
       left join tariff_plans tariff on tariff.id = payment.tariff_plan_id
       left join payment_receipts receipt on receipt.payment_id = payment.id
       where payment.user_id = $1
       group by payment.id, tariff.name
       order by payment.created_at desc limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({ ...publicPayment(row), receipts: row.receipts }));
  }

  async view(userId, paymentId) {
    return publicPayment(await this.findInternal(paymentId, userId));
  }

  async cancel(userId, paymentId) {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        "select * from payments where id = $1 and user_id = $2 for update",
        [paymentId, userId],
      );
      if (!result.rowCount) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
      const payment = result.rows[0];
      if (payment.status === "cancelled") return { payment: publicPayment(payment), idempotent: true };
      if (!["created", "pending", "failed"].includes(payment.status)) {
        throw new PaymentError("PAYMENT_CANNOT_BE_CANCELLED", 409);
      }
      if (payment.promo_code_id) {
        const released = await client.query(
          "delete from promo_redemptions where payment_id = $1 returning promo_code_id",
          [payment.id],
        );
        if (released.rowCount) {
          await client.query(
            "update promo_codes set redemption_count = greatest(0, redemption_count - 1), updated_at = now() where id = $1",
            [payment.promo_code_id],
          );
        }
      }
      const updated = await client.query(
        "update payments set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = $1 returning *",
        [payment.id],
      );
      return { payment: publicPayment(updated.rows[0]), idempotent: false };
    });
  }

  async processPaid(event) {
    return transaction(this.pool, async (client) => {
      await lock(client, `payment-webhook:${event.eventKey}`);
      const duplicate = await client.query(
        "select * from payment_webhook_events where provider = 'robokassa' and event_key = $1",
        [event.eventKey],
      );
      if (duplicate.rowCount && duplicate.rows[0].status === "processed") {
        const payment = await client.query("select * from payments where id = $1", [event.paymentId]);
        return { payment: publicPayment(payment.rows[0]), idempotent: true };
      }
      const paymentResult = await client.query(
        "select * from payments where id = $1 for update",
        [event.paymentId],
      );
      if (!paymentResult.rowCount) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
      const payment = paymentResult.rows[0];
      const validReference = payment.provider === "robokassa"
        && payment.provider_payment_id === event.providerPaymentId
        && Number(payment.amount_minor) === Number(event.amountMinor);
      if (!validReference) {
        await client.query(
          `insert into payment_webhook_events (
            payment_id, provider, event_key, status, signature_valid, payload, error_code, processed_at
          ) values ($1, 'robokassa', $2, 'rejected', true, $3, 'PAYMENT_DATA_MISMATCH', now())
          on conflict (provider, event_key) do update set status = 'rejected', error_code = excluded.error_code, processed_at = now()`,
          [payment.id, event.eventKey, event.raw],
        );
        return { error: "PAYMENT_DATA_MISMATCH" };
      }
      await client.query(
        `insert into payment_webhook_events (
          payment_id, provider, event_key, status, signature_valid, payload
        ) values ($1, 'robokassa', $2, 'received', true, $3)
        on conflict (provider, event_key) do nothing`,
        [payment.id, event.eventKey, event.raw],
      );
      if (!["paid", "refunded"].includes(payment.status)) {
        if (!["created", "pending"].includes(payment.status)) {
          throw new PaymentError("PAYMENT_STATE_CONFLICT", 409);
        }
        await creditWalletWithClient(client, {
          userId: payment.user_id,
          type: "purchase",
          amount: Number(payment.credits) + Number(payment.promo_credits),
          idempotencyKey: `payment:purchase:${payment.id}`,
          referenceType: "payment",
          referenceId: payment.id,
          metadata: { provider: "robokassa", providerPaymentId: payment.provider_payment_id },
        });
        await client.query(
          `update payments set status = 'paid', paid_at = now(), updated_at = now(),
           metadata = metadata || jsonb_build_object('paymentMethod', $2::text)
           where id = $1`,
          [payment.id, event.paymentMethod],
        );
        await client.query(
          `insert into payment_receipts (
            payment_id, type, status, provider_receipt_id, amount_minor, metadata
          ) values ($1, 'payment', 'pending', $2, $3, $4)
          on conflict (provider_receipt_id) do nothing`,
          [payment.id, `robokassa:${payment.provider_payment_id}:payment`, payment.amount_minor, {
            scheme: "robocheck-smz",
            note: "Receipt is issued by Robokassa and My Tax; provider link is not returned in ResultURL",
          }],
        );
        await client.query(
          `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
           values ($1, 'payment.paid', 'payment', $2, $3)`,
          [payment.user_id, payment.id, { provider: "robokassa" }],
        );
      }
      await client.query(
        `update payment_webhook_events set status = 'processed', processed_at = now()
         where provider = 'robokassa' and event_key = $1`,
        [event.eventKey],
      );
      const updated = await client.query("select * from payments where id = $1", [payment.id]);
      return { payment: publicPayment(updated.rows[0]), idempotent: payment.status === "paid" };
    });
  }

  async recordRejectedWebhook(payload, code) {
    const sanitized = { ...payload, SignatureValue: "[redacted]" };
    const eventKey = `rejected:${createHash("sha256").update(JSON.stringify(sanitized)).digest("hex")}`;
    await this.pool.query(
      `insert into payment_webhook_events (provider, event_key, status, signature_valid, payload, error_code, processed_at)
       values ('robokassa', $1, 'rejected', false, $2, $3, now())
       on conflict (provider, event_key) do nothing`,
      [eventKey, sanitized, code],
    );
  }

  async saveResult2(data) {
    const result = await this.pool.query(
      `update payments set metadata = metadata || jsonb_build_object(
        'operationKey', $2::text, 'paymentMethod', $3::text, 'result2State', $4::text
      ), updated_at = now()
      where provider = 'robokassa' and provider_payment_id = $1 returning id`,
      [String(data.invId), data.opKey, data.paymentMethod, data.state],
    );
    if (!result.rowCount) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
    return result.rows[0];
  }

  async reserveRefund(userId, paymentId, reason, idempotencyKey) {
    return transaction(this.pool, async (client) => {
      await lock(client, `refund:${paymentId}:${idempotencyKey}`);
      const paymentResult = await client.query(
        "select * from payments where id = $1 and user_id = $2 for update",
        [paymentId, userId],
      );
      if (!paymentResult.rowCount) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
      const payment = paymentResult.rows[0];
      if (payment.status === "refunded") {
        const prior = await client.query("select * from payment_refunds where payment_id = $1 order by created_at desc limit 1", [payment.id]);
        return { payment, refund: prior.rows[0], idempotent: true };
      }
      if (payment.status !== "paid") throw new PaymentError("PAYMENT_NOT_REFUNDABLE", 409);
      const existing = await client.query("select * from payment_refunds where idempotency_key = $1", [idempotencyKey]);
      if (existing.rowCount) return { payment, refund: existing.rows[0], idempotent: true };
      const refundResult = await client.query(
        `insert into payment_refunds (payment_id, idempotency_key, status, amount_minor, reason)
         values ($1, $2, 'created', $3, $4) returning *`,
        [payment.id, idempotencyKey, payment.amount_minor, reason],
      );
      const refund = refundResult.rows[0];
      await creditWalletWithClient(client, {
        userId,
        type: "admin_adjustment",
        amount: -(Number(payment.credits) + Number(payment.promo_credits)),
        idempotencyKey: `payment:refund-reserve:${refund.id}`,
        referenceType: "payment_refund",
        referenceId: refund.id,
        metadata: { paymentId: payment.id },
      });
      return { payment, refund, idempotent: false };
    });
  }

  async pendingRefunds(userId, limit = 5) {
    const result = await this.pool.query(
      `select refund.* from payment_refunds refund
       join payments payment on payment.id = refund.payment_id
       where payment.user_id = $1 and refund.status = 'pending' and refund.provider_refund_id is not null
       order by refund.created_at asc limit $2`,
      [userId, limit],
    );
    return result.rows;
  }

  async completeRefund(userId, refundId, providerResult) {
    return transaction(this.pool, async (client) => {
      const refundResult = await client.query(
        `select refund.*, payment.user_id from payment_refunds refund
         join payments payment on payment.id = refund.payment_id
         where refund.id = $1 and payment.user_id = $2 for update of refund`,
        [refundId, userId],
      );
      if (!refundResult.rowCount) throw new PaymentError("REFUND_NOT_FOUND", 404);
      const refund = refundResult.rows[0];
      const status = providerResult.status === "succeeded" ? "succeeded" : "pending";
      await client.query(
        `update payment_refunds set provider_refund_id = $2, status = $3::payment_refund_status,
         completed_at = case when $3::text = 'succeeded' then now() else completed_at end,
         updated_at = now() where id = $1`,
        [refund.id, providerResult.providerRefundId, status],
      );
      if (status === "succeeded") {
        await client.query(
          "update payments set status = 'refunded', refunded_at = now(), updated_at = now() where id = $1",
          [refund.payment_id],
        );
        await client.query(
          `insert into payment_receipts (payment_id, type, status, provider_receipt_id, amount_minor, metadata)
           values ($1, 'refund', 'pending', $2, $3, $4)
           on conflict (provider_receipt_id) do nothing`,
          [refund.payment_id, `robokassa:${providerResult.providerRefundId}:refund`, refund.amount_minor, { scheme: "robocheck-smz" }],
        );
      }
      return { ...refund, provider_refund_id: providerResult.providerRefundId, status };
    });
  }

  async failRefund(userId, refundId, code) {
    return transaction(this.pool, async (client) => {
      const refundResult = await client.query(
        `select refund.*, payment.user_id from payment_refunds refund
         join payments payment on payment.id = refund.payment_id
         where refund.id = $1 and payment.user_id = $2 for update of refund`,
        [refundId, userId],
      );
      if (!refundResult.rowCount) return;
      const refund = refundResult.rows[0];
      if (refund.status === "failed") return;
      await client.query(
        "update payment_refunds set status = 'failed', metadata = metadata || jsonb_build_object('errorCode', $2::text), updated_at = now() where id = $1",
        [refund.id, code],
      );
      try {
        await creditWalletWithClient(client, {
          userId,
          type: "admin_adjustment",
          amount: Number((await client.query("select credits + promo_credits total from payments where id = $1", [refund.payment_id])).rows[0].total),
          idempotencyKey: `payment:refund-release:${refund.id}`,
          referenceType: "payment_refund",
          referenceId: refund.id,
          metadata: { reason: "provider_refund_failed" },
        });
      } catch (error) {
        if (!(error instanceof WalletRepositoryError)) throw error;
        throw error;
      }
    });
  }
}
