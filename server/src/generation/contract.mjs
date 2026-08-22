export const GENERATION_MODES = Object.freeze(["gentle", "balanced", "conceptual"]);
export const GENERATION_KINDS = Object.freeze(["standard", "pro", "edit"]);
export const GENERATION_EDIT_SCOPES = Object.freeze([
  "full_facade", "walls", "plinth", "roof", "entrance", "custom_mask",
]);
export const GENERATION_PROMPT_VERSION = "standard-facade-v3";
export const GENERATION_INPUT_VERSION = "1";
export const GENERATION_STATUSES = Object.freeze([
  "created", "queued", "preprocessing", "generating", "quality_check_pending",
  "completed", "retrying", "failed_refunded", "cancelled",
]);

export const GENERATION_TRANSITIONS = Object.freeze({
  created: Object.freeze(["queued", "failed_refunded", "cancelled"]),
  queued: Object.freeze(["preprocessing", "cancelled", "failed_refunded"]),
  preprocessing: Object.freeze(["generating", "retrying", "failed_refunded", "cancelled"]),
  generating: Object.freeze(["quality_check_pending", "retrying", "failed_refunded"]),
  quality_check_pending: Object.freeze(["completed", "retrying", "failed_refunded"]),
  retrying: Object.freeze(["preprocessing", "cancelled", "failed_refunded"]),
  completed: Object.freeze([]),
  failed_refunded: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export const CANCELLABLE_GENERATION_STATUSES = Object.freeze([
  "created", "queued", "retrying",
]);

const generationStatusSet = new Set(GENERATION_STATUSES);

const modeSet = new Set(GENERATION_MODES);
const kindSet = new Set(GENERATION_KINDS);
const editScopeSet = new Set(GENERATION_EDIT_SCOPES);

export class GenerationError extends Error {
  constructor(code, status = 400, { retryable = false, details = null } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function assertGenerationTransition(from, to) {
  if (!generationStatusSet.has(from) || !GENERATION_TRANSITIONS[from].includes(to)) {
    throw new GenerationError("GENERATION_STATE_CONFLICT", 409, {
      details: { from, to },
    });
  }
  return true;
}

export function isRetryableGenerationError(error) {
  return error instanceof GenerationError && error.retryable === true;
}

export function isBadGenerationInputError(error) {
  const code = String(error?.code || error?.message || "");
  return error instanceof GenerationError
    && error.status >= 400
    && error.status < 500
    && !["GENERATION_STATE_CONFLICT", "GENERATION_RESULT_NOT_READY"].includes(code);
}

function cleanText(value, name, maxLength, { required = false } = {}) {
  const normalized = String(value ?? "").trim().replace(/\s+/gu, " ");
  if (required && !normalized) throw new GenerationError(`INVALID_${name.toUpperCase()}`);
  if (normalized.length > maxLength) throw new GenerationError(`INVALID_${name.toUpperCase()}`);
  return normalized;
}

function cleanList(value, name, maxItems = 12) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new GenerationError(`INVALID_${name.toUpperCase()}`);
  }
  return value
    .map((item) => cleanText(item, name, 120))
    .filter(Boolean);
}

function cleanPalette(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw new GenerationError("INVALID_PALETTE");
  }
  return value.map((item) => {
    const color = cleanText(item, "palette", 32, { required: true });
    if (!/^#[0-9a-f]{6}$/iu.test(color) && !/^[\p{L}\p{N} ._-]+$/u.test(color)) {
      throw new GenerationError("INVALID_PALETTE");
    }
    return color;
  });
}

function preserveSettings(value = {}) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new GenerationError("INVALID_PRESERVE_SETTINGS");
  }
  const settings = {
    geometry: value.geometry ?? true,
    floors: value.floors ?? true,
    noNewFloors: value.noNewFloors ?? true,
    roof: value.roof ?? true,
    windows: value.windows ?? true,
    doors: value.doors ?? true,
    balconies: value.balconies ?? true,
    terraces: value.terraces ?? true,
    plot: value.plot ?? true,
    perspective: value.perspective ?? true,
    housePosition: value.housePosition ?? true,
  };
  for (const [key, item] of Object.entries(settings)) {
    if (typeof item !== "boolean") throw new GenerationError(`INVALID_PRESERVE_${key.toUpperCase()}`);
  }
  return settings;
}

export function normalizeGenerationInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GenerationError("INVALID_GENERATION_INPUT");
  }
  const mode = String(value.transformationLevel || value.mode || "gentle").trim().toLowerCase();
  if (!modeSet.has(mode)) throw new GenerationError("INVALID_TRANSFORMATION_LEVEL");
  const version = String(value.version || GENERATION_INPUT_VERSION);
  if (version !== GENERATION_INPUT_VERSION) throw new GenerationError("UNSUPPORTED_GENERATION_INPUT_VERSION");
  return Object.freeze({
    version,
    style: cleanText(value.style, "style", 100, { required: true }),
    materials: cleanList(value.materials, "materials"),
    palette: cleanPalette(value.palette),
    preserve: Object.freeze(preserveSettings(value.preserve)),
    transformationLevel: mode,
    wishes: cleanText(value.wishes, "wishes", 800),
    negativeConstraints: cleanList(value.negativeConstraints, "negative_constraints", 20),
  });
}

export function normalizeGenerationKind(value, { allowEdit = false } = {}) {
  const kind = String(value || "standard").trim().toLowerCase();
  if (!kindSet.has(kind) || kind === "edit" && !allowEdit) {
    throw new GenerationError("INVALID_GENERATION_KIND");
  }
  return kind;
}

export function normalizeGenerationEditInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GenerationError("INVALID_GENERATION_EDIT_INPUT");
  }
  const scope = String(value.scope || "").trim().toLowerCase();
  if (!editScopeSet.has(scope)) throw new GenerationError("INVALID_GENERATION_EDIT_SCOPE");
  const command = cleanText(value.command, "edit_command", 700, { required: true });
  const maskKey = cleanText(value.maskKey, "edit_mask_key", 500);
  if (scope === "custom_mask" && !maskKey) {
    throw new GenerationError("EDIT_MASK_REQUIRED");
  }
  if (scope !== "custom_mask" && maskKey) {
    throw new GenerationError("EDIT_MASK_NOT_ALLOWED");
  }
  return Object.freeze({ scope, command, maskKey: maskKey || null });
}

export function assertGenerationProvider(provider) {
  if (!provider || typeof provider.generate !== "function") {
    throw new TypeError("GenerationProvider.generate is required");
  }
  if (!provider.name || !provider.model) {
    throw new TypeError("GenerationProvider name and model are required");
  }
  if (provider.generationKinds != null && (
    !Array.isArray(provider.generationKinds)
    || provider.generationKinds.length === 0
    || provider.generationKinds.some((kind) => !kindSet.has(kind))
  )) {
    throw new TypeError("GenerationProvider.generationKinds is invalid");
  }
  if (provider.editScopes != null && (
    !Array.isArray(provider.editScopes)
    || provider.editScopes.length === 0
    || provider.editScopes.some((scope) => !editScopeSet.has(scope))
  )) {
    throw new TypeError("GenerationProvider.editScopes is invalid");
  }
  return provider;
}
