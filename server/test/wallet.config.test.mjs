import assert from "node:assert/strict";
import test from "node:test";
import { loadWalletConfig } from "../src/wallet/config.mjs";

test("wallet feature flags default to the safe stage 6 configuration", () => {
  assert.deepEqual(loadWalletConfig({}), {
    walletEnabled: true,
    tariffCatalogEnabled: true,
    freeBonusEnabled: true,
    paymentsEnabled: false,
    freeBonusCredits: 2,
  });
});

test("payments cannot be exposed before a provider exists", () => {
  assert.throws(
    () => loadWalletConfig({ FEATURE_PAYMENTS_ENABLED: "true" }),
    /cannot be enabled before a payment provider exists/,
  );
});

test("feature flag values are strict booleans", () => {
  assert.throws(
    () => loadWalletConfig({ FEATURE_WALLET_ENABLED: "sometimes" }),
    /must be true or false/,
  );
});
