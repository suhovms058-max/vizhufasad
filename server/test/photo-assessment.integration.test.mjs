import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { PhotoAssessmentOrchestrator } from "../src/photo-assessment/orchestrator.mjs";
import { PhotoAssessmentProviderError } from "../src/photo-assessment/providers.mjs";
import { PhotoAssessmentRepository } from "../src/photo-assessment/repository.mjs";
import { PhotoAssessmentService } from "../src/photo-assessment/service.mjs";
import {
  PHOTO_PROCESSING_CONSENT_HASH, PHOTO_PROCESSING_CONSENT_VERSION,
  PHOTO_USAGE_RIGHTS_HASH, PHOTO_USAGE_RIGHTS_VERSION,
} from "../src/legal/photo-consent.mjs";

const enabled = Boolean(process.env.DATABASE_URL);
const technical = {
  width: 1600, height: 1000, format: "jpeg", entropy: 6, sharpness: 3,
  luminance: 125, recommendedResolution: true, warnings: [], blocking: [],
};
const acceptedObservation = {
  scene: "facade",
  houseVisible: true,
  facadeVisible: true,
  frameCompleteness: "complete",
  geometry: "good",
  obstruction: "none",
  perspective: "good",
  sharpness: "good",
  lighting: "good",
  roofCrop: "none",
  confidence: 0.94,
  issueCodes: [],
};
const warningObservation = {
  ...acceptedObservation,
  perspective: "acceptable",
  obstruction: "minor",
  confidence: 0.86,
};

function orchestratorWith(providers, config = {}) {
  return new PhotoAssessmentOrchestrator({
    providers,
    config: {
      primary: "yandex",
      fallback: "none",
      primaryAttempts: 2,
      timeoutMs: 1_000,
      retryDelayMs: 0,
      ...config,
    },
  });
}

async function createReadyImage(pool, userId, suffix) {
  const project = await pool.query(
    "insert into projects (user_id, title, status) values ($1, $2, 'photo_ready') returning *",
    [userId, `Assessment ${suffix}`],
  );
  const image = await pool.query(
    `insert into source_images (
      project_id, storage_bucket, storage_key, working_storage_key, thumbnail_storage_key,
      original_filename, declared_mime_type, mime_type, byte_size, width, height,
      sha256, status, recommended_size, processed_at,
      consent_version, consent_hash, consented_at,
      rights_version, rights_hash, rights_confirmed_at
    ) values ($1, 'test', $2, $3, $4, 'facade.jpg', 'image/jpeg', 'image/jpeg',
      1024, 1600, 1000, $5, 'ready', true, now(),
      $6, $7, now(), $8, $9, now()) returning *`,
    [
      project.rows[0].id,
      `source/${suffix}/${randomUUID()}`,
      `working/${suffix}/${randomUUID()}`,
      `thumbnail/${suffix}/${randomUUID()}`,
      randomUUID().replaceAll("-", ""),
      PHOTO_PROCESSING_CONSENT_VERSION,
      PHOTO_PROCESSING_CONSENT_HASH,
      PHOTO_USAGE_RIGHTS_VERSION,
      PHOTO_USAGE_RIGHTS_HASH,
    ],
  );
  return { project: project.rows[0], image: image.rows[0] };
}

test("assessment stores separate results, warning proceeds, and provider outage preserves photo and credits", {
  skip: !enabled,
}, async () => {
  const pool = getPool();
  const repository = new PhotoAssessmentRepository(pool);
  const userId = randomUUID();
  const projectIds = [];
  await pool.query(
    "insert into users (id, email, status) values ($1, $2, 'active')",
    [userId, `assessment-${userId}@example.test`],
  );
  await pool.query("insert into wallets (user_id, balance) values ($1, 7)", [userId]);

  try {
    const warningFixture = await createReadyImage(pool, userId, "warning");
    projectIds.push(warningFixture.project.id);
    const warningService = new PhotoAssessmentService({
      repository,
      orchestrator: orchestratorWith({
        yandex: {
          name: "yandex",
          model: "test-primary",
          async assess() { return { observation: warningObservation, requestId: "warning-1" }; },
        },
      }),
      storage: {},
      technicalAnalyzer: async () => technical,
    });
    const warning = await warningService.assess({
      sourceImageId: warningFixture.image.id,
      projectId: warningFixture.project.id,
      image: Buffer.from("working image"),
    });
    assert.equal(warning.status, "completed");
    assert.equal(warning.decision, "accepted_with_warning");
    assert.ok(warning.technical_result.observation);
    assert.ok(warning.user_result.recommendations.length > 0);
    const warningProject = await pool.query("select status from projects where id = $1", [
      warningFixture.project.id,
    ]);
    assert.equal(warningProject.rows[0].status, "configuration_required");

    const outageFixture = await createReadyImage(pool, userId, "outage");
    projectIds.push(outageFixture.project.id);
    const outageService = new PhotoAssessmentService({
      repository,
      orchestrator: orchestratorWith({
        yandex: {
          name: "yandex",
          model: "primary",
          async assess() {
            throw new PhotoAssessmentProviderError("YANDEX_HTTP_503", { retryable: true });
          },
        },
        openai: {
          name: "openai",
          model: "fallback",
          async assess() {
            throw new PhotoAssessmentProviderError("OPENAI_HTTP_401");
          },
        },
      }, { fallback: "openai" }),
      storage: {
        async getPrivateObjectBuffer() { return Buffer.from("still stored"); },
      },
      technicalAnalyzer: async () => technical,
    });
    const unavailable = await outageService.assess({
      sourceImageId: outageFixture.image.id,
      projectId: outageFixture.project.id,
      image: Buffer.from("working image"),
    });
    assert.equal(unavailable.status, "provider_unavailable");
    assert.equal(unavailable.attempt_count, 3);
    const preserved = await pool.query(
      `select p.status as project_status, i.status as image_status, w.balance,
        (select count(*)::int from wallet_transactions where wallet_id = w.id) as transactions
       from projects p join source_images i on i.project_id = p.id
       join wallets w on w.user_id = p.user_id where p.id = $1`,
      [outageFixture.project.id],
    );
    assert.deepEqual(preserved.rows[0], {
      project_status: "photo_validation_queued",
      image_status: "ready",
      balance: "7",
      transactions: 0,
    });

    outageService.orchestrator = orchestratorWith({
      yandex: {
        name: "yandex",
        model: "recovered",
        async assess() { return { observation: acceptedObservation, requestId: "retry-1" }; },
      },
    }, { primaryAttempts: 1 });
    const recovered = await outageService.retryOwned(
      userId,
      outageFixture.project.id,
      outageFixture.image.id,
    );
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.decision, "accepted");
    assert.equal(recovered.attempt_count, 4);
    await assert.rejects(
      outageService.getOwned(randomUUID(), outageFixture.project.id, outageFixture.image.id),
      (error) => error.code === "PHOTO_ASSESSMENT_NOT_FOUND" && error.status === 404,
    );
  } finally {
    await pool.query("delete from projects where id = any($1::uuid[])", [projectIds]);
    await pool.query("delete from wallets where user_id = $1", [userId]);
    await pool.query("delete from users where id = $1", [userId]);
    await closeDatabase();
  }
});
