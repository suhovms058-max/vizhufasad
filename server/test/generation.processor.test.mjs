import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { GenerationError } from "../src/generation/contract.mjs";
import { GenerationProcessor } from "../src/generation/processor.mjs";

async function jpeg() {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: "#d8c7aa" },
  }).jpeg().toBuffer();
}

function harness({ providerError, attemptsMade = 0, attempts = 3 } = {}) {
  const events = [];
  let status = "queued";
  const generation = {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    user_id: "33333333-3333-4333-8333-333333333333",
    wallet_reservation_id: "44444444-4444-4444-8444-444444444444",
    working_storage_key: "working.jpg",
    source_width: 1600,
    source_height: 1000,
    config_snapshot: { style: "современный", promptVersion: "standard-facade-v3" },
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
    async nextAttemptNumber() { return 1; },
    async startAttempt() { events.push(["attempt"]); return { id: "attempt-1" }; },
    async succeedAttempt() { events.push(["attempt-succeeded"]); },
    async failAttempt(_id, error) { events.push(["attempt-failed", error.code]); },
    async markRetrying(_id, code) { status = "retrying"; events.push(["retrying", code]); },
    async markCompleted() { status = "completed"; events.push(["completed"]); },
    async markFailedRefunded(_id, _projectId, code) {
      status = "failed_refunded";
      events.push(["failed-refunded", code]);
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
        provider: "mock",
        jobId: "job-1",
        model: "mock-edit",
        seed: 7,
        durationMs: 25,
        estimatedCostMinor: 100,
        actualCostMinor: 90,
        currency: "RUB",
        result: await jpeg(),
      };
    },
  };
  const processor = new GenerationProcessor({
    repository,
    storage,
    walletService,
    providers: [provider],
    config: { timeoutMs: 1_000, workerLockDurationMs: 60_000 },
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

test("worker executes all phases, commits once and stores a checked result", async () => {
  const { processor, job, events, getStatus } = harness();
  await processor.process(job);
  assert.equal(getStatus(), "completed");
  assert.deepEqual(
    events.filter((event) => ["status", "commit", "completed"].includes(event[0])),
    [
      ["status", "generating"],
      ["status", "quality_check_pending"],
      ["commit"],
      ["completed"],
    ],
  );
});

test("retryable provider error marks retrying and does not refund before final attempt", async () => {
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
