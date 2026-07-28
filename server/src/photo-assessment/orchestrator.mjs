import Ajv from "ajv";
import { decidePhotoAssessment } from "./policy.mjs";
import { PhotoAssessmentProviderError } from "./providers.mjs";
import { providerObservationSchema } from "./schema.mjs";

const noOpRecorder = {
  async started() {},
  async finished() {},
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class PhotoAssessmentUnavailableError extends Error {
  constructor(attempts) {
    super("PHOTO_ASSESSMENT_UNAVAILABLE");
    this.code = "PHOTO_ASSESSMENT_UNAVAILABLE";
    this.attempts = attempts;
  }
}

export class PhotoAssessmentOrchestrator {
  constructor({
    providers,
    config,
    recorder = noOpRecorder,
    delay = wait,
  }) {
    this.providers = providers;
    this.config = config;
    this.recorder = recorder;
    this.delay = delay;
    const ajv = new Ajv({ allErrors: true, strict: true });
    this.validateObservation = ajv.compile(providerObservationSchema);
  }

  async assess({ image, technical, recorder = this.recorder }) {
    const route = [];
    if (this.config.primary !== "none") {
      route.push({ name: this.config.primary, attempts: this.config.primaryAttempts });
    }
    if (this.config.fallback !== "none") route.push({ name: this.config.fallback, attempts: 1 });
    const attempts = [];
    let attemptNumber = 0;

    for (const target of route) {
      const provider = this.providers[target.name];
      if (!provider) continue;
      for (let providerAttempt = 1; providerAttempt <= target.attempts; providerAttempt += 1) {
        attemptNumber += 1;
        const attempt = {
          attemptNumber,
          provider: provider.name,
          model: provider.model,
          startedAt: new Date(),
        };
        attempts.push(attempt);
        await recorder.started(attempt);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
          const result = await provider.assess({ image, signal: controller.signal });
          if (!this.validateObservation(result.observation)) {
            throw new PhotoAssessmentProviderError("PROVIDER_SCHEMA_INVALID", { retryable: true });
          }
          Object.assign(attempt, {
            status: "succeeded",
            requestId: result.requestId,
            finishedAt: new Date(),
          });
          await recorder.finished(attempt);
          return {
            ...decidePhotoAssessment(technical, result.observation),
            provider: provider.name,
            model: provider.model,
            attempts,
          };
        } catch (caught) {
          const error = caught instanceof PhotoAssessmentProviderError
            ? caught
            : new PhotoAssessmentProviderError("PROVIDER_UNEXPECTED_ERROR");
          Object.assign(attempt, {
            status: error.retryable ? "retryable_failed" : "terminal_failed",
            errorCode: error.code,
            finishedAt: new Date(),
          });
          await recorder.finished(attempt);
          const canRetryProvider = error.retryable && providerAttempt < target.attempts;
          if (canRetryProvider && this.config.retryDelayMs) {
            await this.delay(this.config.retryDelayMs);
          }
          if (!canRetryProvider) break;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw new PhotoAssessmentUnavailableError(attempts);
  }
}
