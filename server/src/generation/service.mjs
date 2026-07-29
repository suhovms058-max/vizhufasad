import { randomInt } from "node:crypto";
import sharp from "sharp";
import {
  assertGenerationProvider, GenerationError, normalizeGenerationInput,
} from "./contract.mjs";
import { composeGenerationPrompt } from "./prompt.mjs";

function cleanIdempotencyKey(value, userId) {
  const key = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,120}$/u.test(key)) {
    throw new GenerationError("INVALID_IDEMPOTENCY_KEY");
  }
  return `standard:${userId}:${key}`;
}

function outputDimensions(width, height) {
  const sourceWidth = Math.max(1, Number(width));
  const sourceHeight = Math.max(1, Number(height));
  const ratio = sourceWidth / sourceHeight;
  let outputWidth;
  let outputHeight;
  if (ratio >= 1) {
    outputWidth = 1024;
    outputHeight = Math.max(512, Math.round((1024 / ratio) / 16) * 16);
  } else {
    outputHeight = 1024;
    outputWidth = Math.max(512, Math.round((1024 * ratio) / 16) * 16);
  }
  return { width: outputWidth, height: outputHeight };
}

async function normalizeProviderResult(buffer) {
  try {
    return await sharp(buffer, { limitInputPixels: 80_000_000 })
      .rotate()
      .toColorspace("srgb")
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toBuffer();
  } catch {
    throw new GenerationError("PROVIDER_RESULT_DECODE_FAILED", 502);
  }
}

export class GenerationService {
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

  assertEnabled() {
    if (!this.config.enabled) throw new GenerationError("STANDARD_GENERATION_DISABLED", 404);
    if (!this.providers.length) throw new GenerationError("GENERATION_PROVIDER_UNAVAILABLE", 503);
  }

  async create(userId, projectId, sourceImageId, value, requestedIdempotencyKey) {
    this.assertEnabled();
    const input = normalizeGenerationInput(value);
    const idempotencyKey = cleanIdempotencyKey(requestedIdempotencyKey, userId);
    const prompt = composeGenerationPrompt(input);
    const created = await this.repository.createOwned({
      userId,
      projectId,
      sourceImageId,
      idempotencyKey,
      configSnapshot: { ...input, promptVersion: prompt.version },
      geometryPolicySnapshot: input.preserve,
    });
    if (!created) throw new GenerationError("GENERATION_SOURCE_NOT_ELIGIBLE", 409);
    if (!created.created) return this.view(userId, projectId, created.generation.id);

    const generation = created.generation;
    let reservation;
    let resultKey;
    let finalized = false;
    try {
      reservation = await this.walletService.reserve(userId, {
        actionCode: "standard_generation",
        idempotencyKey: `generation:${generation.id}:reserve`,
        referenceType: "generation",
        referenceId: generation.id,
      });
      await this.repository.attachReservation(generation.id, reservation.transaction.id);
      const sourceImage = await this.storage.getPrivateObjectBuffer(
        created.source.working_storage_key,
        25 * 1024 * 1024,
      );
      const dimensions = outputDimensions(created.source.width, created.source.height);
      let lastError;
      let providerResult;

      for (let index = 0; index < this.providers.length; index += 1) {
        const provider = this.providers[index];
        const seed = this.seedFactory();
        const attempt = await this.repository.startAttempt({
          generationId: generation.id,
          attemptNumber: index + 1,
          provider: provider.name,
          model: provider.model,
          promptVersion: prompt.version,
          seed,
          estimatedCostMinor: provider.estimatedCostMinor ?? null,
          currency: provider.currency ?? null,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
          providerResult = await provider.generate({
            sourceImage,
            sourceMimeType: "image/jpeg",
            prompt: prompt.prompt,
            seed,
            ...dimensions,
            signal: controller.signal,
          });
          await this.repository.succeedAttempt(attempt.id, providerResult);
          break;
        } catch (error) {
          lastError = error instanceof GenerationError
            ? error
            : new GenerationError("GENERATION_PROVIDER_FAILED", 502);
          await this.repository.failAttempt(attempt.id, lastError);
          if (!lastError.retryable) break;
        } finally {
          clearTimeout(timer);
        }
      }
      if (!providerResult) throw lastError || new GenerationError("GENERATION_PROVIDER_FAILED", 502);

      const normalized = await normalizeProviderResult(providerResult.result);
      resultKey = `users/${userId}/projects/${projectId}/generations/${generation.id}/standard.jpg`;
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
      await this.walletService.commit(userId, reservation.transaction.id);
      await this.repository.markReady({
        generationId: generation.id,
        projectId,
        bucket: this.storage.getStorageBucket(),
        key: resultKey,
        mimeType: "image/jpeg",
      });
      finalized = true;
      return this.view(userId, projectId, generation.id);
    } catch (error) {
      if (finalized) throw error;
      if (resultKey) await this.storage.deletePrivateObject(resultKey).catch(() => {});
      await this.repository.markFailed(generation.id, projectId, error.code || error.message);
      if (reservation?.transaction?.id) {
        await this.walletService.refund(
          userId,
          reservation.transaction.id,
          `generation:${generation.id}:refund`,
          error.code || "technical_failure",
        ).catch((refundError) => {
          console.error("Generation refund failed and requires reconciliation", {
            generationId: generation.id,
            error: refundError?.code || refundError?.name || "REFUND_FAILED",
          });
        });
      }
      if (error instanceof GenerationError) throw error;
      if (error?.status && error?.code) throw error;
      throw new GenerationError("STANDARD_GENERATION_FAILED", 500);
    }
  }

  async view(userId, projectId, generationId) {
    const generation = await this.repository.findOwned(userId, projectId, generationId);
    if (!generation) throw new GenerationError("GENERATION_NOT_FOUND", 404);
    const { result_bucket: _bucket, result_key: key, ...safe } = generation;
    return {
      ...safe,
      resultAvailable: generation.status === "ready" && Boolean(key),
    };
  }

  async resultUrl(userId, projectId, generationId) {
    const generation = await this.repository.findOwned(userId, projectId, generationId);
    if (!generation) throw new GenerationError("GENERATION_NOT_FOUND", 404);
    if (generation.status !== "ready" || !generation.result_key) {
      throw new GenerationError("GENERATION_RESULT_NOT_READY", 409);
    }
    return this.storage.createDownloadUrl(
      generation.result_key,
      this.config.resultSignedUrlTtlSeconds,
    );
  }
}
