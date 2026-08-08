export const GENERATION_QUALITY_SCHEMA_VERSION = "generation-quality-assessment-v1";
export const GENERATION_QUALITY_PROMPT_VERSION = "facade-quality-compare-v1";
export const GENERATION_QUALITY_POLICY_VERSION = "facade-quality-policy-v1";

export const QUALITY_DECISIONS = Object.freeze([
  "passed", "retry_required", "rejected_refund",
]);

export const QUALITY_SCORE_NAMES = Object.freeze([
  "sameHouse", "floors", "roof", "windows", "doors",
  "balconiesTerraces", "position", "perspective", "artifacts", "style",
  "contours", "spatialLayout", "protectedZones",
]);

export const VLM_QUALITY_RESULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    sameHouse: { type: "number", minimum: 0, maximum: 1 },
    floors: { type: "number", minimum: 0, maximum: 1 },
    roof: { type: "number", minimum: 0, maximum: 1 },
    windows: { type: "number", minimum: 0, maximum: 1 },
    doors: { type: "number", minimum: 0, maximum: 1 },
    balconiesTerraces: { type: "number", minimum: 0, maximum: 1 },
    position: { type: "number", minimum: 0, maximum: 1 },
    perspective: { type: "number", minimum: 0, maximum: 1 },
    artifacts: { type: "number", minimum: 0, maximum: 1 },
    style: { type: "number", minimum: 0, maximum: 1 },
    detectedChanges: {
      type: "array",
      maxItems: 20,
      uniqueItems: true,
      items: {
        type: "string",
        enum: [
          "different_house", "floors_changed", "roof_changed", "windows_changed",
          "doors_changed", "balconies_terraces_changed", "position_changed",
          "perspective_changed", "severe_artifacts", "style_mismatch",
        ],
      },
    },
    summary: { type: "string", minLength: 1, maxLength: 600 },
  },
  required: [
    "sameHouse", "floors", "roof", "windows", "doors",
    "balconiesTerraces", "position", "perspective", "artifacts", "style",
    "detectedChanges", "summary",
  ],
});

export class GenerationQualityError extends Error {
  constructor(code, { retryable = false, status = 500, details = null } = {}) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.details = details;
  }
}

export function assertGenerationQualityProvider(provider) {
  if (!provider || typeof provider.compare !== "function") {
    throw new TypeError("GenerationQualityProvider.compare is required");
  }
  if (!provider.name || !provider.model) {
    throw new TypeError("GenerationQualityProvider name and model are required");
  }
  return provider;
}

export function qualityDecisionForAttempt(passed, assessmentNumber) {
  if (passed) return "passed";
  return Number(assessmentNumber) === 1 ? "retry_required" : "rejected_refund";
}

export function allowedQualityChanges(generationInput = {}) {
  const preserve = generationInput?.preserve || {};
  return Object.freeze({
    floors: preserve.floors === false && preserve.noNewFloors === false,
    roof: preserve.roof === false,
    windows: preserve.windows === false,
    doors: preserve.doors === false,
    perspective: preserve.perspective === false,
    position: preserve.housePosition === false,
    balconiesTerraces: preserve.balconies === false || preserve.terraces === false,
  });
}
