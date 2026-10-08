export const GENERATION_MODES = Object.freeze(["gentle", "balanced", "conceptual"]);
export const GENERATION_KINDS = Object.freeze(["standard", "pro", "edit"]);
export const GENERATION_EDIT_SCOPES = Object.freeze([
  "full_facade", "walls", "plinth", "roof", "entrance", "custom_mask",
]);
export const GENERATION_PROMPT_VERSION = "standard-facade-v16";
export const GENERATION_INPUT_VERSION = "1";
export const MATERIAL_ZONE_COLORS = Object.freeze([
  "#FF6B35", "#00B8D9", "#8B5CF6", "#22C55E",
]);
export const SYSTEM_PRESERVE_POLICY = Object.freeze({
  geometry: true,
  floors: true,
  noNewFloors: true,
  roof: true,
  windows: true,
  doors: true,
  balconies: true,
  terraces: true,
  plot: false,
  perspective: true,
  housePosition: true,
});
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

function cleanMaterialZones(value, materials) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MATERIAL_ZONE_COLORS.length) {
    throw new GenerationError("INVALID_MATERIAL_ZONES");
  }
  const selected = new Set(materials);
  let totalPoints = 0;
  const seenMaterials = new Set();
  return value.map((zone, zoneIndex) => {
    if (!zone || typeof zone !== "object" || Array.isArray(zone)) {
      throw new GenerationError("INVALID_MATERIAL_ZONES");
    }
    const material = cleanText(zone.material, "material_zone", 120, { required: true });
    if (!selected.has(material) || /^(автоподбор|auto|комбинированная|combined)$/iu.test(material)
      || seenMaterials.has(material)) {
      throw new GenerationError("INVALID_MATERIAL_ZONE_MATERIAL");
    }
    seenMaterials.add(material);
    const polygonsInput = Array.isArray(zone.polygons) ? zone.polygons : [];
    const strokesInput = Array.isArray(zone.strokes) ? zone.strokes : [];
    if (!polygonsInput.length && !strokesInput.length) throw new GenerationError("INVALID_MATERIAL_ZONE_POLYGONS");
    if (polygonsInput.length > 24 || strokesInput.length > 80) throw new GenerationError("INVALID_MATERIAL_ZONE_POLYGONS");
    const cleanPoints = (shape, minimum, maximum, errorCode) => {
      if (!Array.isArray(shape) || shape.length < minimum || shape.length > maximum) {
        throw new GenerationError(errorCode);
      }
      totalPoints += shape.length;
      if (totalPoints > 6_000) throw new GenerationError(errorCode);
      return Object.freeze(shape.map((point) => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
          throw new GenerationError("INVALID_MATERIAL_ZONE_POINT");
        }
        return Object.freeze({ x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 });
      }));
    };
    const polygons = polygonsInput.map((polygon) => cleanPoints(polygon, 3, 32, "INVALID_MATERIAL_ZONE_POLYGONS"));
    const strokes = strokesInput.map((stroke) => cleanPoints(stroke, 1, 240, "INVALID_MATERIAL_ZONE_STROKES"));
    const brushSize = strokes.length ? Number(zone.brushSize) : 0.02;
    if (strokes.length && (!Number.isFinite(brushSize) || brushSize < 0.008 || brushSize > 0.2)) {
      throw new GenerationError("INVALID_MATERIAL_ZONE_BRUSH");
    }
    return Object.freeze({
      material,
      color: MATERIAL_ZONE_COLORS[zoneIndex],
      brushSize: Math.round(brushSize * 10_000) / 10_000,
      polygons: Object.freeze(polygons),
      strokes: Object.freeze(strokes),
    });
  });
}

function preserveSettings() {
  return { ...SYSTEM_PRESERVE_POLICY };
}

export function normalizeGenerationInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GenerationError("INVALID_GENERATION_INPUT");
  }
  const mode = String(value.transformationLevel || value.mode || "gentle").trim().toLowerCase();
  if (!modeSet.has(mode)) throw new GenerationError("INVALID_TRANSFORMATION_LEVEL");
  const version = String(value.version || GENERATION_INPUT_VERSION);
  if (version !== GENERATION_INPUT_VERSION) throw new GenerationError("UNSUPPORTED_GENERATION_INPUT_VERSION");
  const materials = cleanList(value.materials, "materials");
  return Object.freeze({
    version,
    style: cleanText(value.style, "style", 100, { required: true }),
    materials,
    materialZones: Object.freeze(cleanMaterialZones(value.materialZones, materials)),
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
