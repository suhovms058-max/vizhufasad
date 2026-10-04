import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationWorker } from "../src/generation/worker.mjs";

test("watchdog marks stale work retrying and idempotently recovers queued records", async () => {
  const events = [];
  const fakeWorker = {
    on() { return this; },
    async close() {},
  };
  const repository = {
    async findStaleActive() {
      return [{ id: "stale-1" }];
    },
    async markStalledRetrying(id, code) {
      events.push(["stale", id, code]);
    },
    async findRecoverableQueued() {
      return [{ id: "queued-1", priority: 10 }];
    },
  };
  const queue = {
    async enqueue(id, priority) { events.push(["enqueue", id, priority]); },
  };
  const metrics = {
    increment(name) { events.push(["metric", name]); },
  };
  const runtime = createGenerationWorker({
    config: {
      queueName: "unused",
      queuePrefix: "unused",
      workerConcurrency: 1,
      workerLockDurationMs: 60_000,
      workerStalledIntervalMs: 30_000,
      workerMaxStalledCount: 2,
      watchdogIntervalMs: 60_000,
      watchdogStaleMs: 180_000,
    },
    processor: { async process() {} },
    repository,
    queue,
    metrics,
    environment: { REDIS_URL: "redis://127.0.0.1:1" },
    workerFactory: () => fakeWorker,
  });
  try {
    await runtime.runWatchdog();
    assert.deepEqual(events, [
      ["stale", "stale-1", "WATCHDOG_STALE"],
      ["metric", "stalled"],
      ["enqueue", "queued-1", 10],
    ]);
  } finally {
    await runtime.close();
  }
});

test("exhausted quality-provider outage remains recoverable and is not refunded", async () => {
  const events = [];
  const handlers = new Map();
  const fakeWorker = {
    on(name, handler) { handlers.set(name, handler); return this; },
    async close() {},
  };
  const generation = {
    id: "generation-1",
    status: "retrying",
    failure_code: "GENERATION_QUALITY_UNAVAILABLE",
  };
  const runtime = createGenerationWorker({
    config: {
      queueName: "unused", queuePrefix: "unused", workerConcurrency: 1,
      workerLockDurationMs: 60_000, workerStalledIntervalMs: 30_000,
      workerMaxStalledCount: 2, watchdogIntervalMs: 60_000, watchdogStaleMs: 180_000,
    },
    processor: {
      async process() {},
      async refundAndFail() { events.push("refund"); },
    },
    repository: {
      async findById() { return generation; },
      async findStaleActive() { return []; },
      async findRecoverableQueued() { return []; },
    },
    queue: { async enqueue() {} },
    metrics: { increment(name) { events.push(name); } },
    environment: { REDIS_URL: "redis://127.0.0.1:1" },
    workerFactory: () => fakeWorker,
  });
  try {
    await handlers.get("failed")(
      { data: { generationId: generation.id }, attemptsMade: 3, opts: { attempts: 3 } },
      new Error("GENERATION_QUALITY_UNAVAILABLE"),
    );
    assert.deepEqual(events, ["failed", "quality_provider_recovery_pending"]);
  } finally {
    await runtime.close();
  }
});
