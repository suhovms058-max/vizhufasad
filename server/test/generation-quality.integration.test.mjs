import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { GenerationQualityRepository } from "../src/generation-quality/repository.mjs";
import {
  PHOTO_PROCESSING_CONSENT_HASH, PHOTO_PROCESSING_CONSENT_VERSION,
  PHOTO_USAGE_RIGHTS_HASH, PHOTO_USAGE_RIGHTS_VERSION,
} from "../src/legal/photo-consent.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

async function fixture(pool) {
  const userId = randomUUID();
  const projectId = randomUUID();
  const imageId = randomUUID();
  const generationId = randomUUID();
  await pool.query("insert into users (id, email, status) values ($1, $2, 'active')", [
    userId, `quality-${userId}@example.test`,
  ]);
  await pool.query(
    "insert into projects (id, user_id, title, status) values ($1, $2, 'Quality', 'generating')",
    [projectId, userId],
  );
  await pool.query(
    `insert into source_images (
      id, project_id, storage_bucket, storage_key, declared_mime_type,
      mime_type, byte_size, status, recommended_size,
      consent_version, consent_hash, consented_at,
      rights_version, rights_hash, rights_confirmed_at
    ) values ($1, $2, 'private', $3, 'image/jpeg', 'image/jpeg', 1000, 'ready', true,
      $4, $5, now(), $6, $7, now())`,
    [
      imageId, projectId, `source-${imageId}.jpg`,
      PHOTO_PROCESSING_CONSENT_VERSION, PHOTO_PROCESSING_CONSENT_HASH,
      PHOTO_USAGE_RIGHTS_VERSION, PHOTO_USAGE_RIGHTS_HASH,
    ],
  );
  await pool.query(
    `insert into generations (
      id, project_id, source_image_id, revision, status, config_snapshot, geometry_policy_snapshot
    ) values ($1, $2, $3, 1, 'quality_check_pending', '{}'::jsonb, '{}'::jsonb)`,
    [generationId, projectId, imageId],
  );
  return { userId, projectId, generationId };
}

async function attempt(pool, generationId, number, candidateNumber) {
  const result = await pool.query(
    `insert into generation_attempts (
      generation_id, attempt_number, candidate_number, status,
      provider, model, result_bucket, result_key, result_mime_type, finished_at
    ) values ($1, $2, $3, 'succeeded', 'mock', 'mock', 'private', $4, 'image/jpeg', now())
    returning id`,
    [generationId, number, candidateNumber, `candidate-${number}.jpg`],
  );
  return result.rows[0].id;
}

function assessmentInput(generationId, generationAttemptId, assessmentNumber) {
  return {
    generationId, generationAttemptId, assessmentNumber,
    allowedChanges: {}, diagnosticBucket: "private",
    diagnosticKey: `candidate-${assessmentNumber}.jpg`, diagnosticMimeType: "image/jpeg",
    diagnosticExpiresAt: new Date(Date.now() - 1000),
    schemaVersion: "schema-v1", promptVersion: "prompt-v1", policyVersion: "policy-v1",
  };
}

test("quality repository persists at most two assessments and reports durable metrics", {
  skip: !enabled,
}, async () => {
  const pool = getPool();
  const data = await fixture(pool);
  const repository = new GenerationQualityRepository(pool);
  try {
    const firstAttempt = await attempt(pool, data.generationId, 1, 1);
    const first = await repository.startAssessment(
      assessmentInput(data.generationId, firstAttempt, 1),
    );
    await repository.completeAssessment(first.id, {
      decision: "retry_required", provider: "yandex", model: "vision",
      providerRequestId: "request-1", vlmResult: {}, structuralResult: {},
      scoreBreakdown: {}, overallScore: 5000, failureReasons: ["roof_below_threshold"],
      schemaVersion: "schema-v1", promptVersion: "prompt-v1", policyVersion: "policy-v1",
    });
    const secondAttempt = await attempt(pool, data.generationId, 2, 2);
    const second = await repository.startAssessment(
      assessmentInput(data.generationId, secondAttempt, 2),
    );
    await repository.completeAssessment(second.id, {
      decision: "rejected_refund", provider: "yandex", model: "vision",
      providerRequestId: "request-2", vlmResult: {}, structuralResult: {},
      scoreBreakdown: {}, overallScore: 4500, failureReasons: ["same_house_below_threshold"],
      schemaVersion: "schema-v1", promptVersion: "prompt-v1", policyVersion: "policy-v1",
    });
    const thirdAttempt = await attempt(pool, data.generationId, 3, 2);
    await assert.rejects(
      repository.startAssessment(assessmentInput(data.generationId, thirdAttempt, 3)),
      /generation_quality_assessments_number_chk/,
    );
    const rows = await repository.listForGeneration(data.generationId);
    assert.deepEqual(rows.map((row) => row.decision), ["retry_required", "rejected_refund"]);
    const metrics = await repository.qualityMetrics();
    assert.ok(metrics.retry_required >= 1);
    assert.ok(metrics.rejected_refunded >= 1);
    assert.equal(typeof metrics.refunds, "number");
    const expired = await repository.findExpiredDiagnostics(new Date(), 10);
    assert.ok(expired.some((row) => row.id === first.id));
  } finally {
    await pool.query("delete from projects where id = $1", [data.projectId]);
    await pool.query("delete from users where id = $1", [data.userId]);
  }
});

test.after(async () => {
  if (enabled) await closeDatabase();
});
