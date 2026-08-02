import { randomInt } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import sharp from "sharp";
import {
  assertGenerationProvider, GenerationError, isRetryableGenerationError,
  normalizeGenerationInput,
} from "./contract.mjs";
import { composeGenerationPrompt } from "./prompt.mjs";

function outputDimensions(width, height) {
  const sourceWidth = Math.max(1, Number(width));
  const sourceHeight = Math.max(1, Number(height));
  const ratio = sourceWidth / sourceHeight;
  if (ratio >= 1) {
    return {
      width: 1024,
      height: Math.max(512, Math.round((1024 / ratio) / 16) * 16),
    };
  }
  return {
    height: 1024,
    width: Math.max(512, Math.round((1024 * ratio) / 16) * 16),
  };
}

async function normalizeAndCheckProviderResult(buffer) {
  try {
    const image = sharp(buffer, { limitInputPixels: 80_000_000 }).rotate().toColorspace("srgb");
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512) {
      throw new Error("RESULT_DIMENSIONS_INVALID");
    }
    return image.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  } catch {
    throw new GenerationError("PROVIDER_RESULT_DECODE_FAILED", 502, { retryable: true });
  }
}

function finalQueueAttempt(job) {
  return job.attemptsMade + 1 >= Number(job.opts.attempts || 1);
}

export class GenerationProcessor {
  constructor({
    repository,
    storage,
    walletService,
    providers,
    config,
    seedFactory = () => randomInt(1, 2_147_483_647),
  }) {
    this.repository = repository;
    this.storage = storage;
    this.walletService = walletService;
    this.providers = providers.map(assertGenerationProvider);
    this.config = config;
    this.seedFactory = seedFactory;
  }

  async refundAndFail(generation, failureCode) {
    if (generation.wallet_reservation_id) {
      await this.walletService.refund(
        generation.user_id,
        generation.wallet_reservation_id,
        `generation:${generation.id}:refund`,
        failureCode || "technical_failure",
      );
    }
    await this.repository.markFailedRefunded(
      generation.id,
      generation.project_id,
      failureCode || "GENERATION_FAILED",
    );
  }

  async process(job, workerSignal) {
    const generationId = String(job.data?.generationId || "");
    if (!generationId) throw new UnrecoverableError("GENERATION_JOB_INVALID");
    const claimed = await this.repository.claimForWorker(generationId);
    if (!claimed) {
      const current = await this.repository.findById(generationId);
      if (!current || ["completed", "failed_refunded", "cancelled"].includes(current.status)) {
        return { skipped: true, status: current?.status || "missing" };
      }
      throw new Error("GENERATION_ALREADY_RUNNING");
    }

    const generation = await this.repository.findById(generationId);
    if (!generation) throw new UnrecoverableError("GENERATION_NOT_FOUND");
    const heartbeat = setInterval(
      () => this.repository.heartbeat(generationId).catch(() => {}),
      Math.max(5_000, Math.floor(this.config.workerLockDurationMs / 3)),
    );
    heartbeat.unref?.();
    let resultKey;
    try {
      if (!this.providers.length) {
        throw new GenerationError("GENERATION_PROVIDER_UNAVAILABLE", 503, { retryable: true });
      }
      await job.updateProgress({ stage: "preprocessing", percent: 20 });
      const input = normalizeGenerationInput(generation.config_snapshot);
      const prompt = composeGenerationPrompt(input);
      const sourceImage = await this.storage.getPrivateObjectBuffer(
        generation.working_storage_key,
        25 * 1024 * 1024,
      );
      const dimensions = outputDimensions(generation.source_width, generation.source_height);
      const generating = await this.repository.transition(
        generationId,
        ["preprocessing"],
        "generating",
      );
      if (!generating) throw new GenerationError("GENERATION_STATE_CONFLICT", 409);
      await job.updateProgress({ stage: "generating", percent: 45 });

      let providerResult;
      let lastError;
      for (const provider of this.providers) {
        const seed = this.seedFactory();
        const attemptNumber = await this.repository.nextAttemptNumber(generationId);
        const attempt = await this.repository.startAttempt({
          generationId,
          attemptNumber,
          provider: provider.name,
          model: provider.model,
          promptVersion: prompt.version,
          seed,
          estimatedCostMinor: provider.estimatedCostMinor ?? null,
          currency: provider.currency ?? null,
        });
        const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
        const signal = workerSignal
          ? AbortSignal.any([workerSignal, timeoutSignal])
          : timeoutSignal;
        try {
          providerResult = await provider.generate({
            sourceImage,
            sourceMimeType: "image/jpeg",
            prompt: prompt.prompt,
            seed,
            ...dimensions,
            signal,
          });
          await this.repository.succeedAttempt(attempt.id, providerResult);
          break;
        } catch (error) {
          lastError = error instanceof GenerationError
            ? error
            : new GenerationError("GENERATION_PROVIDER_FAILED", 502, { retryable: true });
          await this.repository.failAttempt(attempt.id, lastError);
          if (!lastError.retryable) break;
        }
      }
      if (!providerResult) throw lastError || new GenerationError(
        "GENERATION_PROVIDER_FAILED",
        502,
        { retryable: true },
      );

      const checking = await this.repository.transition(
        generationId,
        ["generating"],
        "quality_check_pending",
      );
      if (!checking) throw new GenerationError("GENERATION_STATE_CONFLICT", 409);
      await job.updateProgress({ stage: "quality_check_pending", percent: 80 });
      const normalized = await normalizeAndCheckProviderResult(providerResult.result);
      resultKey = `users/${generation.user_id}/projects/${generation.project_id}/generations/${generation.id}/standard.jpg`;
      await this.storage.putPrivateObject({
        key: resultKey,
        body: normalized,
        contentType: "image/jpeg",
        metadata: {
          generationId: generation.id,
          provider: providerResult.provider,
          promptVersion: prompt.version,
        },
      });
      await this.walletService.commit(
        generation.user_id,
        generation.wallet_reservation_id,
      );
      await this.repository.markCompleted({
        generationId,
        projectId: generation.project_id,
        bucket: this.storage.getStorageBucket(),
        key: resultKey,
        mimeType: "image/jpeg",
      });
      await job.updateProgress({ stage: "completed", percent: 100 });
      return { generationId, status: "completed" };
    } catch (error) {
      if (resultKey) await this.storage.deletePrivateObject(resultKey).catch(() => {});
      const code = String(error?.code || error?.message || "GENERATION_FAILED").slice(0, 120);
      const retryable = isRetryableGenerationError(error)
        || !(error instanceof GenerationError);
      if (retryable && !finalQueueAttempt(job)) {
        await this.repository.markRetrying(generationId, code);
        throw error instanceof Error ? error : new Error(code);
      }
      await this.refundAndFail(generation, code);
      throw new UnrecoverableError(code);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
