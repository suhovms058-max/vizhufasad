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
  const enabled = String(environment.FEATURE_STANDARD_GENERATION_ENABLED || "false") === "true";
  const apiKey = String(environment.GENAPI_API_KEY || "").trim();
  if (enabled && !apiKey) throw new GenerationError("GENAPI_API_KEY_REQUIRED", 500);
  const stagingEnabled = String(environment.GENERATION_STAGING_ENABLED || "false") === "true";
  const stagingSecret = String(environment.GENERATION_STAGING_SECRET || "").trim();
  if (stagingEnabled && stagingSecret.length < 24) {
    throw new GenerationError("GENERATION_STAGING_SECRET_TOO_SHORT", 500);
  }
  if (environment.NODE_ENV === "production" && stagingEnabled) {
    throw new GenerationError("GENERATION_STAGING_FORBIDDEN_IN_PRODUCTION", 500);
  }
  return Object.freeze({
    enabled,
    provider: environment.GENERATION_PRIMARY_PROVIDER || "genapi",
    fallbackProvider: environment.GENERATION_FALLBACK_PROVIDER || "none",
    apiKey,
    endpoint: environment.GENAPI_ENDPOINT || "https://api.gen-api.ru/api/v1",
    model: environment.GENAPI_STANDARD_MODEL || "nano-banana-2",
    estimatedCostMinor: integer(environment, "GENAPI_STANDARD_ESTIMATED_COST_MINOR", 2500, 0, 100_000),
    currency: environment.GENAPI_COST_CURRENCY || "RUB",
    timeoutMs: integer(environment, "GENERATION_PROVIDER_TIMEOUT_MS", 180_000, 5_000, 600_000),
    pollIntervalMs: integer(environment, "GENERATION_POLL_INTERVAL_MS", 1_500, 250, 30_000),
    resultMaxBytes: integer(environment, "GENERATION_RESULT_MAX_BYTES", 25 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    resultSignedUrlTtlSeconds: integer(environment, "GENERATION_RESULT_URL_TTL_SECONDS", 300, 10, 3600),
    stagingEnabled,
    stagingSecret,
    liveSmokeEnabled: boolean(environment, "GENERATION_LIVE_SMOKE_ENABLED", false),
  });
}
