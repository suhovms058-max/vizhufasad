import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { FreeTrialRepository } from "../src/free-trial/repository.mjs";
import { FreeTrialService } from "../src/free-trial/service.mjs";
import { WalletRepository } from "../src/wallet/repository.mjs";
import { WalletService } from "../src/wallet/service.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

async function fixture(pool, photoHash) {
  const userId = randomUUID();
  const projectId = randomUUID();
  const imageId = randomUUID();
  const generationId = randomUUID();
  await pool.query("insert into users (id, email, status) values ($1, $2, 'active')", [userId, `trial-${userId}@example.test`]);
  await pool.query("insert into wallets (user_id, currency) values ($1, 'CREDIT')", [userId]);
  await pool.query("insert into projects (id, user_id, title, status) values ($1, $2, 'Trial', 'configuration_required')", [projectId, userId]);
  await pool.query(
    `insert into source_images (
      id, project_id, storage_bucket, storage_key, working_storage_key,
      declared_mime_type, mime_type, byte_size, width, height, status,
      perceptual_hash, recommended_size, consent_version, consented_at
    ) values ($1, $2, 'private', $3, $4, 'image/jpeg', 'image/jpeg', 1000,
      1200, 800, 'ready', $5, true, 'test', now())`,
    [imageId, projectId, `${userId}/source.jpg`, `${userId}/working.jpg`, photoHash],
  );
  await pool.query(
    `insert into generations (
      id, project_id, source_image_id, status, idempotency_key,
      config_snapshot, geometry_policy_snapshot
    ) values ($1, $2, $3, 'created', $4, '{}'::jsonb, '{}'::jsonb)`,
    [generationId, projectId, imageId, `standard:${userId}:${randomUUID()}`],
  );
  return { userId, projectId, imageId, generationId };
}

async function cleanup(pool, fixtures) {
  const users = fixtures.map((item) => item.userId);
  await pool.query("delete from free_trial_risk_events where user_id = any($1::uuid[])", [users]);
  await pool.query("delete from free_trial_entitlements where user_id = any($1::uuid[])", [users]);
  await pool.query("delete from projects where user_id = any($1::uuid[])", [users]);
  await pool.query("delete from wallet_transactions where wallet_id in (select id from wallets where user_id = any($1::uuid[]))", [users]);
  await pool.query("delete from wallets where user_id = any($1::uuid[])", [users]);
  await pool.query("delete from users where id = any($1::uuid[])", [users]);
}

test("same device or near-identical sanitized photo cannot reserve a second free generation", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new FreeTrialRepository(pool);
  const first = await fixture(pool, "0000000000000000");
  const sameDevice = await fixture(pool, "ffffffffffffffff");
  const samePhoto = await fixture(pool, "000000000000000f");
  const sharedNetwork = await fixture(pool, "ffffffffffffffff");
  const input = (item, deviceHash) => ({
    userId: item.userId,
    sourceImageId: item.imageId,
    generationId: item.generationId,
    deviceHash,
    ipHash: "ip-shared",
    networkHash: "network-shared",
    actionCode: "standard_generation",
    idempotencyKey: `generation:${item.generationId}:reserve`,
  });
  try {
    const allowed = await repository.authorizeAndReserve(input(first, "device-one"));
    assert.equal(allowed.decision, "allowed");
    const deniedDevice = await repository.authorizeAndReserve(input(sameDevice, "device-one"));
    assert.equal(deniedDevice.decision, "denied");
    assert.equal(deniedDevice.reasonCode, "FREE_TRIAL_DEVICE_USED");
    const deniedPhoto = await repository.authorizeAndReserve(input(samePhoto, "device-two"));
    assert.equal(deniedPhoto.decision, "denied");
    assert.equal(deniedPhoto.reasonCode, "FREE_TRIAL_PHOTO_USED");
    const allowedSharedNetwork = await repository.authorizeAndReserve(input(sharedNetwork, "device-three"));
    assert.equal(allowedSharedNetwork.decision, "allowed");
    const charges = await pool.query(
      `select count(*)::int as count from wallet_transactions
       where type = 'generation_charge' and reference_id = any($1::uuid[])`,
      [[first.generationId, sameDevice.generationId, samePhoto.generationId, sharedNetwork.generationId]],
    );
    assert.equal(charges.rows[0].count, 2);
  } finally {
    await cleanup(pool, [first, sameDevice, samePhoto, sharedNetwork]);
    await closeDatabase();
  }
});

test("missing device fails closed without creating a wallet charge", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new FreeTrialRepository(pool);
  const item = await fixture(pool, "aaaaaaaaaaaaaaaa");
  try {
    const decision = await repository.authorizeAndReserve({
      userId: item.userId,
      sourceImageId: item.imageId,
      generationId: item.generationId,
      deviceHash: null,
      ipHash: "ip",
      networkHash: "network",
      actionCode: "standard_generation",
      idempotencyKey: `generation:${item.generationId}:reserve`,
    });
    assert.equal(decision.decision, "review_required");
    const charges = await pool.query(
      "select count(*)::int as count from wallet_transactions where reference_id = $1",
      [item.generationId],
    );
    assert.equal(charges.rows[0].count, 0);
  } finally {
    await cleanup(pool, [item]);
    await closeDatabase();
  }
});

test("purchased VF coins remain usable when the device already used a free trial", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new FreeTrialRepository(pool);
  const first = await fixture(pool, "1111111111111111");
  const paid = await fixture(pool, "eeeeeeeeeeeeeeee");
  const walletRepository = new WalletRepository(pool);
  const walletService = new WalletService({
    repository: walletRepository,
    config: { walletEnabled: true, tariffCatalogEnabled: true, paymentsEnabled: true, freeBonusEnabled: true, freeBonusCredits: 1 },
  });
  const service = new FreeTrialService({ repository, walletService, freeBonusCredits: 1 });
  try {
    const firstResult = await repository.authorizeAndReserve({
      userId: first.userId, sourceImageId: first.imageId, generationId: first.generationId,
      deviceHash: "shared-device", ipHash: "ip", networkHash: "network",
      actionCode: "standard_generation", idempotencyKey: `generation:${first.generationId}:reserve`,
    });
    assert.equal(firstResult.decision, "allowed");
    await walletService.credit(paid.userId, {
      type: "purchase", amount: 1, idempotencyKey: `purchase:${paid.userId}`,
      referenceType: "payment", referenceId: randomUUID(),
    });
    const paidReservation = await service.reserveStandard(paid.userId, {
      actionCode: "standard_generation", idempotencyKey: `generation:${paid.generationId}:reserve`,
      referenceType: "generation", referenceId: paid.generationId, sourceImageId: paid.imageId,
    }, { deviceHash: "shared-device", ipHash: "ip", networkHash: "network" });
    assert.equal(paidReservation.transaction.status, "reserved");
    assert.equal(paidReservation.transaction.metadata?.funding, undefined);
  } finally {
    await cleanup(pool, [first, paid]);
    await closeDatabase();
  }
});

test("parallel requests on one device reserve at most one free generation", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new FreeTrialRepository(pool);
  const left = await fixture(pool, "1234567890abcdef");
  const right = await fixture(pool, "fedcba0987654321");
  const input = (item) => ({
    userId: item.userId, sourceImageId: item.imageId, generationId: item.generationId,
    deviceHash: "parallel-device", ipHash: "parallel-ip", networkHash: "parallel-network",
    actionCode: "standard_generation", idempotencyKey: `generation:${item.generationId}:reserve`,
  });
  try {
    const results = await Promise.all([
      repository.authorizeAndReserve(input(left)),
      repository.authorizeAndReserve(input(right)),
    ]);
    assert.deepEqual(results.map((result) => result.decision).sort(), ["allowed", "denied"]);
    const charges = await pool.query(
      `select count(*)::int as count from wallet_transactions
       where type = 'generation_charge' and reference_id = any($1::uuid[])`,
      [[left.generationId, right.generationId]],
    );
    assert.equal(charges.rows[0].count, 1);
  } finally {
    await cleanup(pool, [left, right]);
    await closeDatabase();
  }
});
