import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { GenerationError } from "../src/generation/contract.mjs";
import { GenerationProcessor } from "../src/generation/processor.mjs";

async function jpeg(color = "#d8c7aa") {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: color },
  }).jpeg().toBuffer();
}

function qualityResult(decision, number) {
  return {
    decision,
    overallScore: decision === "passed" ? 9000 : 5000,
    failureReasons: decision === "passed" ? [] : ["roof_below_threshold"],
    scoreBreakdown: {}, vlmResult: {}, structuralResult: {},
    schemaVersion: "generation-quality-assessment-v1",
    promptVersion: "facade-quality-compare-v1",
    policyVersion: "facade-quality-policy-v1",
    provider: "quality-mock", model: "quality-model",
    providerRequestId: `quality-${number}`,
  };
}

function harness({
  providerError,
  attemptsMade = 0,
  attempts = 3,
  qualityDecisions = ["passed"],
  existingCandidate = false,
} = {}) {
  const events = [];
  let status = "queued";
  let attemptNumber = 0;
  let qualityNumber = 0;
  const generation = {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    user_id: "33333333-3333-4333-8333-333333333333",
    wallet_reservation_id: "44444444-4444-4444-8444-444444444444",
    working_storage_key: "working.jpg",
    source_width: 1600,
    source_height: 1000,
    config_snapshot: { style: "modern", promptVersion: "standard-facade-v3" },
  };
  const repository = {
    async claimForWorker() {
      if (!["queued", "retrying"].includes(status)) return null;
      status = "preprocessing";
      return generation;
    },
    async findById() { return { ...generation, status }; },
    async heartbeat() {},
    async transition(_id, _from, to) { status = to; events.push(["status", to]); return generation; },
    async nextAttemptNumber() { attemptNumber += 1; return attemptNumber; },
    async startAttempt(input) {
      events.push(["attempt", input.candidateNumber]);
      return { id: `attempt-${attemptNumber}` };
    },
    async succeedAttempt() { events.push(["attempt-succeeded"]); },
    async attachAttemptResult(_id, result) { events.push(["candidate-attached", result.key]); },
    async findCandidateForAssessment() {
      return existingCandidate
        ? { id: "persisted-attempt", result_key: "persisted-candidate.jpg" }
        : null;
    },
    async failAttempt(_id, error) { events.push(["attempt-failed", error.code]); },
    async markRetrying(_id, code) { status = "retrying"; events.push(["retrying", code]); },
    async markCompleted() { status = "completed"; events.push(["completed"]); },
    async markFailedRefunded(_id, _projectId, code) {
      status = "failed_refunded";
      events.push(["failed-refunded", code]);
    },
  };
  const qualityRepository = {
    async listForGeneration() { return []; },
    async startAssessment(input) {
      qualityNumber = input.assessmentNumber;
      events.push(["quality-start", qualityNumber]);
      return { id: `quality-${qualityNumber}` };
    },
    async completeAssessment(_id, result) {
      events.push(["quality-complete", result.decision]);
      return { id: `quality-${qualityNumber}`, policy_version: result.policyVersion };
    },
    async markProviderUnavailable() { events.push(["quality-unavailable"]); },
  };
  const qualityOrchestrator = {
    async assess({ assessmentNumber }) {
      const decision = qualityDecisions[assessmentNumber - 1] || "rejected_refund";
      return qualityResult(decision, assessmentNumber);
    },
  };
  const storage = {
    async getPrivateObjectBuffer() { return jpeg(); },
    async putPrivateObject({ key }) { events.push(["stored", key]); },
    async deletePrivateObject() { events.push(["deleted"]); },
    getStorageBucket() { return "private"; },
  };
  const walletService = {
    async commit() { events.push(["commit"]); },
    async refund() { events.push(["refund"]); },
  };
  const provider = {
    name: "mock",
    model: "mock-edit",
    estimatedCostMinor: 100,
    currency: "RUB",
    async generate() {
      events.push(["provider"]);
      if (providerError) throw providerError;
      return {
        provider: "mock", jobId: `job-${attemptNumber}`, model: "mock-edit",
        seed: 7, durationMs: 25, estimatedCostMinor: 100,
        actualCostMinor: 90, currency: "RUB", result: await jpeg(),
      };
    },
  };
  const processor = new GenerationProcessor({
    repository,
    qualityRepository,
    qualityOrchestrator,
    storage,
    walletService,
    providers: [provider],
    config: { timeoutMs: 1_000, workerLockDurationMs: 60_000, resultMaxBytes: 25_000_000 },
    qualityConfig: { enabled: true, diagnosticRetentionHours: 72 },
    seedFactory: () => 7,
  });
  const job = {
    data: { generationId: generation.id },
    attemptsMade,
    opts: { attempts },
    async updateProgress(progress) { events.push(["progress", progress.stage]); },
  };
  return { events, processor, job, getStatus: () => status };
}

test("a passing candidate is published only after quality assessment and commits once", async () => {
  const { processor, job, events, getStatus } = harness();
  await processor.process(job);
  assert.equal(getStatus(), "completed");
  assert.deepEqual(
    events.filter((event) => ["quality-complete", "commit", "completed"].includes(event[0])),
    [["quality-complete", "passed"], ["commit"], ["completed"]],
  );
});

test("first quality rejection triggers one free stricter candidate and then passes", async () => {
  const { processor, job, events, getStatus } = harness({
    qualityDecisions: ["retry_required", "passed"],
  });
  await processor.process(job);
  assert.equal(getStatus(), "completed");
  assert.equal(events.filter((event) => event[0] === "provider").length, 2);
  assert.deepEqual(events.filter((event) => event[0] === "quality-complete"), [
    ["quality-complete", "retry_required"],
    ["quality-complete", "passed"],
  ]);
  assert.equal(events.filter((event) => event[0] === "commit").length, 1);
  assert.equal(events.some((event) => event[0] === "refund"), false);
});

test("second quality rejection hides the result and refunds once", async () => {
  const { processor, job, events, getStatus } = harness({
    qualityDecisions: ["retry_required", "rejected_refund"],
  });
  await assert.rejects(processor.process(job), /GENERATION_QUALITY_REJECTED/);
  assert.equal(getStatus(), "failed_refunded");
  assert.equal(events.filter((event) => event[0] === "refund").length, 1);
  assert.equal(events.some((event) => event[0] === "commit"), false);
  assert.equal(events.filter((event) => event[0] === "provider").length, 2);
});

test("retryable provider error marks retrying and does not refund before final queue attempt", async () => {
  const { processor, job, events, getStatus } = harness({
    providerError: new GenerationError("PROVIDER_BUSY", 502, { retryable: true }),
  });
  await assert.rejects(processor.process(job), /PROVIDER_BUSY/);
  assert.equal(getStatus(), "retrying");
  assert.equal(events.some((event) => event[0] === "refund"), false);
});

test("final provider failure refunds and becomes failed_refunded", async () => {
  const { processor, job, events, getStatus } = harness({
    providerError: new GenerationError("PROVIDER_DOWN", 502, { retryable: true }),
    attemptsMade: 2,
    attempts: 3,
  });
  await assert.rejects(processor.process(job), /PROVIDER_DOWN/);
  assert.equal(getStatus(), "failed_refunded");
  assert.deepEqual(
    events.filter((event) => ["refund", "failed-refunded"].includes(event[0])).map((event) => event[0]),
    ["refund", "failed-refunded"],
  );
});

test("worker restart reuses a persisted unassessed candidate instead of generating a duplicate", async () => {
  const { processor, job, events, getStatus } = harness({ existingCandidate: true });
  await processor.process(job);
  assert.equal(getStatus(), "completed");
  assert.equal(events.filter((event) => event[0] === "provider").length, 0);
  assert.deepEqual(events.filter((event) => event[0] === "quality-complete"), [
    ["quality-complete", "passed"],
  ]);
});
