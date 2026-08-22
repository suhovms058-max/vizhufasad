import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { PaymentRepository } from "../src/payments/repository.mjs";
import { PaymentService } from "../src/payments/service.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

async function setup(pool) {
  const userId = randomUUID();
  await pool.query("insert into users (id, email, status) values ($1, $2, 'active')", [userId, `payment-${userId}@example.test`]);
  await pool.query("insert into wallets (user_id, currency) values ($1, 'CREDIT')", [userId]);
  const tariff = await pool.query(
    "select * from tariff_plans where code = 'START' and is_active = true order by valid_from desc limit 1",
  );
  assert.equal(tariff.rowCount, 1, "START tariff seed is required");
  const promoId = randomUUID();
  await pool.query(
    `insert into promo_codes (id, code, kind, bonus_credits, max_redemptions, max_per_user)
     values ($1, $2, 'credits', 2, 5, 1)`,
    [promoId, `TEST_${userId.replaceAll("-", "").slice(0, 12)}`],
  );
  return { userId, tariff: tariff.rows[0], promoId };
}

async function cleanup(pool, userId, promoId) {
  await pool.query("delete from payment_receipts where payment_id in (select id from payments where user_id = $1)", [userId]);
  await pool.query("delete from payment_refunds where payment_id in (select id from payments where user_id = $1)", [userId]);
  await pool.query("delete from payment_webhook_events where payment_id in (select id from payments where user_id = $1)", [userId]);
  await pool.query("delete from promo_redemptions where user_id = $1", [userId]);
  await pool.query("delete from payments where user_id = $1", [userId]);
  await pool.query("delete from promo_codes where id = $1", [promoId]);
  await pool.query("delete from wallet_transactions where wallet_id in (select id from wallets where user_id = $1)", [userId]);
  await pool.query("delete from wallets where user_id = $1", [userId]);
  await pool.query("delete from users where id = $1", [userId]);
}

test("signed payment lifecycle is atomic across duplicate callbacks, promo and refund", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new PaymentRepository(pool);
  const fixture = await setup(pool);
  try {
    const idempotencyKey = `checkout:${randomUUID()}`;
    const promoCode = (await pool.query("select code from promo_codes where id = $1", [fixture.promoId])).rows[0].code;
    const created = await repository.create({
      userId: fixture.userId,
      tariffPlanId: fixture.tariff.id,
      promoCode,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const duplicateCheckout = await repository.create({
      userId: fixture.userId,
      tariffPlanId: fixture.tariff.id,
      promoCode,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    assert.equal(duplicateCheckout.idempotent, true);
    assert.equal(duplicateCheckout.payment.id, created.payment.id);
    await repository.markPending(created.payment.id);
    const event = {
      eventKey: `paid:${created.payment.provider_payment_id}:790.00`,
      paymentId: created.payment.id,
      providerPaymentId: created.payment.provider_payment_id,
      amountMinor: Number(created.payment.amount_minor),
      paymentMethod: "BankCard",
      raw: { InvId: created.payment.provider_payment_id, SignatureValue: "[redacted]" },
    };
    const callbacks = await Promise.all(Array.from({ length: 5 }, () => repository.processPaid(event)));
    assert.equal(callbacks.filter((result) => !result.idempotent).length, 1);
    const wallet = await pool.query("select balance from wallets where user_id = $1", [fixture.userId]);
    assert.equal(Number(wallet.rows[0].balance), Number(fixture.tariff.credits) + 2);
    const purchases = await pool.query(
      `select count(*)::int count from wallet_transactions transaction
       join wallets wallet on wallet.id = transaction.wallet_id
       where wallet.user_id = $1 and transaction.type = 'purchase'`,
      [fixture.userId],
    );
    assert.equal(purchases.rows[0].count, 1);

    const mismatch = await repository.processPaid({ ...event, eventKey: `${event.eventKey}:mismatch`, amountMinor: 1 });
    assert.equal(mismatch.error, "PAYMENT_DATA_MISMATCH");
    assert.equal((await pool.query(
      "select status from payment_webhook_events where provider = 'robokassa' and event_key = $1",
      [`${event.eventKey}:mismatch`],
    )).rows[0].status, "rejected");

    await assert.rejects(
      repository.create({
        userId: fixture.userId,
        tariffPlanId: fixture.tariff.id,
        promoCode,
        idempotencyKey: `checkout:${randomUUID()}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }),
      (error) => error.code === "PROMO_ALREADY_USED",
    );

    await pool.query(
      "update payments set metadata = metadata || jsonb_build_object('operationKey', 'test-operation') where id = $1",
      [created.payment.id],
    );
    const service = new PaymentService({
      repository,
      provider: { async createRefund() { return { providerRefundId: "refund-provider-id", status: "succeeded" }; } },
      config: { enabled: true },
    });
    const refundKey = `refund:${randomUUID()}`;
    const refund = await service.refund(fixture.userId, created.payment.id, { reason: "test" }, refundKey);
    assert.equal(refund.status, "succeeded");
    assert.equal((await pool.query("select status from payments where id = $1", [created.payment.id])).rows[0].status, "refunded");
    assert.equal(Number((await pool.query("select balance from wallets where user_id = $1", [fixture.userId])).rows[0].balance), 0);
    const repeated = await service.refund(fixture.userId, created.payment.id, { reason: "test" }, refundKey);
    assert.equal(repeated.id, refund.id);
  } finally {
    await cleanup(pool, fixture.userId, fixture.promoId);
    await closeDatabase();
  }
});

test("pending payment cancellation releases the reserved promo exactly once", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new PaymentRepository(pool);
  const fixture = await setup(pool);
  try {
    const promoCode = (await pool.query("select code from promo_codes where id = $1", [fixture.promoId])).rows[0].code;
    const created = await repository.create({
      userId: fixture.userId, tariffPlanId: fixture.tariff.id, promoCode,
      idempotencyKey: `checkout:${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await repository.markPending(created.payment.id);
    assert.equal((await repository.cancel(fixture.userId, created.payment.id)).idempotent, false);
    assert.equal((await repository.cancel(fixture.userId, created.payment.id)).idempotent, true);
    assert.equal(Number((await pool.query("select redemption_count from promo_codes where id = $1", [fixture.promoId])).rows[0].redemption_count), 0);
    const replacement = await repository.create({
      userId: fixture.userId, tariffPlanId: fixture.tariff.id, promoCode,
      idempotencyKey: `checkout:${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    assert.ok(replacement.payment.id);
  } finally {
    await cleanup(pool, fixture.userId, fixture.promoId);
    await closeDatabase();
  }
});

test("active promo checkout is reused and a failed checkout releases its reservation", { skip: !enabled }, async () => {
  const pool = getPool();
  const fixture = await setup(pool);
  const repository = new PaymentRepository(pool);
  try {
    const promoCode = (await pool.query("select code from promo_codes where id = $1", [fixture.promoId])).rows[0].code;
    const first = await repository.create({
      userId: fixture.userId, tariffPlanId: fixture.tariff.id, promoCode,
      idempotencyKey: `checkout:${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await repository.markPending(first.payment.id);

    const repeated = await repository.create({
      userId: fixture.userId, tariffPlanId: fixture.tariff.id, promoCode,
      idempotencyKey: `checkout:${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.payment.id, first.payment.id);
    assert.equal(Number((await pool.query("select redemption_count from promo_codes where id = $1", [fixture.promoId])).rows[0].redemption_count), 1);

    await repository.markFailed(first.payment.id, "CHECKOUT_CREATION_FAILED");
    assert.equal(Number((await pool.query("select redemption_count from promo_codes where id = $1", [fixture.promoId])).rows[0].redemption_count), 0);

    const replacement = await repository.create({
      userId: fixture.userId, tariffPlanId: fixture.tariff.id, promoCode,
      idempotencyKey: `checkout:${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    assert.notEqual(replacement.payment.id, first.payment.id);
  } finally {
    await cleanup(pool, fixture.userId, fixture.promoId);
    await closeDatabase();
  }
});
