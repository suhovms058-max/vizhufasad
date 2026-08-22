import { UpscaleError } from "./contract.mjs";

function integer(environment, name, fallback, minimum, maximum) {
  const value = Number.parseInt(environment[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new UpscaleError(`INVALID_${name}`, 500);
  }
  return value;
}

function boolean(environment, name, fallback = false) {
  const value = String(environment[name] ?? fallback).toLowerCase();
  if (!['true', 'false'].includes(value)) throw new UpscaleError(`INVALID_${name}`, 500);
  return value === "true";
}

export function loadUpscaleConfig(environment = process.env) {
  const enabled = boolean(environment, "FEATURE_UPSCALE_4K_ENABLED", false);
  const apiKey = String(environment.GENAPI_API_KEY || "").trim();
  if (enabled && !apiKey) throw new UpscaleError("GENAPI_API_KEY_REQUIRED", 500);
  return Object.freeze({
    enabled,
    provider: environment.UPSCALE_PROVIDER || "genapi",
    model: environment.GENAPI_UPSCALE_MODEL || "drct-super-resolution",
    endpoint: environment.GENAPI_ENDPOINT || "https://api.gen-api.ru/api/v1",
    apiKey,
    factor: integer(environment, "GENAPI_UPSCALE_FACTOR", 4, 2, 4),
    estimatedCostMinor: integer(environment, "GENAPI_UPSCALE_ESTIMATED_COST_MINOR", 1000, 0, 200_000),
    currency: environment.GENAPI_COST_CURRENCY || "RUB",
    pollIntervalMs: integer(environment, "UPSCALE_POLL_INTERVAL_MS", 1500, 250, 30_000),
    timeoutMs: integer(environment, "UPSCALE_TIMEOUT_MS", 240_000, 5_000, 900_000),
    resultMaxBytes: integer(environment, "UPSCALE_RESULT_MAX_BYTES", 50 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    resultUrlTtlSeconds: integer(environment, "UPSCALE_RESULT_URL_TTL_SECONDS", 300, 10, 3600),
    queueName: environment.UPSCALE_QUEUE_NAME || "facade-upscale",
    queuePrefix: environment.GENERATION_QUEUE_PREFIX || "vizhufasad",
    queueMaxAttempts: integer(environment, "UPSCALE_QUEUE_MAX_ATTEMPTS", 2, 1, 5),
    queueBackoffMs: integer(environment, "UPSCALE_QUEUE_BACKOFF_MS", 5000, 250, 300_000),
    workerConcurrency: integer(environment, "UPSCALE_WORKER_CONCURRENCY", 1, 1, 10),
  });
}
