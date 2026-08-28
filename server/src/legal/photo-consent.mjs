import { createHash } from "node:crypto";
import { LEGAL_REVISION, legalDocument } from "./documents.mjs";

const document = legalDocument("photo-processing-consent");
export const PHOTO_PROCESSING_CONSENT_VERSION = document.revision;
export const PHOTO_PROCESSING_CONSENT_HASH = document.hash;
export const PHOTO_PROCESSING_CONSENT_PATH = "/legal/photo-processing-consent";
export const PHOTO_USAGE_RIGHTS_VERSION = LEGAL_REVISION;
export const PHOTO_USAGE_RIGHTS_HASH = createHash("sha256").update(`${LEGAL_REVISION}:Подтверждаю право использовать и передавать выбранную фотографию`).digest("hex");

export function isCurrentPhotoConsent(value) {
  return value?.accepted === true && value?.version === PHOTO_PROCESSING_CONSENT_VERSION
    && value?.hash === PHOTO_PROCESSING_CONSENT_HASH;
}

export function isCurrentPhotoRights(value) {
  return value?.accepted === true && value?.version === PHOTO_USAGE_RIGHTS_VERSION
    && value?.hash === PHOTO_USAGE_RIGHTS_HASH;
}
