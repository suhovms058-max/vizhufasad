import assert from "node:assert/strict";
import test from "node:test";
import {
  GenerationQueue, generationJobOptions, redisConnectionFromUrl,
} from "../src/generation/queue.mjs";

function config() {
  return { queueMaxAttempts: 3, queueBackoffMs: 50 };
}

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

test("enqueue keeps an active job idempotent", async () => {
  let adds = 0;
  const queue = new GenerationQueue({
    config: config(),
    queue: {
      async getJob() {
        return { id: "generation-1", async getState() { return "active"; } };
      },
      async add() { adds += 1; },
    },
  });
  const result = await queue.enqueue("generation-1", 1);
  assert.deepEqual(result, { id: "generation-1", deduplicated: true });
  assert.equal(adds, 0);
});

test("enqueue recycles an exhausted job so the watchdog can recheck quality", async () => {
  const events = [];
  const queue = new GenerationQueue({
    config: config(),
    queue: {
      async getJob() {
        return {
          id: "generation-1",
          async getState() { return "failed"; },
          async remove() { events.push("remove"); },
        };
      },
      async add(_name, data, options) {
        events.push(["add", data.generationId, options.jobId]);
        return { id: options.jobId };
      },
    },
  });
  const result = await queue.enqueue("generation-1", 1);
  assert.deepEqual(events, ["remove", ["add", "generation-1", "generation-1"]]);
  assert.deepEqual(result, { id: "generation-1", deduplicated: false });
});
