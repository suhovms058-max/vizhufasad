import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { getPool } from "../src/db/client.mjs";
import { createGenerationStagingRouter } from "../src/generation/http.mjs";
import { GenerationMetrics } from "../src/generation/metrics.mjs";
import { GenerationProcessor } from "../src/generation/processor.mjs";
import { GenApiGenerationProvider } from "../src/generation/providers/genapi.mjs";
import { createGenerationQueue } from "../src/generation/queue.mjs";
import { GenerationRepository } from "../src/generation/repository.mjs";
import { GenerationService } from "../src/generation/service.mjs";
import { createGenerationWorker } from "../src/generation/worker.mjs";
import {
  deletePrivateObject, ensurePrivateBucket, getPrivateObjectBuffer,
  getStorageBucket, putPrivateObject,
} from "../src/infra/storage.mjs";
import { WalletRepository } from "../src/wallet/repository.mjs";
import { WalletService } from "../src/wallet/service.mjs";

if (process.env.GENERATION_LIVE_SMOKE_ENABLED !== "true") {
  throw new Error("GENERATION_LIVE_SMOKE_ENABLED=true is required for a paid endpoint smoke test");
}
if (!process.env.GENAPI_API_KEY) throw new Error("GENAPI_API_KEY is required");

const fixturesDir = path.resolve(
  process.env.GENERATION_SMOKE_FIXTURES_DIR || "D:/VIZHUFASAD/stage7-private-facades",
);
const outputDir = path.resolve(
  process.env.GENERATION_SMOKE_OUTPUT_DIR || "D:/VIZHUFASAD/stage7-generation-results",
);
const sourcePath = path.join(fixturesDir, "0fb49258a05d4c1e4b9e14ac651acb19.jpg");
const outputPath = path.join(outputDir, "endpoint-standard.jpg");
const pool = getPool();
const userId = randomUUID();
const projectId = randomUUID();
const imageId = randomUUID();
const sourceKey = `stage7-smoke/${userId}/${imageId}/working.jpg`;
const stagingSecret = randomBytes(32).toString("base64url");
let resultKey;
let server;
let queue;
let workerRuntime;

async function cleanFixture() {
  if (!resultKey) {
    const generation = await pool.query(
      "select result_key from generations where project_id = $1 and result_key is not null limit 1",
      [projectId],
    ).catch(() => ({ rows: [] }));
    resultKey = generation.rows[0]?.result_key;
  }
  if (resultKey) await deletePrivateObject(resultKey).catch(() => {});
  await deletePrivateObject(sourceKey).catch(() => {});
  await pool.query("delete from projects where id = $1", [projectId]).catch(() => {});
  await pool.query(
    "delete from wallet_transactions where wallet_id in (select id from wallets where user_id = $1)",
    [userId],
  ).catch(() => {});
  await pool.query("delete from wallets where user_id = $1", [userId]).catch(() => {});
  await pool.query("delete from users where id = $1", [userId]).catch(() => {});
}

try {
  const source = await readFile(sourcePath);
  await mkdir(outputDir, { recursive: true });
  await ensurePrivateBucket();
  await putPrivateObject({
    key: sourceKey,
    body: source,
    contentType: "image/jpeg",
    metadata: { purpose: "stage7-endpoint-smoke" },
  });
  await pool.query(
    "insert into users (id, email, status) values ($1, $2, 'active')",
    [userId, `stage7-${userId}@example.test`],
  );
  await pool.query("insert into wallets (user_id, currency) values ($1, 'CREDIT')", [userId]);
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
  await walletService.summary(userId);
  await pool.query(
    "insert into projects (id, user_id, title, status) values ($1, $2, 'Stage 7 endpoint smoke', 'configuration_required')",
    [projectId, userId],
  );
  await pool.query(
    `insert into source_images (
      id, project_id, storage_bucket, storage_key, working_storage_key,
      original_filename, declared_mime_type, mime_type, byte_size,
      width, height, status, recommended_size, processed_at
    ) values ($1, $2, $3, $4, $4, 'facade.jpg', 'image/jpeg', 'image/jpeg',
      $5, 1080, 1080, 'ready', true, now())`,
    [imageId, projectId, getStorageBucket(), sourceKey, source.length],
  );
  await pool.query(
    `insert into photo_assessments (
      source_image_id, status, decision, prompt_version, schema_version,
      attempt_count, technical_result, user_result, finished_at
    ) values ($1, 'completed', 'accepted', 'stage7-smoke', 'stage7-smoke',
      1, '{}'::jsonb, '{}'::jsonb, now())`,
    [imageId],
  );

  const provider = new GenApiGenerationProvider({
    apiKey: process.env.GENAPI_API_KEY,
    endpoint: process.env.GENAPI_ENDPOINT,
    model: process.env.GENAPI_STANDARD_MODEL || "nano-banana-2",
    estimatedCostMinor: Number(process.env.GENAPI_STANDARD_ESTIMATED_COST_MINOR || 2500),
    currency: "RUB",
    pollIntervalMs: Number(process.env.GENERATION_POLL_INTERVAL_MS || 1500),
  });
  const generationRepository = new GenerationRepository(pool);
  const generationConfig = {
    enabled: true,
    timeoutMs: Number(process.env.GENERATION_PROVIDER_TIMEOUT_MS || 180_000),
    resultSignedUrlTtlSeconds: 300,
    queueName: `generation-smoke-${randomUUID()}`,
    queuePrefix: "vizhufasad-smoke",
    queueMaxAttempts: 2,
    queueBackoffMs: 1_000,
    queuePaidPriority: 1,
    queueFreePriority: 10,
    workerConcurrency: 1,
    workerLockDurationMs: 60_000,
    workerStalledIntervalMs: 30_000,
    workerMaxStalledCount: 2,
    watchdogIntervalMs: 30_000,
    watchdogStaleMs: 180_000,
  };
  queue = createGenerationQueue(generationConfig);
  const generationService = new GenerationService({
    repository: generationRepository,
    storage: await import("../src/infra/storage.mjs"),
    walletService,
    queue,
    config: generationConfig,
  });
  const processor = new GenerationProcessor({
    repository: generationRepository,
    storage: await import("../src/infra/storage.mjs"),
    walletService,
    providers: [provider],
    config: generationConfig,
  });
  workerRuntime = createGenerationWorker({
    config: generationConfig,
    processor,
    repository: generationRepository,
    queue,
    metrics: new GenerationMetrics({ repository: generationRepository, queue }),
  });
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(
    "/api/staging/generation",
    createGenerationStagingRouter({
      generationService,
      config: { stagingEnabled: true, stagingSecret },
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/staging/generation/standard`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-staging-secret": stagingSecret,
    },
    body: JSON.stringify({
      userId,
      projectId,
      sourceImageId: imageId,
      idempotencyKey: `endpoint-smoke-${randomUUID()}`,
      input: {
        style: "современный минимализм",
        materials: ["светлая штукатурка", "натуральное дерево"],
        palette: ["#E8E1D5", "#6B4D35", "#2F3336"],
        transformationLevel: "gentle",
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Endpoint smoke failed: ${payload.error || response.status}`);
  const generationId = payload.generation?.id;
  if (!generationId || response.status !== 202 || payload.generation.status !== "queued") {
    throw new Error("Endpoint did not return an asynchronously queued generation");
  }
  let persisted;
  const deadline = Date.now() + generationConfig.timeoutMs + 60_000;
  do {
    persisted = await pool.query(
      `select g.result_key, g.status, wt.status as wallet_status
       from generations g
       join wallet_transactions wt on wt.id = g.wallet_reservation_id
       where g.id = $1`,
      [generationId],
    );
    if (["completed", "failed_refunded"].includes(persisted.rows[0]?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  if (
    persisted.rows[0]?.status !== "completed"
    || persisted.rows[0]?.wallet_status !== "committed"
    || !persisted.rows[0]?.result_key
  ) {
    throw new Error("Generation result or committed wallet reservation was not persisted");
  }
  resultKey = persisted.rows[0].result_key;
  const result = await getPrivateObjectBuffer(resultKey, 25 * 1024 * 1024);
  await writeFile(outputPath, result);
  console.log(JSON.stringify({
    ok: true,
    generationId,
    status: "completed",
    walletStatus: "committed",
    output: outputPath,
  }));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (workerRuntime) await workerRuntime.close().catch(() => {});
  if (queue) {
    await queue.queue.obliterate({ force: true }).catch(() => {});
    await queue.close().catch(() => {});
  }
  await cleanFixture();
  await pool.end();
}
