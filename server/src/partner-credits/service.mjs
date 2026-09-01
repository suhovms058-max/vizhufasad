import { hashAuthValue, normalizeEmail } from "../auth/crypto.mjs";
import { createPartnerCode, PartnerCreditError, normalizePartnerCode } from "./contract.mjs";

function requiredKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9:_-]{12,160}$/u.test(key)) {
    throw new PartnerCreditError("PARTNER_IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

function requiredText(value, code, max) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new PartnerCreditError(code);
  return normalized;
}

function recipientEmail(value) {
  try { return normalizeEmail(value); }
  catch { throw new PartnerCreditError("PARTNER_EMAIL_INVALID"); }
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export class PartnerCreditService {
  constructor({ repository, hashSecret }) {
    this.repository = repository;
    this.hashSecret = hashSecret;
  }

  async redeem(userId, input = {}) {
    const code = normalizePartnerCode(input.code);
    const email = recipientEmail(await this.repository.userEmail(userId));
    return this.repository.redeem({
      userId,
      codeHash: hashAuthValue(this.hashSecret, "partner-credit-code", code),
      recipientEmailHash: hashAuthValue(this.hashSecret, "partner-recipient-email", email),
      idempotencyKey: requiredKey(input.idempotencyKey),
    });
  }

  register(input = {}) {
    const code = input.code ? normalizePartnerCode(input.code) : createPartnerCode();
    const credits = Number(input.credits);
    if (!Number.isSafeInteger(credits) || credits <= 0 || credits > 100_000) {
      throw new PartnerCreditError("PARTNER_CREDITS_INVALID");
    }
    let expiresAt = null;
    if (input.expiresAt) {
      expiresAt = new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
        throw new PartnerCreditError("PARTNER_EXPIRY_INVALID");
      }
    }
    const email = recipientEmail(input.recipientEmail);
    return this.repository.register({
      codeHash: hashAuthValue(this.hashSecret, "partner-credit-code", code),
      codeSuffix: code.slice(-4),
      credits,
      contractReference: requiredText(input.contractReference, "PARTNER_CONTRACT_REQUIRED", 160),
      partnerName: input.partnerName ? requiredText(input.partnerName, "PARTNER_NAME_INVALID", 240) : null,
      recipientEmailHash: hashAuthValue(this.hashSecret, "partner-recipient-email", email),
      recipientEmailMasked: maskEmail(email),
      expiresAt,
    }).then((registered) => ({ ...registered, issuedCode: code }));
  }
}
