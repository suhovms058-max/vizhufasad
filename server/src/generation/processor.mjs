import { randomInt } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import sharp from "sharp";
import {
  GENERATION_QUALITY_POLICY_VERSION, GENERATION_QUALITY_PROMPT_VERSION,
  GENERATION_QUALITY_SCHEMA_VERSION, GenerationQualityError,
  allowedQualityChanges,
} from "../generation-quality/contract.mjs";
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
    qualityRepository,
    qualityOrchestrator,
    storage,
    walletService,
    providers,
    config,
    qualityConfig,
    seedFactory = () => randomInt(1, 2_147_483_647),
  }) {
    this.repository = repository;
    this.qualityRepository = qualityRepository;
    this.qualityOrchestrator = qualityOrchestrator;
    this.storage = storage;
    this.walletService = walletService;
    this.providers = providers.map(assertGenerationProvider);
    this.config = config;
    this.qualityConfig = qualityConfig;
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

  async generateCandidate({
    generation, sourceImage, maskImage, input, candidateNumber, retryReasons,
    retryObservation, dimensions, signal,
  }) {
    const generating = await this.repository.transition(
      generation.id,
      ["preprocessing"],
      "generating",
    );
    if (!generating) throw new GenerationError("GENERATION_STATE_CONFLICT", 409);
    const edit = generation.kind === "edit"
      ? { scope: generation.edit_scope, command: generation.edit_prompt }
      : null;
    const prompt = composeGenerationPrompt(input, {
      qualityRetryReasons: retryReasons,
      qualityRetryObservation: retryObservation,
      edit,
    });
    let lastError;
    const kind = generation.kind || "standard";
    const providers = this.providers.filter((provider) => (
      provider.generationKinds == null || provider.generationKinds.includes(kind)
    ) && (kind !== "edit" || provider.editScopes == null
      || provider.editScopes.includes(generation.edit_scope))
      && (provider.candidateNumbers == null || provider.candidateNumbers.includes(candidateNumber)));
    for (const provider of providers) {
      let attempt = await this.repository.resumeProviderAttempt?.(
        generation.id, candidateNumber, provider.name, provider.model,
      );
      const resumedRequestId = attempt?.provider_request_id || null;
      const seed = attempt?.seed || this.seedFactory();
      if (!attempt) {
        const attemptNumber = await this.repository.nextAttemptNumber(generation.id);
        attempt = await this.repository.startAttempt({
          generationId: generation.id,
          attemptNumber,
          provider: provider.name,
          model: provider.model,
          promptVersion: prompt.version,
          seed,
          estimatedCostMinor: provider.estimatedCostMinor ?? null,
          currency: provider.currency ?? null,
          candidateNumber,
        });
      }
      let submittedRequestId = resumedRequestId;
      const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
      const providerSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      try {
        const providerResult = await provider.generate({
          sourceImage,
          sourceMimeType: "image/jpeg",
          maskImage,
          maskMimeType: generation.edit_mask_mime_type || "image/png",
          prompt: prompt.prompt,
          seed,
          ...dimensions,
          signal: providerSignal,
          resumeRequestId: resumedRequestId,
          onSubmitted: async (requestId) => {
            submittedRequestId = requestId;
            let stored = null;
            for (const delayMs of [0, 100, 500]) {
              if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
              try {
                stored = await this.repository.attachProviderRequest(attempt.id, requestId);
                if (stored === requestId) break;
              } catch {
                stored = null;
              }
            }
            if (stored !== requestId) {
              // GenAPI may already have charged this request. Never create a second paid
              // request when the recovery identifier could not be stored durably.
              throw new GenerationError("GENAPI_REQUEST_ID_PERSIST_FAILED", 500, { retryable: false });
            }
          },
        });
        const candidateImage = await normalizeAndCheckProviderResult(providerResult.result);
        const key = `users/${generation.user_id}/projects/${generation.project_id}/generations/${generation.id}/quality/candidate-${candidateNumber}-${attempt.id}.jpg`;
        await this.storage.putPrivateObject({
          key,
          body: candidateImage,
          contentType: "image/jpeg",
          metadata: {
            generationId: generation.id,
            candidateNumber: String(candidateNumber),
            retention: "generation-quality-diagnostic",
          },
        });
        await this.repository.succeedAttempt(attempt.id, providerResult);
        await this.repository.attachAttemptResult(attempt.id, {
          bucket: this.storage.getStorageBucket(), key, mimeType: "image/jpeg",
        });
        return { attempt: { ...attempt, result_key: key }, candidateImage, prompt };
      } catch (caught) {
        lastError = caught instanceof GenerationError
          ? caught
          : new GenerationError("GENERATION_PROVIDER_FAILED", 502, { retryable: true });
        await this.repository.failAttempt(attempt.id, lastError);
        if (submittedRequestId) throw lastError;
        if (!lastError.retryable) break;
      }
    }
    throw lastError || new GenerationError("GENERATION_PROVIDER_UNAVAILABLE", 503, { retryable: true });
  }

  async finalizePassingCandidate({ generation, candidateImage, candidateKey, qualityAssessment }) {
    const resultKey = `users/${generation.user_id}/projects/${generation.project_id}/generations/${generation.id}/${generation.kind || "standard"}.jpg`;
    await this.storage.putPrivateObject({
      key: resultKey,
      body: candidateImage,
      contentType: "image/jpeg",
      metadata: {
        generationId: generation.id,
        qualityAssessmentId: qualityAssessment.id,
        qualityPolicyVersion: qualityAssessment.policy_version,
      },
    });
    await this.walletService.commit(generation.user_id, generation.wallet_reservation_id);
    await this.repository.markCompleted({
      generationId: generation.id,
      projectId: generation.project_id,
      bucket: this.storage.getStorageBucket(),
      key: resultKey,
      mimeType: "image/jpeg",
    });
    return { resultKey, candidateKey };
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
    let publicResultKey;
    try {
      if (!this.providers.length) {
        throw new GenerationError("GENERATION_PROVIDER_UNAVAILABLE", 503, { retryable: true });
      }
      if (!this.qualityOrchestrator || !this.qualityRepository || !this.qualityConfig?.enabled) {
        throw new GenerationQualityError("GENERATION_QUALITY_REQUIRED");
      }
      await job.updateProgress({ stage: "preprocessing", percent: 20 });
      const input = normalizeGenerationInput(generation.config_snapshot);
      const allowedChanges = allowedQualityChanges(input);
      const sourceImage = await this.storage.getPrivateObjectBuffer(
        generation.provider_source_key || generation.working_storage_key,
        25 * 1024 * 1024,
      );
      const maskImage = generation.edit_mask_key
        ? await this.storage.getPrivateObjectBuffer(generation.edit_mask_key, 5 * 1024 * 1024)
        : null;
      const dimensions = outputDimensions(generation.source_width, generation.source_height);
      const previous = await this.qualityRepository.listForGeneration(generationId);
      const alreadyPassed = previous.find((assessment) => assessment.decision === "passed");
      if (alreadyPassed?.diagnostic_key) {
        const candidateImage = await this.storage.getPrivateObjectBuffer(
          alreadyPassed.diagnostic_key,
          this.config.resultMaxBytes,
        );
        const finalized = await this.finalizePassingCandidate({
          generation,
          candidateImage,
          candidateKey: alreadyPassed.diagnostic_key,
          qualityAssessment: alreadyPassed,
        });
        publicResultKey = finalized.resultKey;
        await job.updateProgress({ stage: "completed", percent: 100 });
        return { generationId, status: "completed" };
      }

      let candidateNumber = previous.some((assessment) => assessment.decision === "retry_required") ? 2 : 1;
      let retryReasons = previous.find((assessment) => assessment.decision === "retry_required")
        ?.failure_reasons || [];
      let retryObservation = previous.find((assessment) => assessment.decision === "retry_required")
        ?.vlm_result || null;
      for (; candidateNumber <= 2; candidateNumber += 1) {
        await job.updateProgress({ stage: "generating", percent: candidateNumber === 1 ? 45 : 60 });
        let candidate = await this.repository.findCandidateForAssessment(generationId, candidateNumber);
        let candidateImage;
        let prompt;
        if (candidate) {
          const generating = await this.repository.transition(generationId, ["preprocessing"], "generating");
          if (!generating) throw new GenerationError("GENERATION_STATE_CONFLICT", 409);
          candidateImage = await this.storage.getPrivateObjectBuffer(
            candidate.result_key,
            this.config.resultMaxBytes,
          );
          prompt = composeGenerationPrompt(input, {
            qualityRetryReasons: retryReasons,
            qualityRetryObservation: retryObservation,
            edit: generation.kind === "edit"
              ? { scope: generation.edit_scope, command: generation.edit_prompt }
              : null,
          });
        } else {
          const generated = await this.generateCandidate({
            generation, sourceImage, maskImage, input, candidateNumber, retryReasons,
            retryObservation,
            dimensions, signal: workerSignal,
          });
          candidate = generated.attempt;
          candidateImage = generated.candidateImage;
          prompt = generated.prompt;
        }

        const checking = await this.repository.transition(
          generationId,
          ["generating"],
          "quality_check_pending",
        );
        if (!checking) throw new GenerationError("GENERATION_STATE_CONFLICT", 409);
        await job.updateProgress({ stage: "quality_check_pending", percent: candidateNumber === 1 ? 78 : 88 });
        const expiresAt = new Date(
          Date.now() + this.qualityConfig.diagnosticRetentionHours * 60 * 60 * 1000,
        );
        const assessment = await this.qualityRepository.startAssessment({
          generationId,
          generationAttemptId: candidate.id,
          assessmentNumber: candidateNumber,
          allowedChanges,
          diagnosticBucket: this.storage.getStorageBucket(),
          diagnosticKey: candidate.result_key,
          diagnosticMimeType: "image/jpeg",
          diagnosticExpiresAt: expiresAt,
          schemaVersion: GENERATION_QUALITY_SCHEMA_VERSION,
          promptVersion: GENERATION_QUALITY_PROMPT_VERSION,
          policyVersion: GENERATION_QUALITY_POLICY_VERSION,
        });
        let quality;
        try {
          quality = await this.qualityOrchestrator.assess({
            sourceImage, candidateImage, input, allowedChanges,
            assessmentNumber: candidateNumber,
          });
        } catch (error) {
          await this.qualityRepository.markProviderUnavailable(assessment.id);
          throw error;
        }
        const completedAssessment = await this.qualityRepository.completeAssessment(assessment.id, quality);
        if (!completedAssessment) throw new GenerationQualityError("QUALITY_ASSESSMENT_STATE_CONFLICT");

        if (quality.decision === "passed") {
          const finalized = await this.finalizePassingCandidate({
            generation,
            candidateImage,
            candidateKey: candidate.result_key,
            qualityAssessment: completedAssessment,
          });
          publicResultKey = finalized.resultKey;
          await job.updateProgress({ stage: "completed", percent: 100 });
          return { generationId, status: "completed" };
        }
        if (quality.decision === "retry_required" && candidateNumber === 1) {
          retryReasons = quality.failureReasons;
          retryObservation = quality.vlmResult;
          const retrying = await this.repository.transition(
            generationId, ["quality_check_pending"], "retrying",
            { failureCode: "QUALITY_RETRY_REQUIRED" },
          );
          if (!retrying) throw new GenerationQualityError("QUALITY_RETRY_STATE_CONFLICT");
          const preprocessing = await this.repository.transition(
            generationId, ["retrying"], "preprocessing",
          );
          if (!preprocessing) throw new GenerationQualityError("QUALITY_RETRY_STATE_CONFLICT");
          continue;
        }
        await this.refundAndFail(generation, "GENERATION_QUALITY_REJECTED");
        throw new UnrecoverableError("GENERATION_QUALITY_REJECTED");
      }
      throw new UnrecoverableError("GENERATION_QUALITY_REJECTED");
    } catch (error) {
      if (publicResultKey) await this.storage.deletePrivateObject(publicResultKey).catch(() => {});
      const current = await this.repository.findById(generationId).catch(() => null);
      if (current && ["completed", "failed_refunded", "cancelled"].includes(current.status)) {
        throw error instanceof UnrecoverableError
          ? error
          : new UnrecoverableError(String(error?.code || error?.message || "GENERATION_FAILED"));
      }
      const code = String(error?.code || error?.message || "GENERATION_FAILED").slice(0, 120);
      const retryable = isRetryableGenerationError(error)
        || error instanceof GenerationQualityError && error.retryable
        || !(error instanceof GenerationError || error instanceof GenerationQualityError);
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
