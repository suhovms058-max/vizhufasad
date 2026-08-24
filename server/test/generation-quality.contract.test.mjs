import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedQualityChanges, assertGenerationQualityProvider,
  qualityDecisionForAttempt, VLM_QUALITY_RESULT_SCHEMA,
} from "../src/generation-quality/contract.mjs";
import { loadGenerationQualityConfig } from "../src/generation-quality/config.mjs";

test("quality decision permits one retry and rejects the second failure", () => {
  assert.equal(qualityDecisionForAttempt(true, 1), "passed");
  assert.equal(qualityDecisionForAttempt(false, 1), "retry_required");
  assert.equal(qualityDecisionForAttempt(false, 2), "rejected_refund");
});

test("allowed changes are derived only from explicit preserve opt-outs", () => {
  assert.deepEqual(allowedQualityChanges({ preserve: { roof: false, windows: true } }), {
    floors: false,
    roof: true,
    windows: false,
    doors: false,
    perspective: false,
    position: false,
    balconiesTerraces: false,
  });
});

test("provider contract and VLM schema are strict", () => {
  assert.throws(() => assertGenerationQualityProvider({}), /compare is required/);
  assert.equal(VLM_QUALITY_RESULT_SCHEMA.additionalProperties, false);
  assert.ok(VLM_QUALITY_RESULT_SCHEMA.required.includes("sameHouse"));
  assert.ok(VLM_QUALITY_RESULT_SCHEMA.required.includes("sourceWindowCount"));
  assert.ok(VLM_QUALITY_RESULT_SCHEMA.required.includes("candidateWindowCount"));
});

test("quality config selects Yandex first and fails closed for enabled generation", () => {
  const config = loadGenerationQualityConfig({
    FEATURE_STANDARD_GENERATION_ENABLED: "true",
    YANDEX_API_KEY: "key",
    YANDEX_FOLDER_ID: "folder",
  });
  assert.equal(config.primary, "yandex");
  assert.equal(config.thresholds.sameHouse, 8500);
  assert.throws(
    () => loadGenerationQualityConfig({ FEATURE_STANDARD_GENERATION_ENABLED: "true" }),
    /GENERATION_QUALITY_REQUIRED/,
  );
});
