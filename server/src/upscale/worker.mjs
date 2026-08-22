import { Worker } from "bullmq";
import { redisConnectionFromUrl } from "../generation/queue.mjs";

export function createUpscaleWorker({ config, processor, environment = process.env }) {
  const worker = new Worker(
    config.queueName,
    (job, _token, signal) => processor.process(job, signal),
    {
      prefix: config.queuePrefix,
      connection: redisConnectionFromUrl(environment.REDIS_URL, { worker: true }),
      concurrency: config.workerConcurrency,
      lockDuration: Math.max(config.timeoutMs + 30_000, 60_000),
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );
  worker.on("error", (error) => {
    console.error("Upscale worker error", { error: error?.message || "UPSCALE_WORKER_ERROR" });
  });
  return { worker, async close() { await worker.close(); } };
}
