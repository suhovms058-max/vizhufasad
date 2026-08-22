export class PaymentError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function formatRubles(amountMinor) {
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError("INVALID_AMOUNT");
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

export function parseRubles(value) {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(String(value || ""))) {
    throw new PaymentError("INVALID_PROVIDER_AMOUNT", 400);
  }
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new PaymentError("INVALID_PROVIDER_AMOUNT");
  return minor;
}

export function normalizePromoCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-ZА-ЯЁ0-9_-]{3,32}$/u.test(normalized)) throw new PaymentError("INVALID_PROMO_CODE");
  return normalized;
}
