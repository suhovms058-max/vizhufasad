export const APP_ASSET_VERSION = "20261005-mobile-1";

export function versionedAppAsset(path) {
  return `${path}?v=${APP_ASSET_VERSION}`;
}
