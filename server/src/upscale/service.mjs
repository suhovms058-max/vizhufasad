import { createFreeWatermark } from "../generation/watermark.mjs";
import { UpscaleError } from "./contract.mjs";

function idempotencyKey(value, userId) {
  const key = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,120}$/u.test(key)) throw new UpscaleError("INVALID_IDEMPOTENCY_KEY");
  return `upscale:${userId}:${key}`;
}

export class UpscaleService {
  constructor({ repository, queue, walletService, storage, config, planAccessService = null }) {
    this.repository = repository;
    this.queue = queue;
    this.walletService = walletService;
    this.storage = storage;
    this.config = config;
    this.planAccessService = planAccessService;
  }

  assertEnabled() {
    if (!this.config.enabled) throw new UpscaleError("UPSCALE_4K_DISABLED", 404);
  }

  async create(userId, projectId, generationId, requestedKey) {
    this.assertEnabled();
    if (this.planAccessService && !(await this.planAccessService.forUser(userId)).upscale) {
      throw new UpscaleError("UPSCALE_PLAN_REQUIRED", 403);
    }
    const created = await this.repository.createOwned({
      userId, projectId, generationId,
      idempotencyKey: idempotencyKey(requestedKey, userId),
    });
    if (!created) throw new UpscaleError("UPSCALE_SOURCE_NOT_READY", 409);
    if (!created.created && created.upscale.status !== "created") {
      if (created.upscale.status === "queued") await this.queue.enqueue(created.upscale.id);
      return this.view(userId, projectId, created.upscale.id);
    }
    const upscale = created.upscale;
    let reservation;
    try {
      reservation = await this.walletService.reserve(userId, {
        actionCode: "upscale_4k",
        idempotencyKey: `upscale:${upscale.id}:reserve`,
        referenceType: "generation_upscale",
        referenceId: upscale.id,
      });
      const queued = await this.repository.attachReservationAndQueue(upscale.id, reservation.transaction.id);
      if (!queued) throw new UpscaleError("UPSCALE_STATE_CONFLICT", 409);
      await this.queue.enqueue(upscale.id);
      return this.view(userId, projectId, upscale.id);
    } catch (error) {
      if (error?.code === "UPSCALE_QUEUE_UNAVAILABLE" && reservation) throw error;
      if (reservation?.transaction?.id) {
        await this.walletService.refund(
          userId, reservation.transaction.id, `upscale:${upscale.id}:refund`,
          error.code || "upscale_enqueue_failed",
        ).catch(() => {});
      }
      await this.repository.markFailedRefunded(upscale.id, error.code || "UPSCALE_ENQUEUE_FAILED");
      throw error;
    }
  }

  async view(userId, projectId, id) {
    const upscale = await this.repository.findOwned(userId, projectId, id);
    if (!upscale) throw new UpscaleError("UPSCALE_NOT_FOUND", 404);
    const { source_bucket: _sourceBucket, source_key: _sourceKey, result_bucket: _resultBucket,
      result_key: resultKey, wallet_reservation_id: _reservation, queue_job_id: _job, ...safe } = upscale;
    return {
      ...safe,
      resultAvailable: upscale.status === "completed" && Boolean(resultKey),
      cancellable: ["created", "queued"].includes(upscale.status) && !upscale.provider_request_id,
    };
  }

  async resultUrl(userId, projectId, id) {
    const upscale = await this.repository.findOwned(userId, projectId, id);
    if (!upscale) throw new UpscaleError("UPSCALE_NOT_FOUND", 404);
    if (upscale.status !== "completed" || !upscale.result_key) {
      throw new UpscaleError("UPSCALE_RESULT_NOT_READY", 409);
    }
    let key = upscale.result_key;
    if (upscale.requires_watermark) {
      key = upscale.watermark_key;
      if (!key) {
        key = upscale.result_key.replace(/\.([a-z0-9]+)$/iu, "-free-watermarked.$1");
        const source = await this.storage.getPrivateObjectBuffer(upscale.result_key, this.config.resultMaxBytes);
        await this.storage.putPrivateObject({
          key, body: await createFreeWatermark(source), contentType: "image/jpeg",
          metadata: { upscaleId: id, accessTier: "free", variant: "watermarked" },
        });
        await this.repository.setWatermarkKey(id, key);
      }
    }
    return this.storage.createDownloadUrl(key, this.config.resultUrlTtlSeconds);
  }

  async cancel(userId, projectId, id) {
    const cancelled = await this.repository.cancelOwned(userId, projectId, id);
    if (!cancelled) throw new UpscaleError("UPSCALE_CANNOT_BE_CANCELLED", 409);
    await this.queue.cancelWaiting(id).catch(() => false);
    if (cancelled.wallet_reservation_id) {
      await this.walletService.refund(
        userId, cancelled.wallet_reservation_id, `upscale:${id}:cancel-refund`, "user_cancelled",
      );
    }
    return this.view(userId, projectId, id);
  }
}
