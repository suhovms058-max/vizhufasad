export class PartnerCreditError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function normalizePartnerCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^VF-P-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u.test(normalized)) {
    throw new PartnerCreditError("PARTNER_CODE_INVALID");
  }
  return normalized;
}

export function createPartnerCode() {
  let body = "";
  while (body.length < 12) body += ALPHABET[randomInt(0, ALPHABET.length)];
  return `VF-P-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}
import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
