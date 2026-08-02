import { Worker } from "bullmq";
import { redisConnectionFromUrl } from "./queue.mjs";

export function createGenerationWorker({
  config,
  processor,
  repository,
  queue,
  metrics,
  environment = process.env,
  workerFactory = (name, processorFunction, options) => new Worker(
    name, processorFunction, options,
  ),
}) {
  const worker = workerFactory(
    config.queueName,
    (job, _token, signal) => processor.process(job, signal),
    {
      prefix: config.queuePrefix,
      connection: redisConnectionFromUrl(environment.REDIS_URL, { worker: true }),
      concurrency: config.workerConcurrency,
      lockDuration: config.workerLockDurationMs,
      stalledInterval: config.workerStalledIntervalMs,
      maxStalledCount: config.workerMaxStalledCount,
    },
  );

  worker.on("completed", () => metrics.increment("completed"));
  worker.on("failed", async (job, error) => {
    metrics.increment("failed");
    if (!job?.data?.generationId) return;
    const generation = await repository.findById(job.data.generationId).catch(() => null);
    if (!generation || ["completed", "failed_refunded", "cancelled"].includes(generation.status)) return;
    const exhausted = job.attemptsMade >= Number(job.opts.attempts || 1);
    if (exhausted) {
      await processor.refundAndFail(
        generation,
        String(error?.message || "GENERATION_RETRIES_EXHAUSTED").slice(0, 120),
      ).catch((refundError) => {
        console.error("Generation terminal refund failed", {
          generationId: generation.id,
          error: refundError?.code || refundError?.message || "REFUND_FAILED",
        });
      });
    } else {
      metrics.increment("retries");
    }
  });
  worker.on("stalled", async (jobId) => {
    metrics.increment("stalled");
    await repository.markStalledRetrying(jobId).catch(() => {});
  });
  worker.on("error", (error) => {
    console.error("Generation worker error", { error: error?.message || "WORKER_ERROR" });
  });

  const runWatchdog = async () => {
    const staleBefore = new Date(Date.now() - config.watchdogStaleMs);
    const stale = await repository.findStaleActive(staleBefore);
    for (const generation of stale) {
      await repository.markStalledRetrying(generation.id, "WATCHDOG_STALE");
      metrics.increment("stalled");
    }
    const recoverable = await repository.findRecoverableQueued();
    for (const generation of recoverable) {
      await queue.enqueue(generation.id, generation.priority);
    }
  };
  const watchdog = setInterval(
    () => runWatchdog().catch((error) => {
      console.error("Generation watchdog error", { error: error?.message || "WATCHDOG_FAILED" });
    }),
    config.watchdogIntervalMs,
  );
  watchdog.unref?.();

  return {
    worker,
    runWatchdog,
    async close() {
      clearInterval(watchdog);
      await worker.close();
    },
  };
}
