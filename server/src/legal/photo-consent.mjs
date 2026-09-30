export const PHOTO_PROCESSING_CONSENT_VERSION = "2026-08-22";
export const PHOTO_PROCESSING_CONSENT_PATH = "/legal/photo-processing-consent";

export function isCurrentPhotoConsent(value) {
  return value?.accepted === true && value?.version === PHOTO_PROCESSING_CONSENT_VERSION;
}
