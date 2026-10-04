import assert from "node:assert/strict";
import test from "node:test";
import { loadGenerationQualityConfig } from "../src/generation-quality/config.mjs";

test("auto routing prefers the region-compatible GenAPI vision provider over OpenAI", () => {
  const config = loadGenerationQualityConfig({
    FEATURE_STANDARD_GENERATION_ENABLED: "true",
    GENAPI_API_KEY: "genapi-key",
    OPENAI_API_KEY: "openai-key",
  });
  assert.equal(config.primary, "genapi");
  assert.equal(config.fallback, "openai");
  assert.equal(config.models.genapi, "gpt-4o-mini");
});

test("explicit Yandex primary keeps GenAPI as automatic fallback", () => {
  const config = loadGenerationQualityConfig({
    FEATURE_STANDARD_GENERATION_ENABLED: "true",
    YANDEX_API_KEY: "yandex-key",
    YANDEX_FOLDER_ID: "folder",
    GENAPI_API_KEY: "genapi-key",
    GENERATION_QUALITY_PRIMARY_PROVIDER: "yandex",
  });
  assert.equal(config.primary, "yandex");
  assert.equal(config.fallback, "genapi");
});
