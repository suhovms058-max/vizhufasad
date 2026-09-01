import { hashAuthValue } from "../auth/crypto.mjs";
import { OwnerAccessError, normalizeOwnerCode, normalizePackageCode } from "./contract.mjs";

function requiredKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9:_-]{12,160}$/u.test(key)) {
    throw new OwnerAccessError("OWNER_IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

export class OwnerAccessService {
  constructor({ repository, hashSecret }) {
    this.repository = repository;
    this.hashSecret = hashSecret;
  }

  status(userId) { return this.repository.status(userId); }

  redeem(userId, input = {}) {
    const code = normalizeOwnerCode(input.code);
    return this.repository.redeem({
      userId,
      codeHash: hashAuthValue(this.hashSecret, "owner-access-code", code),
      packageCode: normalizePackageCode(input.packageCode),
      idempotencyKey: requiredKey(input.idempotencyKey),
    });
  }
}
