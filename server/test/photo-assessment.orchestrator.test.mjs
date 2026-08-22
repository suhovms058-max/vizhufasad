import assert from "node:assert/strict";
import test from "node:test";
import { loadPhotoAssessmentConfig } from "../src/photo-assessment/config.mjs";
import { PhotoAssessmentOrchestrator } from "../src/photo-assessment/orchestrator.mjs";
import { PhotoAssessmentProviderError } from "../src/photo-assessment/providers.mjs";

const technical = {
  width: 1600, height: 1000, format: "jpeg", entropy: 6, sharpness: 3,
  luminance: 120, recommendedResolution: true, warnings: [], blocking: [],
};
const observation = {
  scene: "facade",
  houseVisible: true,
  facadeVisible: true,
  frameCompleteness: "complete",
  geometry: "good",
  obstruction: "none",
  perspective: "good",
  sharpness: "good",
  lighting: "good",
  roofCrop: "none",
  confidence: 0.95,
  issueCodes: [],
};
const config = {
  primary: "yandex",
  fallback: "openai",
  primaryAttempts: 2,
  timeoutMs: 1_000,
  retryDelayMs: 0,
};

test("transient primary failures are bounded and fallback succeeds", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const recorded = [];
  const orchestrator = new PhotoAssessmentOrchestrator({
    config,
    providers: {
      yandex: {
        name: "yandex",
        model: "primary-model",
        async assess() {
          primaryCalls += 1;
          throw new PhotoAssessmentProviderError("YANDEX_HTTP_503", { retryable: true });
        },
      },
      openai: {
        name: "openai",
        model: "fallback-model",
        async assess() {
          fallbackCalls += 1;
          return { observation, requestId: "fallback-request" };
        },
      },
    },
    recorder: {
      async started(attempt) { recorded.push(["started", attempt.provider]); },
      async finished(attempt) { recorded.push([attempt.status, attempt.provider]); },
    },
  });

  const result = await orchestrator.assess({ image: Buffer.from("image"), technical });
  assert.equal(result.decision, "accepted");
  assert.equal(result.provider, "openai");
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(recorded.map(([status]) => status), [
    "started", "retryable_failed", "started", "retryable_failed", "started", "succeeded",
  ]);
});

test("invalid structured output is retried and never creates a fourth decision", async () => {
  let calls = 0;
  const orchestrator = new PhotoAssessmentOrchestrator({
    config: { ...config, fallback: "none" },
    providers: {
      yandex: {
        name: "yandex",
        model: "model",
        async assess() {
          calls += 1;
          return calls === 1
            ? { observation: { ...observation, decision: "manual_review" } }
            : { observation };
        },
      },
    },
  });
  const result = await orchestrator.assess({ image: Buffer.from("image"), technical });
  assert.equal(calls, 2);
  assert.equal(result.decision, "accepted");
});

test("provider config selects a distinct fallback and ignores the deprecated AI_PROVIDER", () => {
  const loaded = loadPhotoAssessmentConfig({
    NODE_ENV: "development",
    AI_PROVIDER: "invalid-legacy-value",
    YANDEX_API_KEY: "configured",
    YANDEX_FOLDER_ID: "folder",
    OPENAI_API_KEY: "configured",
  });
  assert.equal(loaded.primary, "yandex");
  assert.equal(loaded.fallback, "openai");
});

test("production refuses to start without an automatic assessment provider", () => {
  assert.throws(
    () => loadPhotoAssessmentConfig({ NODE_ENV: "production" }),
    /provider is required in production/,
  );
});
