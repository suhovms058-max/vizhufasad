import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { WalletRepository } from "../src/wallet/repository.mjs";
import { WalletService } from "../src/wallet/service.mjs";

const enabled = Boolean(process.env.DATABASE_URL);
const config = {
  walletEnabled: true,
  tariffCatalogEnabled: true,
  freeBonusEnabled: true,
  paymentsEnabled: false,
  freeBonusCredits: 2,
};

async function createUserWithWallet(pool, label) {
  const userId = randomUUID();
  await pool.query(
    "insert into users (id, email, status) values ($1, $2, 'active')",
    [userId, `wallet-${label}-${userId}@example.test`],
  );
  await pool.query("insert into wallets (user_id, currency) values ($1, 'CREDIT')", [userId]);
  return userId;
}

async function cleanupUser(pool, userId) {
  await pool.query(
    `delete from wallet_transactions where wallet_id in (
      select id from wallets where user_id = $1
    ) and type = 'generation_refund'`,
    [userId],
  );
  await pool.query(
    "delete from wallet_transactions where wallet_id in (select id from wallets where user_id = $1)",
    [userId],
  );
  await pool.query("delete from wallets where user_id = $1", [userId]);
  await pool.query("delete from users where id = $1", [userId]);
}

test("bonus, reserve, commit, duplicate and refund are atomic and idempotent", {
  skip: !enabled,
}, async () => {
  const pool = getPool();
  const repository = new WalletRepository(pool);
  const service = new WalletService({ repository, config });
  const userId = await createUserWithWallet(pool, "lifecycle");
  try {
    const bonuses = await Promise.all(
      Array.from({ length: 5 }, () => repository.grantFreeBonus(userId, 2, "test")),
    );
    assert.equal(bonuses.filter((result) => !result.idempotent).length, 1);
    assert.equal((await service.summary(userId)).balance, 2);

    const input = {
      actionCode: "pro_generation",
      idempotencyKey: `reserve:${randomUUID()}`,
      referenceType: "project",
      referenceId: randomUUID(),
    };
    const reserved = await service.reserve(userId, input);
    const duplicate = await service.reserve(userId, input);
    assert.equal(reserved.idempotent, false);
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.transaction.id, reserved.transaction.id);
    assert.equal((await service.summary(userId)).balance, 0);

    assert.equal((await service.commit(userId, reserved.transaction.id)).idempotent, false);
    assert.equal((await service.commit(userId, reserved.transaction.id)).idempotent, true);
    const refundKey = `refund:${randomUUID()}`;
    const refunded = await service.refund(
      userId, reserved.transaction.id, refundKey, "technical_failure",
    );
    const repeatedRefund = await service.refund(
      userId, reserved.transaction.id, refundKey, "technical_failure",
    );
    assert.equal(refunded.idempotent, false);
    assert.equal(repeatedRefund.idempotent, true);
    assert.equal((await service.summary(userId)).balance, 2);
    const promoKey = `promo:${randomUUID()}`;
    const promo = await service.credit(userId, {
      type: "promo",
      amount: 1,
      idempotencyKey: promoKey,
      referenceType: "campaign",
    });
    assert.equal(promo.idempotent, false);
    assert.equal((await service.credit(userId, {
      type: "promo",
      amount: 1,
      idempotencyKey: promoKey,
      referenceType: "campaign",
    })).idempotent, true);
    await assert.rejects(
      service.credit(userId, {
        type: "promo",
        amount: 2,
        idempotencyKey: promoKey,
        referenceType: "campaign",
      }),
      (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT",
    );
    assert.equal((await service.summary(userId)).balance, 3);

    const ledger = await repository.history(userId, 20);
    assert.deepEqual(
      ledger.map((entry) => entry.type).sort(),
      ["free_bonus", "generation_charge", "generation_refund", "promo"].sort(),
    );
  } finally {
    await cleanupUser(pool, userId);
    await closeDatabase();
  }
});

test("parallel charges cannot overdraw a wallet and free actions are never charged", {
  skip: !enabled,
}, async () => {
  const pool = getPool();
  const repository = new WalletRepository(pool);
  const service = new WalletService({ repository, config });
  const userId = await createUserWithWallet(pool, "parallel");
  try {
    await repository.grantFreeBonus(userId, 2, "test");
    const attempts = await Promise.allSettled([
      service.reserve(userId, {
        actionCode: "pro_generation",
        idempotencyKey: `parallel:${randomUUID()}`,
        referenceType: "project",
        referenceId: randomUUID(),
      }),
      service.reserve(userId, {
        actionCode: "pro_generation",
        idempotencyKey: `parallel:${randomUUID()}`,
        referenceType: "project",
        referenceId: randomUUID(),
      }),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "INSUFFICIENT_CREDITS");
    assert.equal((await service.summary(userId)).balance, 0);
    await assert.rejects(
      service.reserve(userId, {
        actionCode: "photo_assessment",
        idempotencyKey: `free:${randomUUID()}`,
      }),
      (error) => error.code === "ACTION_IS_FREE",
    );
  } finally {
    await cleanupUser(pool, userId);
    await closeDatabase();
  }
});

test("tariff changes are effective-dated and do not rewrite the current price", {
  skip: !enabled,
}, async () => {
  const pool = getPool();
  const repository = new WalletRepository(pool);
  const now = new Date();
  const validFrom = new Date(now.getTime() + 60_000);
  const service = new WalletService({ repository, config, clock: () => now });
  let currentTariffId = null;
  try {
    const before = (await repository.listTariffs(now)).find((plan) => plan.code === "START");
    currentTariffId = before.id;
    assert.equal(Number(before.price_minor), 79_000);
    const scheduled = await service.scheduleTariffVersion({
      code: "START",
      name: "Старт",
      description: "30 кредитов",
      priceMinor: 80_000,
      credits: 30,
      validFrom: validFrom.toISOString(),
    });
    assert.equal(scheduled.idempotent, false);
    const current = (await repository.listTariffs(now)).find((plan) => plan.code === "START");
    const future = (await repository.listTariffs(
      new Date(validFrom.getTime() + 1),
    )).find((plan) => plan.code === "START");
    assert.equal(Number(current.price_minor), 79_000);
    assert.equal(Number(future.price_minor), 80_000);
    assert.equal(Number(future.credits), 30);
  } finally {
    await pool.query(
      "delete from tariff_plans where code = 'START' and valid_from = $1",
      [validFrom],
    );
    if (currentTariffId) {
      await pool.query("update tariff_plans set valid_until = null where id = $1", [currentTariffId]);
    }
    await closeDatabase();
  }
});
