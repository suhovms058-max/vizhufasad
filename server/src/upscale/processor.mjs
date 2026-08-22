import sharp from "sharp";
import { isActual4k, UpscaleError } from "./contract.mjs";

async function grayscaleThumbnail(buffer) {
  return sharp(buffer, { limitInputPixels: 100_000_000 })
    .rotate().resize(256, 256, { fit: "fill" }).greyscale().raw().toBuffer();
}

async function validateUpscale(source, output) {
  let sourceMeta;
  let outputMeta;
  try {
    [sourceMeta, outputMeta] = await Promise.all([
      sharp(source, { limitInputPixels: 100_000_000 }).metadata(),
      sharp(output, { limitInputPixels: 100_000_000 }).metadata(),
    ]);
  } catch {
    throw new UpscaleError("UPSCALE_RESULT_DECODE_FAILED", 502, { retryable: true });
  }
  if (!isActual4k(outputMeta.width, outputMeta.height)) {
    throw new UpscaleError("UPSCALE_RESULT_NOT_4K", 502, { retryable: true });
  }
  const sourceRatio = sourceMeta.width / sourceMeta.height;
  const outputRatio = outputMeta.width / outputMeta.height;
  if (!Number.isFinite(sourceRatio) || Math.abs(Math.log(sourceRatio / outputRatio)) > 0.02) {
    throw new UpscaleError("UPSCALE_ASPECT_RATIO_CHANGED", 502, { retryable: true });
  }
  const [left, right] = await Promise.all([grayscaleThumbnail(source), grayscaleThumbnail(output)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference += Math.abs(left[index] - right[index]);
  const meanAbsoluteDifference = difference / left.length;
  if (meanAbsoluteDifference > 55) {
    throw new UpscaleError("UPSCALE_STRUCTURE_CHANGED", 502, { retryable: true });
  }
  return {
    actual4k: true,
    sourceWidth: sourceMeta.width,
    sourceHeight: sourceMeta.height,
    outputWidth: outputMeta.width,
    outputHeight: outputMeta.height,
    aspectRatioDelta: Math.abs(sourceRatio - outputRatio),
    thumbnailMeanAbsoluteDifference: Math.round(meanAbsoluteDifference * 100) / 100,
    policyVersion: "upscale-artifact-check-v1",
  };
}

function finalAttempt(job) {
  return job.attemptsMade + 1 >= Number(job.opts.attempts || 1);
}

export class UpscaleProcessor {
  constructor({ repository, provider, walletService, storage, config }) {
    this.repository = repository;
    this.provider = provider;
    this.walletService = walletService;
    this.storage = storage;
    this.config = config;
  }

  async refundAndFail(upscale, code) {
    if (upscale.wallet_reservation_id) {
      await this.walletService.refund(
        upscale.user_id, upscale.wallet_reservation_id, `upscale:${upscale.id}:refund`, code,
      );
    }
    await this.repository.markFailedRefunded(upscale.id, code);
  }

  async process(job, workerSignal) {
    const id = String(job.data?.upscaleId || "");
    if (!id) throw new UpscaleError("UPSCALE_JOB_INVALID", 400);
    const claimed = await this.repository.claim(id);
    if (!claimed) {
      const current = await this.repository.findById(id);
      if (!current || ["completed", "failed_refunded", "cancelled"].includes(current.status)) {
        return { skipped: true, status: current?.status || "missing" };
      }
      throw new UpscaleError("UPSCALE_ALREADY_RUNNING", 409, { retryable: true });
    }
    const upscale = await this.repository.findById(id);
    let storedKey;
    try {
      const source = await this.storage.getPrivateObjectBuffer(upscale.source_key, this.config.resultMaxBytes);
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const signal = workerSignal ? AbortSignal.any([workerSignal, timeout]) : timeout;
      const providerResult = await this.provider.upscale({
        sourceImage: source,
        signal,
        resumeRequestId: upscale.provider_request_id || null,
        onSubmitted: async (requestId) => {
          const stored = await this.repository.attachProviderRequest(
            id, requestId, this.provider.name, this.provider.model,
          );
          if (stored !== requestId) {
            throw new UpscaleError("UPSCALE_REQUEST_ID_PERSIST_FAILED", 500, { retryable: true });
          }
        },
      });
      const qualityResult = await validateUpscale(source, providerResult.result);
      const output = await sharp(providerResult.result, { limitInputPixels: 100_000_000 })
        .rotate().toColorspace("srgb").jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
      storedKey = `users/${upscale.user_id}/projects/${upscale.project_id}/generations/${upscale.generation_id}/4k/${upscale.id}.jpg`;
      await this.storage.putPrivateObject({
        key: storedKey, body: output, contentType: "image/jpeg",
        metadata: { upscaleId: id, sourceGenerationId: upscale.generation_id, actual4k: "true" },
      });
      await this.walletService.commit(upscale.user_id, upscale.wallet_reservation_id);
      await this.repository.markCompleted(id, {
        ...providerResult,
        bucket: this.storage.getStorageBucket(), key: storedKey, mimeType: "image/jpeg",
        width: qualityResult.outputWidth, height: qualityResult.outputHeight, qualityResult,
      });
      return { upscaleId: id, status: "completed", width: qualityResult.outputWidth, height: qualityResult.outputHeight };
    } catch (error) {
      if (storedKey) await this.storage.deletePrivateObject(storedKey).catch(() => {});
      const code = String(error?.code || error?.message || "UPSCALE_FAILED").slice(0, 120);
      if (error?.retryable === true && !finalAttempt(job)) {
        await this.repository.markRetryable(id, code);
        throw error;
      }
      await this.refundAndFail(upscale, code);
      throw error;
    }
  }
}
