import { GenerationError } from "./contract.mjs";

function integer(environment, name, fallback, minimum, maximum) {
  const value = Number.parseInt(environment[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new GenerationError(`INVALID_${name}`, 500);
  }
  return value;
}

function boolean(environment, name, fallback = false) {
  const value = String(environment[name] ?? fallback).toLowerCase();
  if (!["true", "false"].includes(value)) throw new GenerationError(`INVALID_${name}`, 500);
  return value === "true";
}

export function loadGenerationConfig(environment = process.env) {
  const enabled = boolean(environment, "FEATURE_STANDARD_GENERATION_ENABLED", false);
  const proEnabled = boolean(environment, "FEATURE_PRO_GENERATION_ENABLED", false);
  const editorEnabled = boolean(environment, "FEATURE_GENERATION_EDITOR_ENABLED", false);
  const apiKey = String(environment.GENAPI_API_KEY || "").trim();
  if ((enabled || proEnabled || editorEnabled) && !apiKey) throw new GenerationError("GENAPI_API_KEY_REQUIRED", 500);
  const model = environment.GENAPI_STANDARD_MODEL || "nano-banana-2";
  const proModel = String(environment.GENAPI_PRO_MODEL || "").trim();
  const editModel = String(environment.GENAPI_EDIT_MODEL || "").trim();
  const maskEditModel = String(environment.GENAPI_MASK_EDIT_MODEL || "bria-genfill").trim();
  if (proEnabled && !proModel) throw new GenerationError("GENAPI_PRO_MODEL_REQUIRED", 500);
  if (proEnabled && proModel === model) throw new GenerationError("GENAPI_PRO_MODEL_MUST_DIFFER", 500);
  if (editorEnabled && !editModel) throw new GenerationError("GENAPI_EDIT_MODEL_REQUIRED", 500);
  if (editorEnabled && !maskEditModel) throw new GenerationError("GENAPI_MASK_EDIT_MODEL_REQUIRED", 500);
  const stagingEnabled = String(environment.GENERATION_STAGING_ENABLED || "false") === "true";
  const stagingSecret = String(environment.GENERATION_STAGING_SECRET || "").trim();
  if (stagingEnabled && stagingSecret.length < 24) {
    throw new GenerationError("GENERATION_STAGING_SECRET_TOO_SHORT", 500);
  }
  if (environment.NODE_ENV === "production" && stagingEnabled) {
    throw new GenerationError("GENERATION_STAGING_FORBIDDEN_IN_PRODUCTION", 500);
  }
  const metricsToken = String(environment.GENERATION_METRICS_TOKEN || "").trim();
  if (metricsToken && metricsToken.length < 24) {
    throw new GenerationError("GENERATION_METRICS_TOKEN_TOO_SHORT", 500);
  }
  return Object.freeze({
    enabled,
    proEnabled,
    editorEnabled,
    provider: environment.GENERATION_PRIMARY_PROVIDER || "genapi",
    fallbackProvider: environment.GENERATION_FALLBACK_PROVIDER || "none",
    apiKey,
    endpoint: environment.GENAPI_ENDPOINT || "https://api.gen-api.ru/api/v1",
    model,
    proModel,
    editModel,
    maskEditModel,
    estimatedCostMinor: integer(environment, "GENAPI_STANDARD_ESTIMATED_COST_MINOR", 2500, 0, 100_000),
    proEstimatedCostMinor: integer(environment, "GENAPI_PRO_ESTIMATED_COST_MINOR", 5000, 0, 200_000),
    editEstimatedCostMinor: integer(environment, "GENAPI_EDIT_ESTIMATED_COST_MINOR", 2500, 0, 200_000),
    maskEditEstimatedCostMinor: integer(environment, "GENAPI_MASK_EDIT_ESTIMATED_COST_MINOR", 1500, 0, 200_000),
    currency: environment.GENAPI_COST_CURRENCY || "RUB",
    timeoutMs: integer(environment, "GENERATION_PROVIDER_TIMEOUT_MS", 180_000, 5_000, 600_000),
    pollIntervalMs: integer(environment, "GENERATION_POLL_INTERVAL_MS", 1_500, 250, 30_000),
    resultMaxBytes: integer(environment, "GENERATION_RESULT_MAX_BYTES", 25 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    resultSignedUrlTtlSeconds: integer(environment, "GENERATION_RESULT_URL_TTL_SECONDS", 300, 10, 3600),
    queueName: environment.GENERATION_QUEUE_NAME || "facade-generation",
    queuePrefix: environment.GENERATION_QUEUE_PREFIX || "vizhufasad",
    queueMaxAttempts: integer(environment, "GENERATION_QUEUE_MAX_ATTEMPTS", 3, 1, 10),
    queueBackoffMs: integer(environment, "GENERATION_QUEUE_BACKOFF_MS", 5_000, 250, 300_000),
    workerConcurrency: integer(environment, "GENERATION_WORKER_CONCURRENCY", 2, 1, 20),
    workerLockDurationMs: integer(environment, "GENERATION_WORKER_LOCK_DURATION_MS", 60_000, 10_000, 600_000),
    workerStalledIntervalMs: integer(environment, "GENERATION_WORKER_STALLED_INTERVAL_MS", 30_000, 5_000, 300_000),
    workerMaxStalledCount: integer(environment, "GENERATION_WORKER_MAX_STALLED_COUNT", 2, 1, 10),
    watchdogIntervalMs: integer(environment, "GENERATION_WATCHDOG_INTERVAL_MS", 30_000, 5_000, 600_000),
    watchdogStaleMs: integer(environment, "GENERATION_WATCHDOG_STALE_MS", 180_000, 30_000, 3_600_000),
    queuePaidPriority: integer(environment, "GENERATION_QUEUE_PAID_PRIORITY", 1, 1, 100),
    queueFreePriority: integer(environment, "GENERATION_QUEUE_FREE_PRIORITY", 10, 1, 100),
    metricsToken,
    stagingEnabled,
    stagingSecret,
    liveSmokeEnabled: boolean(environment, "GENERATION_LIVE_SMOKE_ENABLED", false),
  });
}
