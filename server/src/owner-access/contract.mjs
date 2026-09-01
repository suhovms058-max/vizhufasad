const PACKAGE_CODES = new Set(["START", "OPTIMUM", "MAXIMUM"]);

export class OwnerAccessError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function normalizeOwnerCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^VF-OWNER-[A-Z0-9]{16,32}$/u.test(normalized)) {
    throw new OwnerAccessError("OWNER_CODE_INVALID");
  }
  return normalized;
}

export function normalizePackageCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!PACKAGE_CODES.has(normalized)) throw new OwnerAccessError("OWNER_PACKAGE_INVALID");
  return normalized;
}
