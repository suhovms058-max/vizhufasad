const providerNames = new Set(["auto", "yandex", "openai", "none"]);

function providerName(value, variable) {
  const name = String(value || "auto").trim().toLowerCase();
  if (!providerNames.has(name)) throw new Error(`${variable} must be auto, yandex, openai or none`);
  return name;
}

function integer(value, fallback, { min, max, name }) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function loadPhotoAssessmentConfig(environment = process.env) {
  const configured = {
    yandex: Boolean(environment.YANDEX_API_KEY && environment.YANDEX_FOLDER_ID),
    openai: Boolean(environment.OPENAI_API_KEY),
  };
  const requestedPrimary = providerName(
    environment.PHOTO_ASSESSMENT_PRIMARY_PROVIDER || "auto",
    "PHOTO_ASSESSMENT_PRIMARY_PROVIDER",
  );
  const primary = requestedPrimary === "auto"
    ? (configured.yandex ? "yandex" : configured.openai ? "openai" : "none")
    : requestedPrimary;
  const requestedFallback = providerName(
    environment.PHOTO_ASSESSMENT_FALLBACK_PROVIDER || "auto",
    "PHOTO_ASSESSMENT_FALLBACK_PROVIDER",
  );
  const fallback = requestedFallback === "auto"
    ? (primary !== "yandex" && configured.yandex
      ? "yandex"
      : primary !== "openai" && configured.openai ? "openai" : "none")
    : requestedFallback;
  if (primary !== "none" && !configured[primary]) {
    throw new Error(`${primary.toUpperCase()} photo assessment provider is not configured`);
  }
  if (fallback !== "none" && (!configured[fallback] || fallback === primary)) {
    throw new Error("PHOTO_ASSESSMENT_FALLBACK_PROVIDER must be configured and differ from primary");
  }
  if (environment.NODE_ENV === "production" && primary === "none") {
    throw new Error("A photo assessment provider is required in production");
  }
  return {
    primary,
    fallback,
    timeoutMs: integer(environment.PHOTO_ASSESSMENT_TIMEOUT_MS, 45_000, {
      min: 1_000, max: 120_000, name: "PHOTO_ASSESSMENT_TIMEOUT_MS",
    }),
    primaryAttempts: integer(environment.PHOTO_ASSESSMENT_PRIMARY_ATTEMPTS, 2, {
      min: 1, max: 2, name: "PHOTO_ASSESSMENT_PRIMARY_ATTEMPTS",
    }),
    retryDelayMs: integer(environment.PHOTO_ASSESSMENT_RETRY_DELAY_MS, 500, {
      min: 0, max: 5_000, name: "PHOTO_ASSESSMENT_RETRY_DELAY_MS",
    }),
    models: {
      yandex: environment.YANDEX_MODEL || "qwen3.6-35b-a3b",
      openai: environment.OPENAI_MODEL || "gpt-4.1-mini",
    },
  };
}
