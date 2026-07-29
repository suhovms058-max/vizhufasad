import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { GenerationError } from "../src/generation/contract.mjs";
import { GenerationService } from "../src/generation/service.mjs";

async function jpeg() {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: "#d8c7aa" },
  }).jpeg().toBuffer();
}

function harness({ providerFails = false, duplicate = false } = {}) {
  const events = [];
  const generation = {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    status: duplicate ? "ready" : "queued",
  };
  const repository = {
    async createOwned() {
      if (duplicate) return { generation, created: false };
      return {
        generation,
        source: {
          working_storage_key: "working.jpg",
          width: 1600,
          height: 1000,
        },
        created: true,
      };
    },
    async attachReservation(_id, reservationId) {
      events.push(["attach", reservationId]);
    },
    async startAttempt(input) {
      events.push(["attempt", input.provider, input.model]);
      return { id: "attempt-1" };
    },
    async succeedAttempt(_id, result) {
      events.push(["succeeded", result.jobId]);
    },
    async failAttempt(_id, error) {
      events.push(["failed-attempt", error.code]);
    },
    async markReady(input) {
      events.push(["ready", input.key]);
    },
    async markFailed(_id, _projectId, code) {
      events.push(["failed", code]);
    },
    async findOwned() {
      return { ...generation, status: duplicate ? "ready" : "ready", result_key: "result.jpg", attempts: [] };
    },
  };
  const storage = {
    async getPrivateObjectBuffer() { return jpeg(); },
    async putPrivateObject(input) { events.push(["stored", input.key, input.contentType]); },
    async deletePrivateObject(key) { events.push(["deleted", key]); },
    getStorageBucket() { return "private"; },
    async createDownloadUrl() { return "https://signed.example/result"; },
  };
  const walletService = {
    async reserve() {
      events.push(["reserve"]);
      return { transaction: { id: "reservation-1" } };
    },
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
      if (providerFails) throw new GenerationError("PROVIDER_DOWN", 502, { retryable: false });
      return {
        provider: "mock",
        jobId: "job-1",
        model: "mock-edit",
        seed: 7,
        durationMs: 25,
        estimatedCostMinor: 100,
        actualCostMinor: 90,
        currency: "RUB",
        contentType: "image/jpeg",
        result: await jpeg(),
      };
    },
  };
  return {
    events,
    service: new GenerationService({
      repository,
      storage,
      walletService,
      providers: [provider],
      config: { enabled: true, timeoutMs: 1000, resultSignedUrlTtlSeconds: 300 },
      seedFactory: () => 7,
    }),
  };
}

const input = {
  style: "современный",
  transformationLevel: "gentle",
  materials: ["штукатурка"],
  palette: ["#EFE8DB"],
};

test("Standard generation reserves, stores, commits and returns owner-safe view", async () => {
  const { service, events } = harness();
  const result = await service.create(
    "user-1",
    "project-1",
    "image-1",
    input,
    "request-12345",
  );
  assert.equal(result.resultAvailable, true);
  assert.deepEqual(events.map((event) => event[0]), [
    "reserve", "attach", "attempt", "provider", "succeeded", "stored", "commit", "ready",
  ]);
  assert.equal("result_key" in result, false);
});

test("technical provider failure refunds exactly after a reservation", async () => {
  const { service, events } = harness({ providerFails: true });
  await assert.rejects(
    service.create("user-1", "project-1", "image-1", input, "request-12345"),
    (error) => error.code === "PROVIDER_DOWN",
  );
  assert.deepEqual(events.map((event) => event[0]), [
    "reserve", "attach", "attempt", "provider", "failed-attempt", "failed", "refund",
  ]);
});

test("duplicate request returns the existing generation without another charge", async () => {
  const { service, events } = harness({ duplicate: true });
  const result = await service.create(
    "user-1",
    "project-1",
    "image-1",
    input,
    "request-12345",
  );
  assert.equal(result.resultAvailable, true);
  assert.deepEqual(events, []);
});
