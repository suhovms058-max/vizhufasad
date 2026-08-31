import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { PlanAccessRepository } from "../src/access/repository.mjs";
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

test("every published package and top-up can create a server-priced checkout", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new PaymentRepository(pool);
  const userId = randomUUID();
  await pool.query("insert into users (id, email, status) values ($1, $2, 'active')", [userId, `catalog-${userId}@example.test`]);
  await pool.query("insert into wallets (user_id, currency) values ($1, 'CREDIT')", [userId]);
  try {
    const tariffs = await pool.query(
      `select * from tariff_plans where is_active = true and is_public = true and price_minor > 0
       and valid_from <= now() and (valid_until is null or valid_until > now()) order by code`,
    );
    assert.deepEqual(tariffs.rows.map((row) => row.code), [
      "MAXIMUM", "OPTIMUM", "START", "TOPUP_1", "TOPUP_2", "TOPUP_3",
    ]);
    for (const tariff of tariffs.rows) {
      const created = await repository.create({
        userId,
        tariffPlanId: tariff.id,
        promoCode: null,
        idempotencyKey: `catalog:${tariff.code}:${randomUUID()}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });
      assert.equal(Number(created.payment.amount_minor), Number(tariff.price_minor));
      assert.equal(Number(created.payment.credits), Number(tariff.credits));
      await repository.cancel(userId, created.payment.id);
    }
  } finally {
    await pool.query("delete from payments where user_id = $1", [userId]);
    await pool.query("delete from wallets where user_id = $1", [userId]);
    await pool.query("delete from users where id = $1", [userId]);
    await closeDatabase();
  }
});

test("top-ups preserve Start access while paid packages unlock the highest tier", { skip: !enabled }, async () => {
  const pool = getPool();
  const payments = new PaymentRepository(pool);
  const access = new PlanAccessRepository(pool);
  const userId = randomUUID();
  await pool.query("insert into users (id, email, status) values ($1, $2, 'active')", [userId, `access-${userId}@example.test`]);
  await pool.query("insert into wallets (user_id, currency) values ($1, 'CREDIT')", [userId]);
  const buy = async (code) => {
    const tariff = (await pool.query(
      `select * from tariff_plans where code = $1 and is_active = true
       and valid_from <= now() and (valid_until is null or valid_until > now())
       order by valid_from desc limit 1`,
      [code],
    )).rows[0];
    assert.ok(tariff, `${code} tariff seed is required`);
    const created = await payments.create({
      userId, tariffPlanId: tariff.id, promoCode: null,
      idempotencyKey: `access:${code}:${randomUUID()}`,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await payments.markPending(created.payment.id);
    await payments.processPaid({
      eventKey: `access-paid:${created.payment.provider_payment_id}:${randomUUID()}`,
      paymentId: created.payment.id,
      providerPaymentId: created.payment.provider_payment_id,
      amountMinor: Number(created.payment.amount_minor),
      paymentMethod: "BankCard",
      raw: { test: true },
    });
  };
  try {
    assert.equal(await access.highestPaidPackage(userId), "START");
    await buy("TOPUP_3");
    assert.equal(await access.highestPaidPackage(userId), "START");
    await buy("OPTIMUM");
    assert.equal(await access.highestPaidPackage(userId), "OPTIMUM");
    await buy("MAXIMUM");
    assert.equal(await access.highestPaidPackage(userId), "MAXIMUM");
  } finally {
    await pool.query("delete from payment_receipts where payment_id in (select id from payments where user_id = $1)", [userId]);
    await pool.query("delete from payment_refunds where payment_id in (select id from payments where user_id = $1)", [userId]);
    await pool.query("delete from payment_webhook_events where payment_id in (select id from payments where user_id = $1)", [userId]);
    await pool.query("delete from payments where user_id = $1", [userId]);
    await pool.query("delete from wallet_transactions where wallet_id in (select id from wallets where user_id = $1)", [userId]);
    await pool.query("delete from wallets where user_id = $1", [userId]);
    await pool.query("delete from users where id = $1", [userId]);
    await closeDatabase();
  }
});
