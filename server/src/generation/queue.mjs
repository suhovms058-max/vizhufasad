import { Queue } from "bullmq";
import { GenerationError } from "./contract.mjs";

export function redisConnectionFromUrl(value, { worker = false } = {}) {
  const url = new URL(value);
  if (!["redis:", "rediss:"].includes(url.protocol)) {
    throw new GenerationError("INVALID_REDIS_URL", 500);
  }
  const database = url.pathname && url.pathname !== "/"
    ? Number.parseInt(url.pathname.slice(1), 10)
    : 0;
  if (!Number.isInteger(database) || database < 0) {
    throw new GenerationError("INVALID_REDIS_URL", 500);
  }
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database,
    tls: url.protocol === "rediss:" ? {} : undefined,
    enableReadyCheck: true,
    maxRetriesPerRequest: worker ? null : 1,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 3_000),
  };
}

export function generationJobOptions(config, priority) {
  return {
    attempts: config.queueMaxAttempts,
    backoff: { type: "exponential", delay: config.queueBackoffMs },
    priority,
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5_000 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
  };
}

export class GenerationQueue {
  constructor({ queue, config }) {
    this.queue = queue;
    this.config = config;
  }

  async enqueue(generationId, priority) {
    try {
      const job = await this.queue.add(
        "standard",
        { generationId },
        {
          ...generationJobOptions(this.config, priority),
          jobId: generationId,
          deduplication: { id: generationId },
        },
      );
      return { id: job.id, deduplicated: job.id === generationId };
    } catch (error) {
      throw new GenerationError("GENERATION_QUEUE_UNAVAILABLE", 503, {
        retryable: true,
        details: error?.message,
      });
    }
  }

  async cancelWaiting(generationId) {
    const job = await this.queue.getJob(generationId);
    if (!job) return false;
    const state = await job.getState();
    if (!["waiting", "delayed", "prioritized", "waiting-children"].includes(state)) return false;
    await job.remove();
    return true;
  }

  async counts() {
    return this.queue.getJobCounts(
      "wait", "active", "delayed", "prioritized", "completed", "failed",
    );
  }

  async close() {
    await this.queue.close();
  }
}

export function createGenerationQueue(config, environment = process.env) {
  if (!environment.REDIS_URL) throw new GenerationError("REDIS_URL_REQUIRED", 500);
  const queue = new Queue(config.queueName, {
    prefix: config.queuePrefix,
    connection: redisConnectionFromUrl(environment.REDIS_URL),
    defaultJobOptions: generationJobOptions(config, config.queueFreePriority),
  });
  return new GenerationQueue({ queue, config });
}
