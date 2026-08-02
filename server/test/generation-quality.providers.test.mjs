import assert from "node:assert/strict";
import test from "node:test";
import { YandexGenerationQualityProvider } from "../src/generation-quality/providers.mjs";

const observation = {
  sameHouse: 0.95, floors: 0.98, roof: 0.9, windows: 0.91, doors: 0.92,
  balconiesTerraces: 0.93, position: 0.97, perspective: 0.96,
  artifacts: 0.88, style: 0.85, detectedChanges: [], summary: "Same house",
};

test("Yandex provider sends two images and strict JSON schema without leaking keys", async () => {
  let captured;
  const provider = new YandexGenerationQualityProvider({
    apiKey: "secret-key", folderId: "folder", model: "vision-model",
    fetchImplementation: async (_url, options) => {
      captured = options;
      return {
        ok: true,
        headers: new Headers(),
        async json() { return { id: "response-1", output_text: JSON.stringify(observation) }; },
      };
    },
  });
  const result = await provider.compare({
    sourceImage: Buffer.from("source"), candidateImage: Buffer.from("candidate"),
    prompt: "compare", signal: AbortSignal.timeout(1000),
  });
  const body = JSON.parse(captured.body);
  assert.equal(body.input[0].content.filter((item) => item.type === "input_image").length, 2);
  assert.equal(body.text.format.strict, true);
  assert.equal(captured.headers.Authorization, "Api-Key secret-key");
  assert.equal(JSON.stringify(body).includes("secret-key"), false);
  assert.equal(result.requestId, "response-1");
});
