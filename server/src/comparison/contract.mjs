export class ComparisonError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function normalizeComparisonGenerationIds(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new ComparisonError("COMPARISON_REQUIRES_2_TO_4_RESULTS");
  }
  const ids = value.map((id) => String(id || "").trim());
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) {
    throw new ComparisonError("INVALID_GENERATION_ID");
  }
  if (new Set(ids).size !== ids.length) throw new ComparisonError("DUPLICATE_COMPARISON_RESULT");
  return ids;
}
