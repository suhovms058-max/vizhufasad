import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { QueueEvents, Worker } from "bullmq";
import {
  createGenerationQueue, redisConnectionFromUrl,
} from "../src/generation/queue.mjs";

const enabled = Boolean(process.env.REDIS_URL);

function config(queueName) {
  return {
    queueName,
    queuePrefix: "vizhufasad-test",
    queueMaxAttempts: 3,
    queueBackoffMs: 50,
    queueFreePriority: 10,
  };
}

test("Redis queue deduplicates and survives producer/API restart", {
  skip: !enabled,
  timeout: 15_000,
}, async () => {
  const queueName = `generation-${randomUUID()}`;
  const queueConfig = config(queueName);
  let producer = createGenerationQueue(queueConfig);
  const generationId = randomUUID();
  const first = await producer.enqueue(generationId, 10);
  const duplicate = await producer.enqueue(generationId, 10);
  assert.equal(first.id, generationId);
  assert.equal(duplicate.id, generationId);
  const counts = await producer.counts();
  assert.equal((counts.wait || 0) + (counts.prioritized || 0), 1);
  await producer.close();

  producer = createGenerationQueue(queueConfig);
  const queueEvents = new QueueEvents(queueName, {
    prefix: queueConfig.queuePrefix,
    connection: redisConnectionFromUrl(process.env.REDIS_URL, { worker: true }),
  });
  await queueEvents.waitUntilReady();
  let processed = 0;
  const worker = new Worker(
    queueName,
    async (job) => {
      processed += 1;
      return { generationId: job.data.generationId };
    },
    {
      prefix: queueConfig.queuePrefix,
      connection: redisConnectionFromUrl(process.env.REDIS_URL, { worker: true }),
      concurrency: 1,
    },
  );
  try {
    const job = await producer.queue.getJob(generationId);
    const result = await job.waitUntilFinished(queueEvents, 8_000);
    assert.equal(result.generationId, generationId);
    assert.equal(processed, 1);
  } finally {
    await worker.close();
    await queueEvents.close();
    await producer.queue.obliterate({ force: true });
    await producer.close();
  }
});
