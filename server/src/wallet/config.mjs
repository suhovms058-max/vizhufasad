function flag(value, fallback, name) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadWalletConfig(environment = process.env) {
  const config = {
    walletEnabled: flag(environment.FEATURE_WALLET_ENABLED, true, "FEATURE_WALLET_ENABLED"),
    tariffCatalogEnabled: flag(
      environment.FEATURE_TARIFF_CATALOG_ENABLED,
      true,
      "FEATURE_TARIFF_CATALOG_ENABLED",
    ),
    freeBonusEnabled: flag(
      environment.FEATURE_FREE_BONUS_ENABLED,
      true,
      "FEATURE_FREE_BONUS_ENABLED",
    ),
    paymentsEnabled: flag(
      environment.FEATURE_PAYMENTS_ENABLED,
      false,
      "FEATURE_PAYMENTS_ENABLED",
    ),
    freeBonusCredits: 1,
  };
  return config;
}
