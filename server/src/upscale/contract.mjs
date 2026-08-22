export const UPSCALE_STATUSES = Object.freeze([
  "created", "queued", "processing", "completed", "failed_refunded", "cancelled",
]);

export class UpscaleError extends Error {
  constructor(code, status = 400, { retryable = false, details = null } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function assertUpscaleProvider(provider) {
  if (!provider || typeof provider.upscale !== "function" || !provider.name || !provider.model) {
    throw new TypeError("UpscaleProvider.upscale, name and model are required");
  }
  return provider;
}

export function isActual4k(width, height) {
  const w = Number(width);
  const h = Number(height);
  return Number.isInteger(w) && Number.isInteger(h)
    && ((w >= 3840 && h >= 2160) || (w >= 2160 && h >= 3840));
}
