import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import express from "express";
import http from "node:http";
import { once } from "node:events";
import { isActual4k, UpscaleError } from "../src/upscale/contract.mjs";
import { loadUpscaleConfig } from "../src/upscale/config.mjs";
import { UpscaleProcessor } from "../src/upscale/processor.mjs";
import { GenApiUpscaleProvider } from "../src/upscale/providers/genapi.mjs";
import { UpscaleService } from "../src/upscale/service.mjs";
import { createUpscaleRouter } from "../src/upscale/http.mjs";

async function image(width, height, color = "#8b765f") {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

test("4K label requires actual landscape or portrait dimensions", () => {
  assert.equal(isActual4k(3840, 2160), true);
  assert.equal(isActual4k(2160, 3840), true);
  assert.equal(isActual4k(3072, 2048), false);
});

test("upscale config is disabled by default and requires a key only when enabled", () => {
  const config = loadUpscaleConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.model, "drct-super-resolution");
  assert.equal(config.factor, 4);
  assert.throws(
    () => loadUpscaleConfig({ FEATURE_UPSCALE_4K_ENABLED: "true" }),
    (error) => error.code === "GENAPI_API_KEY_REQUIRED",
  );
});

test("GenAPI DRCT adapter sends a 4x image upscale and returns provider cost", async () => {
  const calls = [];
  const output = await image(3840, 2160);
  const provider = new GenApiUpscaleProvider({
    apiKey: "secret", pollIntervalMs: 1,
    fetchImplementation: async (url, options = {}) => {
      calls.push([String(url), options]);
      if (String(url).includes("/networks/")) return Response.json({ request_id: 42, status: "processing" });
      if (String(url).includes("/request/get/")) {
        return Response.json({ status: "success", cost: 8.5, result: ["https://files.test/result.jpg"] });
      }
      return new Response(output, { status: 200, headers: { "content-type": "image/jpeg" } });
    },
  });
  const result = await provider.upscale({ sourceImage: await image(960, 540) });
  const body = calls[0][1].body;
  assert.equal(body.get("upscaling_factor"), "4");
  assert.equal(body.get("image_url").type, "image/jpeg");
  assert.equal(result.requestId, "42");
  assert.equal(result.actualCostMinor, 850);
});

test("DRCT adapter resumes the persisted request id instead of paying twice", async () => {
  const calls = [];
  const output = await image(3840, 2160);
  const provider = new GenApiUpscaleProvider({
    apiKey: "secret", pollIntervalMs: 1,
    fetchImplementation: async (url, options = {}) => {
      calls.push([String(url), options.method]);
      assert.equal(String(url).includes("/networks/"), false);
      if (String(url).includes("/request/get/paid-upscale")) {
        return Response.json({ status: "success", result: ["https://files.test/result.jpg"] });
      }
      return new Response(output, { headers: { "content-type": "image/jpeg" } });
    },
  });
  const result = await provider.upscale({
    sourceImage: await image(960, 540), resumeRequestId: "paid-upscale",
  });
  assert.equal(result.requestId, "paid-upscale");
  assert.deepEqual(calls.map((call) => call[1]), ["GET", undefined]);
});

test("upscale service reserves one credit and enqueues idempotently", async () => {
  const events = [];
  const row = { id: "upscale-1", status: "created" };
  const repository = {
    async createOwned() { return { upscale: row, created: true }; },
    async attachReservationAndQueue() { row.status = "queued"; return row; },
    async findOwned() { return { ...row, result_key: null }; },
    async markFailedRefunded() {},
  };
  const service = new UpscaleService({
    repository,
    queue: { async enqueue() { events.push("enqueue"); } },
    walletService: {
      async reserve(_userId, input) { events.push(input.actionCode); return { transaction: { id: "reserve-1" } }; },
      async refund() {},
    },
    storage: {},
    config: { enabled: true },
  });
  const result = await service.create("owner", "project-1", "generation-1", "upscale-request-12345");
  assert.equal(result.status, "queued");
  assert.deepEqual(events, ["upscale_4k", "enqueue"]);
});

test("upscale rejects a non-Maximum package before task creation and coin reservation", async () => {
  const events = [];
  const service = new UpscaleService({
    repository: { async createOwned() { events.push("created"); } },
    queue: {},
    walletService: { async reserve() { events.push("reserved"); } },
    storage: {},
    config: { enabled: true },
    planAccessService: { async forUser() { return { upscale: false }; } },
  });
  await assert.rejects(
    service.create("owner", "project-1", "generation-1", "upscale-request-12345"),
    (error) => error.code === "UPSCALE_PLAN_REQUIRED" && error.status === 403,
  );
  assert.deepEqual(events, []);
});

test("an accepted upscale request remains non-cancellable after a local retry state", async () => {
  const service = new UpscaleService({
    repository: { async findOwned() { return {
      id: "upscale-1", status: "queued", provider_request_id: "paid-upscale-42", result_key: null,
    }; } },
    queue: {}, walletService: {}, storage: {}, config: { enabled: true },
  });
  const viewed = await service.view("owner", "project-1", "upscale-1");
  assert.equal(viewed.cancellable, false);
});

test("upscale API starts an asynchronous owner-scoped task", async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createUpscaleRouter({
    authService: { async sessionFromRequest() { return { user_id: "owner" }; } },
    upscaleService: {
      async create(...args) { calls.push(args); return { id: "u1", status: "queued" }; },
    },
  }));
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/p/generations/g/upscales`,
      { method: "POST", headers: { "idempotency-key": "upscale-request-12345" } },
    );
    assert.equal(response.status, 202);
    assert.deepEqual(calls[0], ["owner", "p", "g", "upscale-request-12345"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("processor publishes only a structurally similar real 4K image", async () => {
  const events = [];
  const source = await image(1024, 576);
  const output = await image(4096, 2304);
  let status = "queued";
  const upscale = {
    id: "upscale-1", generation_id: "generation-1", project_id: "project-1", user_id: "owner",
    source_key: "source.jpg", wallet_reservation_id: "reserve-1",
  };
  const repository = {
    async claim() { status = "processing"; return upscale; },
    async findById() { return { ...upscale, status }; },
    async markCompleted(_id, result) { status = "completed"; events.push(["completed", result.width, result.height]); },
    async markRetryable() {},
    async markFailedRefunded() { status = "failed_refunded"; },
  };
  const processor = new UpscaleProcessor({
    repository,
    provider: { async upscale() {
      return { provider: "mock", model: "4x", requestId: "42", result: output,
        estimatedCostMinor: 100, actualCostMinor: 90, currency: "RUB" };
    } },
    walletService: { async commit() { events.push(["commit"]); }, async refund() { events.push(["refund"]); } },
    storage: {
      async getPrivateObjectBuffer() { return source; },
      async putPrivateObject({ key }) { events.push(["stored", key]); },
      async deletePrivateObject() {},
      getStorageBucket() { return "private"; },
    },
    config: { timeoutMs: 5000, resultMaxBytes: 50 * 1024 * 1024 },
  });
  const result = await processor.process({
    data: { upscaleId: upscale.id }, attemptsMade: 0, opts: { attempts: 2 },
  });
  assert.deepEqual([result.width, result.height], [4096, 2304]);
  assert.equal(events.some((event) => event[0] === "commit"), true);
  assert.equal(events.some((event) => event[0] === "completed"), true);
  assert.equal(events.some((event) => event[0] === "refund"), false);
});

test("final non-4K provider result is hidden and refunded", async () => {
  const source = await image(1024, 576);
  const refunds = [];
  let status = "queued";
  const upscale = { id: "u", generation_id: "g", project_id: "p", user_id: "owner", source_key: "s", wallet_reservation_id: "r" };
  const repository = {
    async claim() { status = "processing"; return upscale; }, async findById() { return { ...upscale, status }; },
    async markFailedRefunded() { status = "failed_refunded"; }, async markRetryable() {},
  };
  const processor = new UpscaleProcessor({
    repository,
    provider: { async upscale() { return { result: await image(2048, 1152) }; } },
    walletService: { async refund() { refunds.push("refund"); } },
    storage: { async getPrivateObjectBuffer() { return source; }, async deletePrivateObject() {} },
    config: { timeoutMs: 5000, resultMaxBytes: 50 * 1024 * 1024 },
  });
  await assert.rejects(
    processor.process({ data: { upscaleId: "u" }, attemptsMade: 1, opts: { attempts: 2 } }),
    (error) => error instanceof UpscaleError && error.code === "UPSCALE_RESULT_NOT_4K",
  );
  assert.equal(status, "failed_refunded");
  assert.deepEqual(refunds, ["refund"]);
});
