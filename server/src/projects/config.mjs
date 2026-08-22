import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MIN_WIDTH = 640;
export const MIN_HEIGHT = 420;
export const RECOMMENDED_WIDTH = 1200;
export const RECOMMENDED_HEIGHT = 800;
export const MAX_INPUT_PIXELS = 80_000_000;

export const STANDARD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
export const HEIF_MIME_TYPES = new Set(["image/heic", "image/heif"]);

export function hasReliableHeifDecoder() {
  return sharp.format?.heif?.input?.buffer === true;
}

export function allowedUploadMimeTypes() {
  const values = [...STANDARD_MIME_TYPES];
  if (hasReliableHeifDecoder()) values.push(...HEIF_MIME_TYPES);
  return values;
}

export function loadProjectConfig(environment = process.env) {
  const uploadTtlSeconds = Number(environment.S3_UPLOAD_URL_TTL_SECONDS || 600);
  const unfinishedHours = Number(environment.IMAGE_UPLOAD_CLEANUP_HOURS || 24);
  const deletedRetentionDays = Number(environment.PROJECT_DELETION_RETENTION_DAYS || 30);
  if (!Number.isInteger(uploadTtlSeconds) || uploadTtlSeconds < 60 || uploadTtlSeconds > 900) {
    throw new Error("S3_UPLOAD_URL_TTL_SECONDS must be an integer between 60 and 900");
  }
  if (!Number.isFinite(unfinishedHours) || unfinishedHours < 1) {
    throw new Error("IMAGE_UPLOAD_CLEANUP_HOURS must be at least 1");
  }
  if (!Number.isFinite(deletedRetentionDays) || deletedRetentionDays < 1) {
    throw new Error("PROJECT_DELETION_RETENTION_DAYS must be at least 1");
  }
  return { uploadTtlSeconds, unfinishedHours, deletedRetentionDays };
}
