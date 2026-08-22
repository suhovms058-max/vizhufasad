import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAiPhotoAssessmentProvider, YandexPhotoAssessmentProvider,
} from "../src/photo-assessment/providers.mjs";

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

function fakeFetch(assertRequest) {
  return async (url, options) => {
    assertRequest(url, options, JSON.parse(options.body));
    return new Response(JSON.stringify({
      id: "response-1",
      output: [{ content: [{ type: "output_text", text: JSON.stringify(observation) }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("OpenAI provider sends image input and strict JSON schema to Responses API", async () => {
  const provider = new OpenAiPhotoAssessmentProvider({
    apiKey: "test-key",
    model: "test-model",
    fetchImplementation: fakeFetch((url, options, body) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.equal(body.input[0].content[1].type, "input_image");
      assert.match(body.input[0].content[1].image_url, /^data:image\/jpeg;base64,/u);
    }),
  });
  assert.deepEqual((await provider.assess({ image: Buffer.from("image") })).observation, observation);
});

test("Yandex provider uses multimodal Chat Completions without exposing credentials", async () => {
  const provider = new YandexPhotoAssessmentProvider({
    apiKey: "test-yandex-key",
    folderId: "folder",
    model: "vision-model",
    fetchImplementation: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, "https://ai.api.cloud.yandex.net/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Api-Key test-yandex-key");
      assert.equal(options.headers["OpenAI-Project"], "folder");
      assert.equal(body.model, "gpt://folder/vision-model");
      assert.equal(body.reasoning_effort, "none");
      assert.equal(body.response_format.type, "json_schema");
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.response_format.json_schema.schema.properties.issueCodes.uniqueItems, undefined);
      assert.equal(body.messages[0].content[1].type, "image_url");
      return new Response(JSON.stringify({
        id: "chat-1",
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify(observation) },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual((await provider.assess({ image: Buffer.from("image") })).observation, observation);
});

test("Yandex provider reports an unfinished chat completion as retryable", async () => {
  const provider = new YandexPhotoAssessmentProvider({
    apiKey: "test-yandex-key",
    folderId: "folder",
    model: "vision-model",
    fetchImplementation: async () => new Response(JSON.stringify({
      id: "chat-incomplete",
      choices: [{ finish_reason: "length", message: { content: "" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(
    provider.assess({ image: Buffer.from("image") }),
    (error) => error.code === "PROVIDER_INCOMPLETE_OUTPUT" && error.retryable === true,
  );
});
