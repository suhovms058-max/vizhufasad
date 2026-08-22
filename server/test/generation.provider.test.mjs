import assert from "node:assert/strict";
import test from "node:test";
import { GenApiGenerationProvider } from "../src/generation/providers/genapi.mjs";

test("GenAPI provider submits image edit, polls and downloads the temporary result", async () => {
  const calls = [];
  const provider = new GenApiGenerationProvider({
    apiKey: "secret-test-key",
    model: "flux-2-pro",
    pollIntervalMs: 1,
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/networks/flux-2-pro")) {
        const body = options.body;
        assert.equal(options.headers.Authorization, "Bearer secret-test-key");
        assert.equal(options.headers["Content-Type"], undefined);
        assert.equal(body.get("translate_input"), "false");
        assert.equal(body.get("image_urls[]").type, "image/jpeg");
        assert.equal(body.get("enable_safety_checker"), "true");
        return Response.json({ request_id: 42, status: "processing" });
      }
      if (url.endsWith("/request/get/42")) {
        return Response.json({
          id: 42,
          status: "success",
          cost: 11.25,
          runtime: 3.5,
          result: ["https://results.example.test/facade.png"],
        });
      }
      if (url === "https://results.example.test/facade.png") {
        assert.equal(options.redirect, "manual");
        return new Response(Buffer.from("png-result"), {
          headers: { "content-type": "image/png", "content-length": "10" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  let submitted;
  const result = await provider.generate({
    sourceImage: Buffer.from("source"),
    prompt: "edit facade",
    seed: 123,
    width: 1024,
    height: 768,
    async onSubmitted(requestId) { submitted = requestId; },
  });
  assert.equal(submitted, "42");
  assert.equal(result.provider, "genapi");
  assert.equal(result.jobId, "42");
  assert.equal(result.model, "flux-2-pro");
  assert.equal(result.actualCostMinor, 1125);
  assert.equal(result.durationMs, 3500);
  assert.equal(result.contentType, "image/png");
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(calls), /secret-test-key.*secret-test-key.*secret-test-key/u);
});

test("GenAPI provider marks transient errors retryable without leaking response bodies", async () => {
  const provider = new GenApiGenerationProvider({
    apiKey: "secret",
    pollIntervalMs: 1,
    fetchImplementation: async () => Response.json(
      { error: "temporary overload" },
      { status: 503 },
    ),
  });
  await assert.rejects(
    provider.generate({
      sourceImage: Buffer.from("source"),
      prompt: "edit facade",
      seed: 1,
      width: 1024,
      height: 768,
    }),
    (error) => error.code === "GENAPI_HTTP_503" && error.retryable === true,
  );
});

test("GenAPI provider uses each edit model's documented image field and controls", async () => {
  const cases = [
    ["nano-banana-2", "image_urls[]", ["resolution", "1K"]],
    ["nano-banana-pro", "image_urls[]", ["resolution", "2K"]],
    ["seedream-v5-pro", "image_urls[]", ["output_format", "jpeg"]],
    ["qwen-image-edit-plus", "image_urls[]", ["num_inference_steps", "50"]],
    ["flux-kontext", "images[]", ["model", "max"]],
    ["restyle", "image", ["image_size", "input"]],
  ];
  for (const [model, imageField, [control, expected]] of cases) {
    let body;
    const provider = new GenApiGenerationProvider({
      apiKey: "secret",
      model,
      fetchImplementation: async (_url, options) => {
        body = options.body;
        return Response.json({ error: true }, { status: 422 });
      },
    });
    await assert.rejects(provider.generate({
      sourceImage: Buffer.from("source"),
      sourceMimeType: "image/jpeg",
      prompt: "complete the facade",
      seed: 1,
      width: 1024,
      height: 768,
    }));
    assert.equal(body.get(imageField).type, "image/jpeg", model);
    assert.equal(body.get(control), expected, model);
  }
});

test("GenAPI resumes a persisted paid request without submitting another generation", async () => {
  const calls = [];
  const provider = new GenApiGenerationProvider({
    apiKey: "secret", pollIntervalMs: 1,
    fetchImplementation: async (url, options = {}) => {
      calls.push([String(url), options.method]);
      assert.equal(String(url).includes("/networks/"), false);
      if (String(url).includes("/request/get/paid-42")) {
        return Response.json({ status: "success", result: ["https://files.test/result.jpg"] });
      }
      return new Response(Buffer.from("result"), { headers: { "content-type": "image/jpeg" } });
    },
  });
  const result = await provider.generate({
    sourceImage: Buffer.from("source"), prompt: "edit", seed: 1, width: 1024, height: 768,
    resumeRequestId: "paid-42",
  });
  assert.equal(result.jobId, "paid-42");
  assert.deepEqual(calls.map((call) => call[1]), ["GET", "GET"]);
});

test("GenAPI sends a custom mask only through the documented Bria mask fields", async () => {
  let body;
  const provider = new GenApiGenerationProvider({
    apiKey: "secret",
    model: "bria-genfill",
    fetchImplementation: async (_url, options) => {
      body = options.body;
      return Response.json({ error: true }, { status: 422 });
    },
  });
  await assert.rejects(provider.generate({
    sourceImage: Buffer.from("source"),
    maskImage: Buffer.from("mask"),
    prompt: "change only white mask pixels",
    seed: 1,
    width: 1024,
    height: 768,
  }));
  assert.equal(body.get("image").type, "image/jpeg");
  assert.equal(body.get("mask").type, "image/png");
  const unsupported = new GenApiGenerationProvider({ apiKey: "secret", model: "nano-banana-2" });
  await assert.rejects(
    unsupported.generate({
      sourceImage: Buffer.from("source"), maskImage: Buffer.from("mask"),
      prompt: "edit", seed: 1, width: 1024, height: 768,
    }),
    (error) => error.code === "GENAPI_MODEL_MASK_UNSUPPORTED" && error.retryable === false,
  );
});
