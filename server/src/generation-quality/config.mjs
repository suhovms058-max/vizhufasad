import { GenerationQualityError } from "./contract.mjs";

const providers = new Set(["auto", "yandex", "openai", "none"]);

function integer(environment, name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(environment[name] ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GenerationQualityError(`INVALID_${name}`);
  }
  return parsed;
}

function providerName(value, name) {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (!providers.has(normalized)) throw new GenerationQualityError(`INVALID_${name}`);
  return normalized;
}

export function loadGenerationQualityConfig(environment = process.env) {
  const enabled = String(environment.GENERATION_QUALITY_ENABLED ?? "true") === "true";
  const configured = {
    yandex: Boolean(environment.YANDEX_API_KEY && environment.YANDEX_FOLDER_ID),
    openai: Boolean(environment.OPENAI_API_KEY),
  };
  const requestedPrimary = providerName(
    environment.GENERATION_QUALITY_PRIMARY_PROVIDER,
    "GENERATION_QUALITY_PRIMARY_PROVIDER",
  );
  const primary = requestedPrimary === "auto"
    ? (configured.yandex ? "yandex" : configured.openai ? "openai" : "none")
    : requestedPrimary;
  const requestedFallback = providerName(
    environment.GENERATION_QUALITY_FALLBACK_PROVIDER,
    "GENERATION_QUALITY_FALLBACK_PROVIDER",
  );
  const fallback = requestedFallback === "auto"
    ? (primary !== "yandex" && configured.yandex
      ? "yandex"
      : primary !== "openai" && configured.openai ? "openai" : "none")
    : requestedFallback;
  if (primary !== "none" && !configured[primary]) {
    throw new GenerationQualityError("GENERATION_QUALITY_PRIMARY_NOT_CONFIGURED");
  }
  if (fallback !== "none" && (!configured[fallback] || fallback === primary)) {
    throw new GenerationQualityError("GENERATION_QUALITY_FALLBACK_INVALID");
  }
  const standardEnabled = String(environment.FEATURE_STANDARD_GENERATION_ENABLED || "false") === "true";
  if (standardEnabled && (!enabled || primary === "none")) {
    throw new GenerationQualityError("GENERATION_QUALITY_REQUIRED");
  }
  const adminToken = String(environment.GENERATION_QUALITY_ADMIN_TOKEN || "").trim();
  if (adminToken && adminToken.length < 24) {
    throw new GenerationQualityError("GENERATION_QUALITY_ADMIN_TOKEN_TOO_SHORT");
  }
  return Object.freeze({
    enabled,
    primary,
    fallback,
    models: Object.freeze({
      yandex: environment.GENERATION_QUALITY_YANDEX_MODEL || environment.YANDEX_MODEL || "qwen3.6-35b-a3b",
      openai: environment.GENERATION_QUALITY_OPENAI_MODEL || environment.OPENAI_MODEL || "gpt-4.1-mini",
    }),
    timeoutMs: integer(environment, "GENERATION_QUALITY_TIMEOUT_MS", 45_000, 1_000, 120_000),
    primaryAttempts: integer(environment, "GENERATION_QUALITY_PRIMARY_ATTEMPTS", 2, 1, 2),
    retryDelayMs: integer(environment, "GENERATION_QUALITY_RETRY_DELAY_MS", 500, 0, 5_000),
    diagnosticRetentionHours: integer(environment, "GENERATION_QUALITY_DIAGNOSTIC_RETENTION_HOURS", 72, 1, 720),
    diagnosticUrlTtlSeconds: integer(environment, "GENERATION_QUALITY_DIAGNOSTIC_URL_TTL_SECONDS", 300, 10, 3_600),
    adminToken,
    thresholds: Object.freeze({
      overall: integer(environment, "GENERATION_QUALITY_MIN_OVERALL", 7600, 0, 10_000),
      sameHouse: integer(environment, "GENERATION_QUALITY_MIN_SAME_HOUSE", 8500, 0, 10_000),
      protectedElement: integer(environment, "GENERATION_QUALITY_MIN_PROTECTED_ELEMENT", 7000, 0, 10_000),
      contours: integer(environment, "GENERATION_QUALITY_MIN_CONTOURS", 6800, 0, 10_000),
      spatialLayout: integer(environment, "GENERATION_QUALITY_MIN_SPATIAL_LAYOUT", 7000, 0, 10_000),
      protectedZones: integer(environment, "GENERATION_QUALITY_MIN_PROTECTED_ZONES", 6800, 0, 10_000),
      artifacts: integer(environment, "GENERATION_QUALITY_MIN_ARTIFACTS", 7500, 0, 10_000),
      style: integer(environment, "GENERATION_QUALITY_MIN_STYLE", 6500, 0, 10_000),
    }),
  });
}
