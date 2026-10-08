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
  assert.match(composed.prompt, /EAVES COMPLETION — mandatory when unfinished/u);
  assert.match(composed.prompt, /UNOBSERVABLE ROOF RULE/u);
  assert.match(composed.prompt, /Never add a visible ridge, gable, hip, pitched roof/u);
  assert.match(composed.prompt, /continuous, buildable soffit lining/u);
  assert.match(composed.prompt, /exact original eave depth/u);
  assert.match(composed.prompt, /every already-existing column/u);
  assert.match(composed.prompt, /штукатурка, дерево/u);
  assert.match(composed.prompt, /#EEE7DB, #3B302A/u);
  assert.match(composed.prompt, /подшить карниз деревом/u);
  assert.match(composed.prompt, /automatically add realistic guardrails or handrails/u);
  assert.match(composed.prompt, /even when the unfinished source has no railing yet/u);
  assert.match(composed.prompt, /Do not invent a new balcony/u);
  assert.match(composed.prompt, /only permitted automatically inferred addition/u);
  assert.match(composed.prompt, /PROFESSIONAL LANDSCAPE DESIGN — mandatory/u);
  assert.match(composed.prompt, /clean pedestrian paths to every visible entrance/u);
  assert.match(composed.prompt, /practical driveway or parking surface where vehicle access already exists/u);
  assert.match(composed.prompt, /Never hide the facade, doors, windows, plinth, stairs or material transitions/u);
  assert.match(composed.prompt, /Do not invent a pool, gazebo, pergola, fountain/u);
  assert.match(composed.prompt, /inventory every visible original window and door/u);
  assert.match(composed.prompt, /Never add an opening to a blank wall/u);
  assert.match(composed.prompt, /RAW-SURFACE REPLACEMENT/u);
  assert.match(composed.prompt, /completely hide raw block joints/u);
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

test("localized editor keeps the existing landscape outside the edit boundary", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["камень"],
  });
  const prompt = composeGenerationPrompt(input, {
    edit: { scope: "plinth", command: "заменить отделку цоколя" },
  }).prompt;
  assert.match(prompt, /Keep the original environment, season, lighting direction and camera optics unchanged/u);
  assert.doesNotMatch(prompt, /PROFESSIONAL LANDSCAPE DESIGN/u);
});

test("automatic material selection requires a visible finished facade system", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    transformationLevel: "balanced",
    materials: ["автоподбор"],
  });
  const prompt = composeGenerationPrompt(input).prompt;
  assert.match(prompt, /AUTOMATIC MATERIAL SYSTEM/u);
  assert.match(prompt, /ROOF SILHOUETTE LOCK/u);
  assert.match(prompt, /merely repaints the existing wall color/u);
  assert.doesNotMatch(prompt, /Required finish materials: автоподбор/u);
});

test("combined finish requires a dominant continuous wall finish", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["комбинированная"],
  });
  const prompt = composeGenerationPrompt(input, {
    qualityRetryReasons: ["finish_below_threshold", "unfinished_facade_detected"],
  }).prompt;
  assert.match(prompt, /COMBINED FACADE SYSTEM/u);
  assert.match(prompt, /primary finish must visually dominate/u);
  assert.match(prompt, /RETRY FINISH AND MATERIAL LOCK/u);
});

test("explicit materials receive an architectural zoning plan instead of patchwork", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["панели", "металл"],
  });
  const prompt = composeGenerationPrompt(input).prompt;
  assert.match(prompt, /ARCHITECTURAL MATERIAL ZONING/u);
  assert.match(prompt, /one continuous dominant material/u);
  assert.match(prompt, /one connected architectural zone/u);
  assert.match(prompt, /Do not scatter any material as isolated patches/u);
  assert.match(prompt, /roughly 60–85%/u);
  assert.match(prompt, /Never substitute generic smooth plaster/u);
  assert.match(prompt, /EXPLICIT MATERIAL CONTRACT/u);
  assert.match(prompt, /all 2 client-selected materials/u);
  assert.match(prompt, /UNSELECTED PLASTER BAN/u);
  assert.match(prompt, /Metal used only for railings/u);
});

test("client material zones are normalized and become binding spatial instructions", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["штукатурка", "камень", "дерево"],
    materialZones: [
      { material: "камень", polygons: [[{ x: 0.12, y: 0.72 }, { x: 0.62, y: 0.72 }, { x: 0.62, y: 0.86 }, { x: 0.12, y: 0.86 }]] },
      { material: "дерево", polygons: [[{ x: 0.68, y: 0.31 }, { x: 0.82, y: 0.31 }, { x: 0.82, y: 0.48 }, { x: 0.68, y: 0.48 }]] },
    ],
  });
  assert.equal(input.materialZones.length, 2);
  assert.equal(input.materialZones[0].color, "#FF6B35");
  assert.equal(input.materialZones[1].color, "#00B8D9");
  const prompt = composeGenerationPrompt(input).prompt;
  assert.match(prompt, /CLIENT MATERIAL ZONE MAP/u);
  assert.match(prompt, /#FF6B35: камень/u);
  assert.match(prompt, /#00B8D9: дерево/u);
  assert.match(prompt, /complete real architectural surface inside its polygon/u);
  assert.match(prompt, /takes priority over automatic material allocation/u);
});

test("material zones reject unselected, automatic, duplicate and invalid coordinates", () => {
  const base = { style: "современный", materials: ["камень", "дерево"] };
  assert.throws(
    () => normalizeGenerationInput({ ...base, materialZones: [{ material: "металл", brushSize: 0.04, strokes: [[{ x: 0.5, y: 0.5 }]] }] }),
    (error) => error.code === "INVALID_MATERIAL_ZONE_MATERIAL",
  );
  assert.throws(
    () => normalizeGenerationInput({ style: "современный", materials: ["автоподбор"], materialZones: [{ material: "автоподбор", brushSize: 0.04, strokes: [[{ x: 0.5, y: 0.5 }]] }] }),
    (error) => error.code === "INVALID_MATERIAL_ZONE_MATERIAL",
  );
  assert.throws(
    () => normalizeGenerationInput({ ...base, materialZones: [
      { material: "камень", brushSize: 0.04, strokes: [[{ x: 0.5, y: 0.5 }]] },
      { material: "камень", brushSize: 0.04, strokes: [[{ x: 0.6, y: 0.6 }]] },
    ] }),
    (error) => error.code === "INVALID_MATERIAL_ZONE_MATERIAL",
  );
  assert.throws(
    () => normalizeGenerationInput({ ...base, materialZones: [{ material: "камень", brushSize: 0.04, strokes: [[{ x: 1.2, y: 0.5 }]] }] }),
    (error) => error.code === "INVALID_MATERIAL_ZONE_POINT",
  );
});

test("named PHOMI is required as a visible material rather than a color hint", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["PHOMI — Rome Travertine", "дерево", "металл"],
  });
  const prompt = composeGenerationPrompt(input, { qualityRetryReasons: ["finish_below_threshold"] }).prompt;
  assert.match(prompt, /NAMED PHOMI PRIORITY/u);
  assert.match(prompt, /Never replace it with smooth plaster/u);
  assert.match(prompt, /RETRY FINISH AND MATERIAL LOCK/u);
  assert.match(prompt, /PHOMI — Rome Travertine, дерево, металл/u);
});

test("more than three selected materials are reduced to a coherent maximum of three", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["штукатурка", "камень", "дерево", "металл"],
  });
  const prompt = composeGenerationPrompt(input).prompt;
  assert.match(prompt, /selected 4 materials/u);
  assert.match(prompt, /Choose the three most architecturally compatible materials/u);
  assert.match(prompt, /do not force every option into the image/u);
});

test("PHOMI automatic texture selection receives a specific generator instruction", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["гибкая керамика PHOMI", "PHOMI — автоподбор фактуры ИИ"],
  });
  const prompt = composeGenerationPrompt(input).prompt;
  assert.match(prompt, /PHOMI TEXTURE AUTO-SELECTION/u);
  assert.match(prompt, /stone, travertine, concrete or wood texture families/u);
  assert.doesNotMatch(prompt, /Other required finish materials: гибкая керамика PHOMI/u);
  assert.doesNotMatch(prompt, /Required finish materials: .*автоподбор фактуры ИИ/u);
});

test("PHOMI automatic texture selection ignores the generic automatic material marker", () => {
  const input = normalizeGenerationInput({
    style: "современный",
    materials: ["гибкая керамика PHOMI", "PHOMI — автоподбор фактуры ИИ", "автоподбор"],
  });
  const prompt = composeGenerationPrompt(input).prompt;
  assert.match(prompt, /PHOMI TEXTURE AUTO-SELECTION/u);
  assert.doesNotMatch(prompt, /Other required finish materials: автоподбор/u);
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
  const pro = loadGenerationConfig({
    FEATURE_PRO_GENERATION_ENABLED: "true",
    GENAPI_API_KEY: "secret",
    GENAPI_PRO_MODEL: "seedream-v5-pro",
  });
  assert.equal(pro.proEnabled, true);
  assert.equal(pro.proModel, "seedream-v5-pro");
  assert.equal(pro.proEstimatedCostMinor, 1688);
  const providers = createGenerationProviders(pro);
  assert.deepEqual(providers.map((provider) => [provider.model, provider.generationKinds]), [
    ["seedream-v5-pro", ["pro"]],
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
