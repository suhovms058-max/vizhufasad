import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGenerationTransition, GenerationError, GENERATION_INPUT_VERSION,
  GENERATION_STATUSES, normalizeGenerationInput,
} from "../src/generation/contract.mjs";
import { loadGenerationConfig } from "../src/generation/config.mjs";
import { composeGenerationPrompt } from "../src/generation/prompt.mjs";

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
    plot: true,
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

test("generation input accepts explicit structural permission and rejects unknown modes", () => {
  const input = normalizeGenerationInput({
    style: "скандинавский",
    transformationLevel: "balanced",
    preserve: { roof: false },
  });
  assert.equal(input.preserve.roof, false);
  assert.match(composeGenerationPrompt(input).prompt, /explicitly allows changes to: roof shape/u);
  assert.throws(
    () => normalizeGenerationInput({ style: "лофт", transformationLevel: "extreme" }),
    (error) => error instanceof GenerationError && error.code === "INVALID_TRANSFORMATION_LEVEL",
  );
});

test("generation input models all Stage 10 preservation choices conservatively", () => {
  const input = normalizeGenerationInput({
    style: "автоподбор",
    preserve: { balconies: false, terraces: false, plot: false, floors: false },
  });
  assert.equal(input.preserve.balconies, false);
  assert.equal(input.preserve.terraces, false);
  assert.equal(input.preserve.plot, false);
  assert.equal(input.preserve.floors, false);
  assert.equal(input.preserve.noNewFloors, true);
  assert.match(composeGenerationPrompt(input).prompt, /Never add a new storey/u);
});

test("generation configuration is disabled by default and selects the measured candidate", () => {
  const config = loadGenerationConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.model, "nano-banana-2");
  assert.equal(config.estimatedCostMinor, 2500);
  assert.throws(
    () => loadGenerationConfig({ FEATURE_STANDARD_GENERATION_ENABLED: "true" }),
    (error) => error.code === "GENAPI_API_KEY_REQUIRED",
  );
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
