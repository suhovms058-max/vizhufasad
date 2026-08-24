import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { GenerationProcessor } from "../src/generation/processor.mjs";
import { GenerationRepository } from "../src/generation/repository.mjs";
import { GenerationService } from "../src/generation/service.mjs";
import { GenerationQualityRepository } from "../src/generation-quality/repository.mjs";
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
    "delete from wallet_transactions where wallet_id in (select id from wallets where user_id = $1)",
    [fixture.userId],
  );
  await pool.query("delete from wallets where user_id = $1", [fixture.userId]);
  await pool.query("delete from users where id = $1", [fixture.userId]);
}

test("queued generation is processed asynchronously with atomic wallet lifecycle", {
  skip: !enabled,
}, async () => {
  const pool = getPool();
  const fixture = await createFixture(pool);
  const repository = new GenerationRepository(pool);
  const qualityRepository = new GenerationQualityRepository(pool);
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
  const queueEvents = [];
  const service = new GenerationService({
    repository,
    storage,
    walletService,
    queue: {
      async enqueue(id, priority) { queueEvents.push([id, priority]); return { id }; },
      async cancelWaiting() { return true; },
    },
    config: {
      enabled: true,
      queuePaidPriority: 1,
      queueFreePriority: 10,
      resultSignedUrlTtlSeconds: 300,
    },
  });
  const processor = new GenerationProcessor({
    repository,
    qualityRepository,
    qualityOrchestrator: {
      async assess() {
        return {
          decision: "passed", overallScore: 9000, failureReasons: [],
          scoreBreakdown: {}, vlmResult: {}, structuralResult: {},
          schemaVersion: "generation-quality-assessment-v1",
          promptVersion: "facade-quality-compare-v1",
          policyVersion: "facade-quality-policy-v1",
          provider: "quality-mock", model: "quality-model", providerRequestId: "quality-1",
        };
      },
    },
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
          result: source,
        };
      },
    }],
    config: { timeoutMs: 1_000, workerLockDurationMs: 60_000, resultMaxBytes: 25_000_000 },
    qualityConfig: { enabled: true, diagnosticRetentionHours: 72 },
    seedFactory: () => 123,
  });
  try {
    const queued = await service.create(
      fixture.userId,
      fixture.projectId,
      fixture.imageId,
      { style: "минимализм" },
      `integration-${randomUUID()}`,
    );
    assert.equal(queued.status, "queued");
    assert.equal(queued.resultAvailable, false);
    assert.equal(queueEvents.length, 1);
    await processor.process({
      data: { generationId: queued.id },
      attemptsMade: 0,
      opts: { attempts: 3 },
      async updateProgress() {},
    });
    const completed = await service.view(fixture.userId, fixture.projectId, queued.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.resultAvailable, true);
    assert.equal(completed.attempts[0].jobId, "job-integration");
    assert.equal(completed.attempts[0].model, "mock-image-edit");
    assert.equal(completed.attempts[0].promptVersion, "standard-facade-v4");
    assert.equal(Number(completed.attempts[0].seed), 123);
    assert.equal(completed.attempts[0].actualCostMinor, 90);
    assert.equal(stored.size, 2);
    const assessments = await qualityRepository.listForGeneration(queued.id);
    assert.equal(assessments.length, 1);
    assert.equal(assessments[0].decision, "passed");
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
      completed.idempotency_key.split(":").at(-1),
    );
    assert.equal(duplicate.id, completed.id);
    assert.equal(queueEvents.length, 1);
    assert.equal((await walletService.summary(fixture.userId)).balance, 1);
  } finally {
    await cleanup(pool, fixture);
  }
});

test.after(async () => {
  if (enabled) await closeDatabase();
});
