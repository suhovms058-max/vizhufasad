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
    ["qwen-image-edit-2511", "image_urls[]", ["num_inference_steps", "28"]],
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

test("Qwen edit prompt stays within its API limit without dropping edit boundaries", async () => {
  let body;
  const provider = new GenApiGenerationProvider({
    apiKey: "secret",
    model: "qwen-image-edit-plus",
    fetchImplementation: async (_url, options) => {
      body = options.body;
      return Response.json({ error: true }, { status: 422 });
    },
  });
  const prompt = [
    "TASK: Edit the exact same house.",
    "EDIT BOUNDARY: Change walls only. Everything outside must remain identical.",
    `FILLER: ${"detail ".repeat(600)}`,
    "STRICTLY PRESERVE: windows; doors; roof; camera viewpoint.",
    "Required facade style: modern.",
  ].join("\n");
  await assert.rejects(provider.generate({
    sourceImage: Buffer.from("source"), prompt, seed: 1, width: 1024, height: 768,
  }));
  const compact = body.get("prompt");
  assert.ok(Buffer.byteLength(compact, "utf8") <= 1900);
  assert.match(compact, /EDIT BOUNDARY: Change walls only/u);
  assert.match(compact, /STRICTLY PRESERVE: windows; doors; roof/u);
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

test("GenAPI exposes reported cost when a submitted generation fails", async () => {
  let call = 0;
  const provider = new GenApiGenerationProvider({
    apiKey: "test-key",
    model: "nano-banana-2",
    pollIntervalMs: 1,
    fetchImplementation: async () => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ request_id: "paid-failed-1" }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ status: "error", error: "provider failed", cost: 12.5 }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(
    provider.generate({
      sourceImage: Buffer.from("image"), sourceMimeType: "image/jpeg", prompt: "facade",
      seed: 7, width: 1024, height: 768,
    }),
    (error) => error.code === "GENAPI_GENERATION_FAILED"
      && error.actualCostMinor === 1250
      && error.costCurrency === "RUB",
  );
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
    prompt: [
      "TASK: Edit the same house.",
      "EDIT BOUNDARY: Change only white mask pixels. Client command: Заменить штукатурку на натуральное дерево. Everything outside must remain identical.",
      `FILLER: ${"детали ".repeat(600)}`,
      "STRICTLY PRESERVE: windows; doors; roof; camera viewpoint.",
    ].join("\n"),
    seed: 1,
    width: 1024,
    height: 768,
  }));
  assert.equal(body.get("image").type, "image/jpeg");
  assert.equal(body.get("mask").type, "image/png");
  assert.equal(body.get("translate_input"), "true");
  assert.ok(Buffer.byteLength(body.get("prompt"), "utf8") <= 800);
  assert.match(body.get("prompt"), /Заменить штукатурку на натуральное дерево/u);
  const unsupported = new GenApiGenerationProvider({ apiKey: "secret", model: "nano-banana-2" });
  await assert.rejects(
    unsupported.generate({
      sourceImage: Buffer.from("source"), maskImage: Buffer.from("mask"),
      prompt: "edit", seed: 1, width: 1024, height: 768,
    }),
    (error) => error.code === "GENAPI_MODEL_MASK_UNSUPPORTED" && error.retryable === false,
  );
});
