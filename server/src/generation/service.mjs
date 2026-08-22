import {
  GenerationError, normalizeGenerationInput, normalizeGenerationKind,
} from "./contract.mjs";
import { composeGenerationPrompt } from "./prompt.mjs";
import { createFreeWatermark } from "./watermark.mjs";

function cleanIdempotencyKey(value, userId, kind) {
  const key = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,120}$/u.test(key)) {
    throw new GenerationError("INVALID_IDEMPOTENCY_KEY");
  }
  return `${kind}:${userId}:${key}`;
}

const actionCodeByKind = Object.freeze({
  standard: "standard_generation",
  pro: "pro_generation",
});

export class GenerationService {
  constructor({ repository, storage, walletService, queue, config }) {
    this.repository = repository;
    this.storage = storage;
    this.walletService = walletService;
    this.queue = queue;
    this.config = config;
  }

  assertEnabled(kind) {
    if (kind === "standard" && !this.config.enabled) {
      throw new GenerationError("STANDARD_GENERATION_DISABLED", 404);
    }
    if (kind === "pro" && !this.config.proEnabled) {
      throw new GenerationError("PRO_GENERATION_DISABLED", 404);
    }
  }

  async create(userId, projectId, sourceImageId, value, requestedIdempotencyKey) {
    return this.createKind("standard", userId, projectId, sourceImageId, value, requestedIdempotencyKey);
  }

  async createPro(userId, projectId, sourceImageId, value, requestedIdempotencyKey) {
    return this.createKind("pro", userId, projectId, sourceImageId, value, requestedIdempotencyKey);
  }

  async createKind(requestedKind, userId, projectId, sourceImageId, value, requestedIdempotencyKey) {
    const kind = normalizeGenerationKind(requestedKind);
    this.assertEnabled(kind);
    const input = normalizeGenerationInput(value);
    const idempotencyKey = cleanIdempotencyKey(requestedIdempotencyKey, userId, kind);
    const prompt = composeGenerationPrompt(input);
    const created = await this.repository.createOwned({
      userId,
      projectId,
      sourceImageId,
      kind,
      idempotencyKey,
      configSnapshot: { ...input, generationKind: kind, promptVersion: prompt.version },
      geometryPolicySnapshot: input.preserve,
    });
    if (!created) throw new GenerationError("GENERATION_SOURCE_NOT_ELIGIBLE", 409);
    if (!created.created && created.generation.status !== "created") {
      if (["queued", "retrying"].includes(created.generation.status)) {
        await this.queue.enqueue(
          created.generation.id,
          created.generation.priority || this.config.queueFreePriority,
        );
      }
      return this.view(userId, projectId, created.generation.id);
    }

    // A duplicate in `created` means the API stopped after the durable insert but
    // before reserve/enqueue. The wallet key and DB transition are idempotent, so
    // the retry safely resumes instead of leaving an orphaned generation.
    const generation = created.generation;
    let reservation;
    try {
      reservation = await this.walletService.reserve(userId, {
        actionCode: actionCodeByKind[kind],
        idempotencyKey: `generation:${generation.id}:reserve`,
        referenceType: "generation",
        referenceId: generation.id,
      });
      const paid = await this.repository.hasPaidCredits(userId);
      const priority = paid ? this.config.queuePaidPriority : this.config.queueFreePriority;
      const queued = await this.repository.attachReservationAndQueue(
        generation.id,
        reservation.transaction.id,
        generation.id,
        priority,
        !paid,
      );
      if (!queued) throw new GenerationError("GENERATION_STATE_CONFLICT", 409);
      await this.queue.enqueue(generation.id, priority);
      return this.view(userId, projectId, generation.id);
    } catch (error) {
      if (error?.code === "GENERATION_QUEUE_UNAVAILABLE" && reservation) {
        // The durable DB record remains queued. A duplicate request or worker watchdog
        // will idempotently add the same job when Redis recovers.
        throw error;
      }
      if (reservation?.transaction?.id) {
        await this.walletService.refund(
          userId,
          reservation.transaction.id,
          `generation:${generation.id}:refund`,
          error.code || "enqueue_failed",
        ).catch(() => {});
      }
      await this.repository.markFailedRefunded(
        generation.id,
        projectId,
        error.code || "GENERATION_ENQUEUE_FAILED",
      );
      throw error;
    }
  }

  async view(userId, projectId, generationId) {
    const generation = await this.repository.findOwned(userId, projectId, generationId);
    if (!generation) throw new GenerationError("GENERATION_NOT_FOUND", 404);
    const {
      result_bucket: _bucket,
      result_key: key,
      wallet_reservation_id: _reservation,
      queue_job_id: _job,
      heartbeat_at: _heartbeat,
      ...safe
    } = generation;
    return {
      ...safe,
      resultAvailable: generation.status === "completed" && Boolean(key),
    };
  }

  async resultUrl(userId, projectId, generationId) {
    const generation = await this.repository.findOwned(userId, projectId, generationId);
    if (!generation) throw new GenerationError("GENERATION_NOT_FOUND", 404);
    if (generation.status !== "completed" || !generation.result_key) {
      throw new GenerationError("GENERATION_RESULT_NOT_READY", 409);
    }
    let key = generation.result_key;
    if (generation.requires_watermark) {
      key = generation.watermark_key;
      if (!key) {
        key = generation.result_key.replace(/\.([a-z0-9]+)$/iu, "-free-watermarked.$1");
        const original = await this.storage.getPrivateObjectBuffer(
          generation.result_key,
          this.config.resultMaxBytes,
        );
        await this.storage.putPrivateObject({
          key,
          body: await createFreeWatermark(original),
          contentType: "image/jpeg",
          metadata: { generationId, accessTier: "free", variant: "watermarked" },
        });
        await this.repository.setWatermarkKey(generationId, key);
      }
    }
    return this.storage.createDownloadUrl(
      key,
      this.config.resultSignedUrlTtlSeconds,
    );
  }

  async list(userId, projectId) {
    const generations = await this.repository.listOwned(userId, projectId);
    return Promise.all(generations.map((generation) => this.view(
      userId, projectId, generation.id,
    )));
  }

  async favorite(userId, projectId, generationId, favorite) {
    if (typeof favorite !== "boolean") throw new GenerationError("INVALID_FAVORITE");
    const generation = await this.repository.setFavoriteOwned(
      userId, projectId, generationId, favorite,
    );
    if (!generation) throw new GenerationError("GENERATION_NOT_FOUND", 404);
    return this.view(userId, projectId, generationId);
  }

  async latest(userId, projectId) {
    const generation = await this.repository.findLatestOwned(userId, projectId);
    if (!generation) return null;
    return this.view(userId, projectId, generation.id);
  }

  async cancel(userId, projectId, generationId) {
    const cancelled = await this.repository.cancelOwned(userId, projectId, generationId);
    if (!cancelled) {
      const existing = await this.repository.findOwned(userId, projectId, generationId);
      if (!existing) throw new GenerationError("GENERATION_NOT_FOUND", 404);
      if (existing.status === "cancelled") return this.view(userId, projectId, generationId);
      throw new GenerationError("GENERATION_CANNOT_BE_CANCELLED", 409);
    }
    await this.queue.cancelWaiting(cancelled.queue_job_id || generationId).catch(() => false);
    if (cancelled.wallet_reservation_id) {
      await this.walletService.refund(
        userId,
        cancelled.wallet_reservation_id,
        `generation:${generationId}:cancel-refund`,
        "user_cancelled",
      );
    }
    return this.view(userId, projectId, generationId);
  }
}
