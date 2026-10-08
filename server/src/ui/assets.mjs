export const APP_ASSET_VERSION = "20261008-material-zone-polygons-1";

export function versionedAppAsset(path) {
  return `${path}?v=${APP_ASSET_VERSION}`;
}
