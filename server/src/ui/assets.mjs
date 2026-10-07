export const APP_ASSET_VERSION = "20261007-redesign-recovery-1";

export function versionedAppAsset(path) {
  return `${path}?v=${APP_ASSET_VERSION}`;
}
