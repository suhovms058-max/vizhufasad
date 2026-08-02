import assert from "node:assert/strict";
import test from "node:test";
import { GenerationQualityOrchestrator } from "../src/generation-quality/orchestrator.mjs";
import { GenerationQualityError } from "../src/generation-quality/contract.mjs";

function observation(overrides = {}) {
  return {
    sameHouse: 0.96, floors: 0.95, roof: 0.94, windows: 0.93, doors: 0.92,
    balconiesTerraces: 0.91, position: 0.95, perspective: 0.94,
    artifacts: 0.92, style: 0.9, detectedChanges: [], summary: "Pass",
    ...overrides,
  };
}

const config = {
  primary: "primary", fallback: "none", primaryAttempts: 1,
  timeoutMs: 1000, retryDelayMs: 0,
  thresholds: {
    overall: 7600, sameHouse: 8500, protectedElement: 7000,
    contours: 6800, spatialLayout: 7000, protectedZones: 6800,
    artifacts: 7500, style: 6500,
  },
};

function orchestrator(vlm) {
  return new GenerationQualityOrchestrator({
    config,
    providers: {
      primary: { name: "primary", model: "mock", async compare() {
        return { observation: vlm, requestId: "request" };
      } },
    },
    structuralAnalyzer: async () => ({
      version: "test", contours: 9000, spatialLayout: 9000,
      protectedZones: 9000, zones: {}, edgeDensityDelta: 0,
    }),
  });
}

const request = {
  sourceImage: Buffer.from("source"), candidateImage: Buffer.from("candidate"),
  input: { style: "modern", materials: [], palette: [], wishes: "" },
  allowedChanges: {}, assessmentNumber: 1,
};

test("first good candidate passes", async () => {
  const result = await orchestrator(observation()).assess(request);
  assert.equal(result.decision, "passed");
  assert.ok(result.overallScore >= 7600);
});

test("gross roof change requests first retry and second rejection", async () => {
  const quality = orchestrator(observation({ roof: 0.2, detectedChanges: ["roof_changed"] }));
  const first = await quality.assess(request);
  const second = await quality.assess({ ...request, assessmentNumber: 2 });
  assert.equal(first.decision, "retry_required");
  assert.equal(second.decision, "rejected_refund");
  assert.ok(first.failureReasons.includes("roof_below_threshold"));
});

test("explicitly allowed roof change does not reject an otherwise good result", async () => {
  const result = await orchestrator(observation({ roof: 0.2 })).assess({
    ...request, allowedChanges: { roof: true },
  });
  assert.equal(result.decision, "passed");
});

test("bounded primary failure falls back automatically without a manual decision", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const quality = new GenerationQualityOrchestrator({
    config: { ...config, fallback: "fallback", primaryAttempts: 2 },
    providers: {
      primary: {
        name: "primary", model: "primary-model",
        async compare() {
          primaryCalls += 1;
          throw new GenerationQualityError("QUALITY_PROVIDER_BUSY", { retryable: true });
        },
      },
      fallback: {
        name: "fallback", model: "fallback-model",
        async compare() {
          fallbackCalls += 1;
          return { observation: observation(), requestId: "fallback-request" };
        },
      },
    },
    structuralAnalyzer: async () => ({
      version: "test", contours: 9000, spatialLayout: 9000,
      protectedZones: 9000, zones: {}, edgeDensityDelta: 0,
    }),
    wait: async () => {},
  });
  const result = await quality.assess(request);
  assert.equal(result.decision, "passed");
  assert.equal(result.provider, "fallback");
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 1);
});
