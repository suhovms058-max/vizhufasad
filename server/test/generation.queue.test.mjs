import assert from "node:assert/strict";
import test from "node:test";
import {
  generationJobOptions, redisConnectionFromUrl,
} from "../src/generation/queue.mjs";

test("queue uses bounded retries, exponential backoff and explicit priority", () => {
  const options = generationJobOptions({
    queueMaxAttempts: 3,
    queueBackoffMs: 5_000,
  }, 10);
  assert.equal(options.attempts, 3);
  assert.deepEqual(options.backoff, { type: "exponential", delay: 5_000 });
  assert.equal(options.priority, 10);
});

test("worker Redis connection waits for recovery while API fails fast", () => {
  const api = redisConnectionFromUrl("redis://user:secret@localhost:6379/2");
  const worker = redisConnectionFromUrl("rediss://localhost:6380/0", { worker: true });
  assert.equal(api.db, 2);
  assert.equal(api.password, "secret");
  assert.equal(api.maxRetriesPerRequest, 1);
  assert.equal(worker.maxRetriesPerRequest, null);
  assert.deepEqual(worker.tls, {});
});
