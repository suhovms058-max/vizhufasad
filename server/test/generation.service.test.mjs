import assert from "node:assert/strict";
import test from "node:test";
import { GenerationError } from "../src/generation/contract.mjs";
import { GenerationService } from "../src/generation/service.mjs";

function harness({
  duplicate = false,
  duplicateStatus = "completed",
  queueFails = false,
  paid = false,
  allowCancel = false,
  remoteRequestId = null,
} = {}) {
  const events = [];
  let createdInput;
  const generation = {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    status: duplicate ? duplicateStatus : "created",
    priority: 10,
  };
  const repository = {
    async createOwned(input) {
      createdInput = input;
      return duplicate
        ? { generation, created: false }
        : { generation, source: {}, created: true };
    },
    async hasPaidCredits() { return paid; },
    async attachReservationAndQueue(_id, reservationId, jobId, priority, requiresWatermark) {
      events.push(["queued-db", reservationId, jobId, priority, requiresWatermark]);
      generation.status = "queued";
      generation.queue_job_id = jobId;
      generation.wallet_reservation_id = reservationId;
      return generation;
    },
    async markFailedRefunded(_id, _projectId, code) { events.push(["failed", code]); },
    async findOwned() {
      return {
        ...generation,
        result_key: duplicate && duplicateStatus === "completed" ? "result.jpg" : null,
        attempts: remoteRequestId ? [{ jobId: remoteRequestId }] : [],
      };
    },
    async findLatestOwned() { return null; },
    async cancelOwned() {
      if (!allowCancel) return null;
      generation.status = "cancelled";
      return {
        ...generation,
        queue_job_id: generation.id,
        wallet_reservation_id: "reservation-1",
      };
    },
  };
  const walletService = {
    async reserve(_userId, input) {
      events.push(["reserve", input.actionCode]);
      return { transaction: { id: "reservation-1" } };
    },
    async refund() { events.push(["refund"]); },
  };
  const queue = {
    async enqueue(id, priority) {
      events.push(["enqueue", id, priority]);
      if (queueFails) {
        throw new GenerationError("GENERATION_QUEUE_UNAVAILABLE", 503, { retryable: true });
      }
      return { id };
    },
    async cancelWaiting() { return true; },
  };
  return {
    events,
    generation,
    getCreatedInput: () => createdInput,
    service: new GenerationService({
      repository,
      storage: { async createDownloadUrl() { return "https://signed.example"; } },
      walletService,
      queue,
      config: {
        enabled: true,
        proEnabled: true,
        queuePaidPriority: 1,
        queueFreePriority: 10,
        resultSignedUrlTtlSeconds: 300,
        resultMaxBytes: 25 * 1024 * 1024,
      },
    }),
  };
}

const input = {
  style: "современный",
  transformationLevel: "gentle",
  materials: ["штукатурка"],
  palette: ["#EFE8DB"],
};

test("HTTP generation creation only reserves and enqueues without provider wait", async () => {
  const { service, events } = harness();
  const result = await service.create("user-1", "project-1", "image-1", input, "request-12345");
  assert.equal(result.status, "queued");
  assert.deepEqual(events.map((event) => event[0]), ["reserve", "queued-db", "enqueue"]);
});

test("Pro generation persists its kind and reserves the two-credit action", async () => {
  const { service, events, getCreatedInput } = harness();
  const result = await service.createPro("user-1", "project-1", "image-1", input, "pro-request-12345");
  assert.equal(result.status, "queued");
  assert.equal(getCreatedInput().kind, "pro");
  assert.equal(getCreatedInput().configSnapshot.generationKind, "pro");
  assert.deepEqual(events.find((event) => event[0] === "reserve"), ["reserve", "pro_generation"]);
});

test("duplicate request returns existing generation without another charge", async () => {
  const { service, events } = harness({ duplicate: true });
  const result = await service.create("user-1", "project-1", "image-1", input, "request-12345");
  assert.equal(result.resultAvailable, true);
  assert.deepEqual(events, []);
});

test("duplicate created record resumes reserve and enqueue after an API restart", async () => {
  const { service, events } = harness({ duplicate: true, duplicateStatus: "created" });
  const result = await service.create("user-1", "project-1", "image-1", input, "request-12345");
  assert.equal(result.status, "queued");
  assert.deepEqual(events.map((event) => event[0]), ["reserve", "queued-db", "enqueue"]);
});

test("Redis outage leaves durable queued reservation for recovery instead of losing credit", async () => {
  const { service, events, generation } = harness({ queueFails: true });
  await assert.rejects(
    service.create("user-1", "project-1", "image-1", input, "request-12345"),
    (error) => error.code === "GENERATION_QUEUE_UNAVAILABLE",
  );
  assert.equal(generation.status, "queued");
  assert.deepEqual(events.map((event) => event[0]), ["reserve", "queued-db", "enqueue"]);
});

test("paid customer receives higher queue priority determined on the server", async () => {
  const { service, events } = harness({ paid: true });
  await service.create("user-1", "project-1", "image-1", input, "request-12345");
  assert.deepEqual(events.find((event) => event[0] === "enqueue"), [
    "enqueue", "11111111-1111-4111-8111-111111111111", 1,
  ]);
  assert.equal(events.find((event) => event[0] === "queued-db")[4], false);
});

test("free customer generation is marked for a watermarked result", async () => {
  const { service, events } = harness();
  await service.create("user-1", "project-1", "image-1", input, "request-12345");
  assert.equal(events.find((event) => event[0] === "queued-db")[4], true);
});

test("cancelling a waiting generation removes the job and refunds idempotently", async () => {
  const { service, events, generation } = harness({ allowCancel: true });
  generation.status = "queued";
  const cancelled = await service.cancel("user-1", "project-1", generation.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(events.some((event) => event[0] === "refund"), true);
});

test("a retrying generation with an accepted provider request cannot be cancelled in the UI", async () => {
  const { service, generation } = harness({ remoteRequestId: "paid-request-42" });
  generation.status = "retrying";
  const viewed = await service.view("user-1", "project-1", generation.id);
  assert.equal(viewed.cancellable, false);
});
