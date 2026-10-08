import assert from "node:assert/strict";
import test from "node:test";
import {
  GenApiGenerationQualityProvider, YandexGenerationQualityProvider,
} from "../src/generation-quality/providers.mjs";

const observation = {
  sameHouse: 0.95, floors: 0.98, roof: 0.9, windows: 0.91, doors: 0.92,
  balconiesTerraces: 0.93, entranceGroup: 0.94, position: 0.97, perspective: 0.96,
  sourceWindowCount: 3, candidateWindowCount: 3,
  sourceDoorCount: 1, candidateDoorCount: 1,
  artifacts: 0.88, style: 0.85, finish: 0.9,
  sourceRoofVisibility: "fully_visible", candidateIntroducedRoofVolume: false,
  detectedChanges: [], summary: "Same house",
};

test("Yandex provider sends two images and strict JSON schema without leaking keys", async () => {
  let captured;
  let capturedUrl;
  const provider = new YandexGenerationQualityProvider({
    apiKey: "secret-key", folderId: "folder", model: "vision-model",
    fetchImplementation: async (url, options) => {
      capturedUrl = url;
      captured = options;
      return {
        ok: true,
        headers: new Headers(),
        async json() {
          return {
            id: "response-1",
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(observation) } }],
          };
        },
      };
    },
  });
  const result = await provider.compare({
    sourceImage: Buffer.from("source"), candidateImage: Buffer.from("candidate"),
    prompt: "compare", signal: AbortSignal.timeout(1000),
  });
  const body = JSON.parse(captured.body);
  assert.equal(capturedUrl, "https://ai.api.cloud.yandex.net/v1/chat/completions");
  assert.equal(body.messages[0].content.filter((item) => item.type === "image_url").length, 2);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.model, "gpt://folder/vision-model");
  assert.equal(captured.headers.Authorization, "Api-Key secret-key");
  assert.equal(JSON.stringify(body).includes("secret-key"), false);
  assert.equal(result.requestId, "response-1");
});

test("GenAPI provider uses its regional proxy and multimodal chat format", async () => {
  let captured;
  let capturedUrl;
  const provider = new GenApiGenerationQualityProvider({
    apiKey: "genapi-secret", model: "gpt-4o-mini",
    fetchImplementation: async (url, options) => {
      capturedUrl = url;
      captured = options;
      return {
        ok: true,
        headers: new Headers(),
        async json() {
          return {
            id: "genapi-response-1",
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(observation) } }],
          };
        },
      };
    },
  });
  const result = await provider.compare({
    sourceImage: Buffer.from("source"), candidateImage: Buffer.from("candidate"),
    prompt: "compare", signal: AbortSignal.timeout(1000),
  });
  const body = JSON.parse(captured.body);
  assert.equal(capturedUrl, "https://proxy.gen-api.ru/v1/chat/completions");
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.max_tokens, 2_000);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.response_format.type, "json_object");
  assert.match(body.messages[0].content[0].text, /Return JSON strictly matching/u);
  assert.equal(body.messages[0].content.filter((item) => item.type === "image_url").length, 2);
  assert.equal(captured.headers.Authorization, "Bearer genapi-secret");
  assert.equal(JSON.stringify(body).includes("genapi-secret"), false);
  assert.equal(result.requestId, "genapi-response-1");
});

test("quality provider includes the annotated zone map as a third image", async () => {
  let captured;
  const provider = new GenApiGenerationQualityProvider({
    apiKey: "genapi-secret", model: "gpt-4o-mini",
    fetchImplementation: async (_url, options) => {
      captured = options;
      return {
        ok: true, headers: new Headers(),
        async json() {
          return { id: "zone-response", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(observation) } }] };
        },
      };
    },
  });
  await provider.compare({
    sourceImage: Buffer.from("source"), candidateImage: Buffer.from("candidate"),
    controlImage: Buffer.from("zone-map"), prompt: "compare", signal: AbortSignal.timeout(1000),
  });
  const content = JSON.parse(captured.body).messages[0].content;
  assert.equal(content.filter((item) => item.type === "image_url").length, 3);
  assert.ok(content.some((item) => item.type === "text" && /annotated control reference/u.test(item.text)));
});
