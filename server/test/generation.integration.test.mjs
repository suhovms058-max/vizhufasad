import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { GenerationRepository } from "../src/generation/repository.mjs";
import { GenerationService } from "../src/generation/service.mjs";
import { WalletRepository } from "../src/wallet/repository.mjs";
import { WalletService } from "../src/wallet/service.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

async function createFixture(pool) {
  const userId = randomUUID();
  const projectId = randomUUID();
  const imageId = randomUUID();
  await pool.query(
    "insert into users (id, email, status) values ($1, $2, 'active')",
    [userId, `generation-${userId}@example.test`],
  );
  await pool.query("insert into wallets (user_id, currency) values ($1, 'CREDIT')", [userId]);
  await pool.query(
    "insert into projects (id, user_id, title, status) values ($1, $2, 'Generation test', 'configuration_required')",
    [projectId, userId],
  );
  await pool.query(
    `insert into source_images (
      id, project_id, storage_bucket, storage_key, working_storage_key,
      original_filename, declared_mime_type, mime_type, byte_size,
      width, height, status, recommended_size, processed_at
    ) values ($1, $2, 'private', 'source.jpg', 'working.jpg', 'facade.jpg',
      'image/jpeg', 'image/jpeg', 1000, 1600, 1000, 'ready', true, now())`,
    [imageId, projectId],
  );
  await pool.query(
    `insert into photo_assessments (
      source_image_id, status, decision, prompt_version, schema_version,
      attempt_count, technical_result, user_result, finished_at
    ) values ($1, 'completed', 'accepted', 'test', 'test', 1, '{}'::jsonb, '{}'::jsonb, now())`,
    [imageId],
  );
  return { userId, projectId, imageId };
}

async function cleanup(pool, fixture) {
  await pool.query("delete from projects where id = $1", [fixture.projectId]);
  await pool.query(
    `delete from wallet_transactions where wallet_id in (
      select id from wallets where user_id = $1
    ) and type = 'generation_refund'`,
    [fixture.userId],
  );
  await pool.query(
    "delete from wallet_transactions where wallet_id in (select id from wallets where user_id = $1)",
    [fixture.userId],
  );
  await pool.query("delete from wallets where user_id = $1", [fixture.userId]);
  await pool.query("delete from users where id = $1", [fixture.userId]);
}

test("generation repository, wallet transaction and result lifecycle work atomically", {
  skip: !enabled,
}, async () => {
  const pool = getPool();
  const fixture = await createFixture(pool);
  const walletService = new WalletService({
    repository: new WalletRepository(pool),
    config: {
      walletEnabled: true,
      tariffCatalogEnabled: true,
      freeBonusEnabled: true,
      paymentsEnabled: false,
      freeBonusCredits: 2,
    },
  });
  await walletService.summary(fixture.userId);
  const source = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#dddddd" },
  }).jpeg().toBuffer();
  const stored = new Map();
  const storage = {
    async getPrivateObjectBuffer() { return source; },
    async putPrivateObject({ key, body }) { stored.set(key, body); },
    async deletePrivateObject(key) { stored.delete(key); },
    getStorageBucket() { return "private"; },
    async createDownloadUrl(key) { return `https://signed.example/${key}`; },
  };
  const service = new GenerationService({
    repository: new GenerationRepository(pool),
    storage,
    walletService,
    providers: [{
      name: "mock",
      model: "mock-image-edit",
      estimatedCostMinor: 100,
      currency: "RUB",
      async generate({ seed }) {
        return {
          provider: "mock",
          jobId: "job-integration",
          model: "mock-image-edit",
          seed,
          durationMs: 50,
          estimatedCostMinor: 100,
          actualCostMinor: 90,
          currency: "RUB",
          contentType: "image/jpeg",
          result: source,
        };
      },
    }],
    config: { enabled: true, timeoutMs: 1000, resultSignedUrlTtlSeconds: 300 },
    seedFactory: () => 123,
  });
  try {
    const generation = await service.create(
      fixture.userId,
      fixture.projectId,
      fixture.imageId,
      { style: "минимализм" },
      `integration-${randomUUID()}`,
    );
    assert.equal(generation.status, "ready");
    assert.equal(generation.resultAvailable, true);
    assert.equal(generation.attempts[0].jobId, "job-integration");
    assert.equal(generation.attempts[0].model, "mock-image-edit");
    assert.equal(generation.attempts[0].promptVersion, "standard-facade-v3");
    assert.equal(Number(generation.attempts[0].seed), 123);
    assert.equal(generation.attempts[0].actualCostMinor, 90);
    assert.equal(stored.size, 1);
    const transactions = await pool.query(
      `select type, status, amount from wallet_transactions transaction
       join wallets wallet on wallet.id = transaction.wallet_id
       where wallet.user_id = $1 order by transaction.created_at`,
      [fixture.userId],
    );
    assert.deepEqual(
      transactions.rows.map((row) => [row.type, row.status, Number(row.amount)]),
      [["free_bonus", "committed", 2], ["generation_charge", "committed", -1]],
    );
    const duplicate = await service.create(
      fixture.userId,
      fixture.projectId,
      fixture.imageId,
      { style: "другой стиль" },
      generation.idempotency_key.split(":").at(-1),
    );
    assert.equal(duplicate.id, generation.id);
    assert.equal((await walletService.summary(fixture.userId)).balance, 1);
  } finally {
    await cleanup(pool, fixture);
  }
});

test.after(async () => {
  if (enabled) await closeDatabase();
});
