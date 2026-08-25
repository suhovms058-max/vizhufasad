import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGenerationTransition, GenerationError, GENERATION_INPUT_VERSION,
  GENERATION_STATUSES, normalizeGenerationInput,
} from "../src/generation/contract.mjs";
import { loadGenerationConfig } from "../src/generation/config.mjs";
import { composeGenerationPrompt } from "../src/generation/prompt.mjs";
import { createGenerationProviders } from "../src/generation/providers-factory.mjs";

test("generation input defaults to gentle and protects structure", () => {
  const input = normalizeGenerationInput({
    version: GENERATION_INPUT_VERSION,
    style: "современный минимализм",
    materials: ["штукатурка", "дерево"],
    palette: ["#EEE7DB", "#3B302A"],
    wishes: "подшить карниз деревом и отделать существующие колонны",
  });
  assert.equal(input.transformationLevel, "gentle");
  assert.deepEqual(input.preserve, {
    geometry: true,
    floors: true,
    noNewFloors: true,
    roof: true,
    windows: true,
    doors: true,
    balconies: true,
    terraces: true,
    plot: false,
    perspective: true,
    housePosition: true,
  });
  const composed = composeGenerationPrompt(input);
  assert.match(composed.prompt, /same real house/u);
  assert.match(composed.prompt, /STRICTLY PRESERVE/u);
  assert.match(composed.prompt, /number of storeys/u);
  assert.match(composed.prompt, /window count/u);
  assert.match(composed.prompt, /fully completed/u);
  assert.match(composed.prompt, /cornice\/eaves/u);
  assert.match(composed.prompt, /every already-existing column/u);
  assert.match(composed.prompt, /штукатурка, дерево/u);
  assert.match(composed.prompt, /#EEE7DB, #3B302A/u);
  assert.match(composed.prompt, /подшить карниз деревом/u);
  assert.match(composed.prompt, /automatically add realistic guardrails or handrails/u);
  assert.match(composed.prompt, /Do not invent a new balcony/u);
  assert.match(composed.prompt, /only permitted automatically inferred addition/u);
  assert.match(composed.prompt, /Automatically clean up the visible construction area/u);
  assert.match(composed.prompt, /inventory every visible original window and door/u);
  assert.match(composed.prompt, /Never add an opening to a blank wall/u);
});

test("quality retry strengthens the protected opening lock", () => {
  const input = normalizeGenerationInput({ style: "современный" });
  const composed = composeGenerationPrompt(input, {
    qualityRetryReasons: ["windows_count_mismatch"],
    qualityRetryObservation: {
      sourceWindowCount: 4,
      candidateWindowCount: 6,
      sourceDoorCount: 1,
      candidateDoorCount: 1,
    },
  });
  assert.match(composed.prompt, /RETRY OPENING LOCK/u);
  assert.match(composed.prompt, /extra, missing, moved, resized or duplicated opening/u);
  assert.doesNotMatch(composed.prompt, /MEASURED SOURCE INVENTORY/u);
});

test("generation state machine accepts only declared lifecycle transitions", () => {
  assert.deepEqual(GENERATION_STATUSES, [
    "created", "queued", "preprocessing", "generating", "quality_check_pending",
    "completed", "retrying", "failed_refunded", "cancelled",
  ]);
  assert.equal(assertGenerationTransition("queued", "preprocessing"), true);
  assert.equal(assertGenerationTransition("generating", "retrying"), true);
  assert.throws(
    () => assertGenerationTransition("completed", "generating"),
    (error) => error.code === "GENERATION_STATE_CONFLICT",
  );
});

test("generation input ignores client attempts to disable structural protection", () => {
  const input = normalizeGenerationInput({
    style: "скандинавский",
    transformationLevel: "balanced",
    preserve: { roof: false },
  });
  assert.equal(input.preserve.roof, true);
  assert.doesNotMatch(composeGenerationPrompt(input).prompt, /explicitly allows changes to: roof shape/u);
  assert.throws(
    () => normalizeGenerationInput({ style: "лофт", transformationLevel: "extreme" }),
    (error) => error instanceof GenerationError && error.code === "INVALID_TRANSFORMATION_LEVEL",
  );
});

test("generation input applies the fixed automated preservation policy", () => {
  const input = normalizeGenerationInput({
    style: "автоподбор",
    preserve: { balconies: false, terraces: false, plot: false, floors: false },
  });
  assert.equal(input.preserve.balconies, true);
  assert.equal(input.preserve.terraces, true);
  assert.equal(input.preserve.plot, false);
  assert.equal(input.preserve.floors, true);
  assert.equal(input.preserve.noNewFloors, true);
  assert.match(composeGenerationPrompt(input).prompt, /Never add a new storey/u);
});

test("generation configuration is disabled by default and selects the measured candidate", () => {
  const config = loadGenerationConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.proEnabled, false);
  assert.equal(config.model, "seedream-v5-pro");
  assert.equal(config.retryModel, "");
  assert.equal(config.estimatedCostMinor, 1688);
  const standardWithRetry = loadGenerationConfig({
    FEATURE_STANDARD_GENERATION_ENABLED: "true",
    GENAPI_API_KEY: "secret",
    GENAPI_STANDARD_MODEL: "seedream-v5-pro",
    GENAPI_STANDARD_RETRY_MODEL: "seedream-v5-pro",
    GENAPI_STANDARD_ESTIMATED_COST_MINOR: "1688",
    GENAPI_STANDARD_RETRY_ESTIMATED_COST_MINOR: "1688",
  });
  assert.deepEqual(
    createGenerationProviders(standardWithRetry).map((provider) => [
      provider.model, provider.candidateNumbers, provider.estimatedCostMinor,
    ]),
    [
      ["seedream-v5-pro", [1], 1688],
      ["seedream-v5-pro", [2], 1688],
    ],
  );
  assert.throws(
    () => loadGenerationConfig({ FEATURE_STANDARD_GENERATION_ENABLED: "true" }),
    (error) => error.code === "GENAPI_API_KEY_REQUIRED",
  );
  assert.throws(
    () => loadGenerationConfig({
      FEATURE_PRO_GENERATION_ENABLED: "true",
      GENAPI_API_KEY: "secret",
    }),
    (error) => error.code === "GENAPI_PRO_MODEL_REQUIRED",
  );
  assert.throws(
    () => loadGenerationConfig({
      FEATURE_PRO_GENERATION_ENABLED: "true",
      GENAPI_API_KEY: "secret",
      GENAPI_PRO_MODEL: "seedream-v5-pro",
    }),
    (error) => error.code === "GENAPI_PRO_MODEL_MUST_DIFFER",
  );
  const pro = loadGenerationConfig({
    FEATURE_PRO_GENERATION_ENABLED: "true",
    GENAPI_API_KEY: "secret",
    GENAPI_PRO_MODEL: "nano-banana-pro",
  });
  assert.equal(pro.proEnabled, true);
  assert.equal(pro.proModel, "nano-banana-pro");
  assert.equal(pro.proEstimatedCostMinor, 5000);
  const providers = createGenerationProviders(pro);
  assert.deepEqual(providers.map((provider) => [provider.model, provider.generationKinds]), [
    ["nano-banana-pro", ["pro"]],
  ]);
  assert.throws(
    () => loadGenerationConfig({
      FEATURE_GENERATION_EDITOR_ENABLED: "true",
      GENAPI_API_KEY: "secret",
    }),
    (error) => error.code === "GENAPI_EDIT_MODEL_REQUIRED",
  );
  const editor = loadGenerationConfig({
    FEATURE_GENERATION_EDITOR_ENABLED: "true",
    GENAPI_API_KEY: "secret",
    GENAPI_EDIT_MODEL: "qwen-image-edit-plus",
  });
  assert.equal(editor.maskEditModel, "bria-genfill");
  assert.deepEqual(createGenerationProviders(editor).map((provider) => [provider.model, provider.editScopes]), [
    ["qwen-image-edit-plus", ["full_facade", "walls", "plinth", "roof", "entrance"]],
    ["bria-genfill", ["custom_mask"]],
  ]);
  assert.throws(
    () => loadGenerationConfig({
      NODE_ENV: "production",
      GENERATION_STAGING_ENABLED: "true",
      GENERATION_STAGING_SECRET: "a".repeat(32),
    }),
    (error) => error.code === "GENERATION_STAGING_FORBIDDEN_IN_PRODUCTION",
  );
  assert.throws(
    () => loadGenerationConfig({ GENERATION_METRICS_TOKEN: "too-short" }),
    (error) => error.code === "GENERATION_METRICS_TOKEN_TOO_SHORT",
  );
});
