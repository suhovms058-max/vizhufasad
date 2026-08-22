import { Queue } from "bullmq";
import { redisConnectionFromUrl } from "../generation/queue.mjs";
import { UpscaleError } from "./contract.mjs";

function options(config) {
  return {
    attempts: config.queueMaxAttempts,
    backoff: { type: "exponential", delay: config.queueBackoffMs },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5000 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
  };
}

export class UpscaleQueue {
  constructor({ queue, config }) { this.queue = queue; this.config = config; }
  async enqueue(upscaleId) {
    try {
      return await this.queue.add("upscale-4k", { upscaleId }, {
        ...options(this.config), jobId: upscaleId, deduplication: { id: upscaleId },
      });
    } catch (error) {
      throw new UpscaleError("UPSCALE_QUEUE_UNAVAILABLE", 503, { retryable: true, details: error?.message });
    }
  }
  async cancelWaiting(id) {
    const job = await this.queue.getJob(id);
    if (!job || !["waiting", "delayed", "prioritized"].includes(await job.getState())) return false;
    await job.remove();
    return true;
  }
  async close() { await this.queue.close(); }
}

export function createUpscaleQueue(config, environment = process.env) {
  if (!environment.REDIS_URL) throw new UpscaleError("REDIS_URL_REQUIRED", 500);
  return new UpscaleQueue({
    config,
    queue: new Queue(config.queueName, {
      prefix: config.queuePrefix,
      connection: redisConnectionFromUrl(environment.REDIS_URL),
      defaultJobOptions: options(config),
    }),
  });
}
