import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import {
  createGenerationMetricsRouter, createGenerationRouter, createGenerationStagingRouter,
} from "../src/generation/http.mjs";
import { GenerationError } from "../src/generation/contract.mjs";
import { createGenerationQualityDiagnosticsRouter } from "../src/generation-quality/http.mjs";

async function withServer(app, callback) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("generation routes require session and enforce ownership through service", async () => {
  const authService = {
    async sessionFromRequest(request) {
      const userId = request.get("x-test-user");
      return userId ? { user_id: userId } : null;
    },
  };
  const generationService = {
    async view(userId, projectId, generationId) {
      if (userId !== "owner") throw new GenerationError("GENERATION_NOT_FOUND", 404);
      return { id: generationId, project_id: projectId, status: "completed" };
    },
    async cancel(userId, projectId, generationId) {
      if (userId !== "owner") throw new GenerationError("GENERATION_NOT_FOUND", 404);
      return { id: generationId, project_id: projectId, status: "cancelled" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createGenerationRouter({ authService, generationService }));
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/projects/p/generations/g`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/projects/p/generations/g`, {
      headers: { "x-test-user": "stranger" },
    })).status, 404);
    const owner = await fetch(`${baseUrl}/api/projects/p/generations/g`, {
      headers: { "x-test-user": "owner" },
    });
    assert.equal(owner.status, 200);
    assert.equal((await owner.json()).generation.id, "g");
    const cancelled = await fetch(`${baseUrl}/api/projects/p/generations/g/cancel`, {
      method: "POST",
      headers: { "x-test-user": "owner" },
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).generation.status, "cancelled");
  });
});

test("Pro route delegates to the Pro generation path", async () => {
  const calls = [];
  const authService = {
    async sessionFromRequest() { return { user_id: "owner" }; },
  };
  const generationService = {
    async createPro(...args) {
      calls.push(args);
      return { id: "pro-1", kind: "pro", status: "queued" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createGenerationRouter({ authService, generationService }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/project-1/generations/pro`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "pro-request-12345" },
      body: JSON.stringify({ sourceImageId: "image-1", input: { style: "modern" } }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).generation.kind, "pro");
    assert.deepEqual(calls[0].slice(0, 3), ["owner", "project-1", "image-1"]);
  });
});

test("editor routes create an owner-scoped mask upload and child generation", async () => {
  const calls = [];
  const authService = { async sessionFromRequest() { return { user_id: "owner" }; } };
  const generationService = {
    async createEditMaskUpload(...args) {
      calls.push(["mask", ...args]);
      return { key: "private-mask.png", url: "https://storage.test/upload" };
    },
    async createEdit(...args) {
      calls.push(["edit", ...args]);
      return { id: "edit-1", kind: "edit", status: "queued" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createGenerationRouter({ authService, generationService }));
  await withServer(app, async (baseUrl) => {
    const route = `${baseUrl}/api/projects/project-1/generations/parent-1`;
    const upload = await fetch(`${route}/edit-mask-upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/png", contentLength: 1234 }),
    });
    assert.equal(upload.status, 201);
    const edit = await fetch(`${route}/edits`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "edit-request-12345" },
      body: JSON.stringify({ scope: "walls", command: "Сделать стены светлее" }),
    });
    assert.equal(edit.status, 202);
    assert.equal((await edit.json()).generation.kind, "edit");
    assert.deepEqual(calls.map((call) => call.slice(0, 4)), [
      ["mask", "owner", "project-1", "parent-1"],
      ["edit", "owner", "project-1", "parent-1"],
    ]);
  });
});

test("version routes expose the tree and restore a completed owner version", async () => {
  const calls = [];
  const authService = { async sessionFromRequest() { return { user_id: "owner" }; } };
  const generationService = {
    async versionTree(...args) { calls.push(["tree", ...args]); return { selectedGenerationId: "g1", nodes: [] }; },
    async restoreVersion(...args) { calls.push(["restore", ...args]); return { id: args[2], status: "completed" }; },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createGenerationRouter({ authService, generationService }));
  await withServer(app, async (baseUrl) => {
    const route = `${baseUrl}/api/projects/project-1/generation-versions`;
    assert.equal((await fetch(route)).status, 200);
    assert.equal((await fetch(`${route}/g1/restore`, { method: "POST" })).status, 200);
    assert.deepEqual(calls, [
      ["tree", "owner", "project-1"],
      ["restore", "owner", "project-1", "g1"],
    ]);
  });
});

test("generation metrics are disabled without a bearer token and never expose configuration", async () => {
  const app = express();
  app.use("/internal/generation/metrics", createGenerationMetricsRouter({
    metrics: {
      async snapshot() {
        return { queue: { wait: 1 }, database: { average_provider_latency_ms: 25 } };
      },
    },
    config: { metricsToken: "01234567890123456789012345678901" },
  }));
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/internal/generation/metrics`)).status, 404);
    const response = await fetch(`${baseUrl}/internal/generation/metrics`, {
      headers: { authorization: "Bearer 01234567890123456789012345678901" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.queue.wait, 1);
    assert.equal("token" in body, false);
  });
});

test("staging generation endpoint is fail-closed and token protected", async () => {
  const generationService = {
    async create() { return { id: "g", status: "queued" }; },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/staging/generation", createGenerationStagingRouter({
    generationService,
    config: { stagingEnabled: true, stagingSecret: "012345678901234567890123" },
  }));
  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/staging/generation/standard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${baseUrl}/api/staging/generation/standard`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-staging-secret": "012345678901234567890123",
      },
      body: "{}",
    });
    assert.equal(allowed.status, 202);
  });
});

test("quality diagnostics are admin-only and use short-lived private URLs", async () => {
  const app = express();
  app.use("/internal/generation/quality", createGenerationQualityDiagnosticsRouter({
    repository: {
      async diagnostics() {
        return [{
          id: "q1", generation_id: "g1", assessment_number: 1,
          status: "completed", decision: "passed", schema_version: "schema-v1",
          prompt_version: "prompt-v1", policy_version: "policy-v1",
          generation_prompt_version: "generation-v1", provider: "yandex", model: "model",
          score_breakdown: { sameHouse: 9500 }, overall_score: 9000,
          failure_reasons: [], allowed_changes: {}, provider_request_id: "request",
          diagnostic_key: "private/candidate.jpg",
          diagnostic_expires_at: new Date(Date.now() + 60_000),
          created_at: new Date(), finished_at: new Date(),
        }];
      },
    },
    storage: { async createDownloadUrl(key, ttl) { return `signed://${key}?ttl=${ttl}`; } },
    config: {
      adminToken: "01234567890123456789012345678901",
      diagnosticUrlTtlSeconds: 120,
    },
  }));
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/internal/generation/quality/g1`)).status, 404);
    const response = await fetch(`${baseUrl}/internal/generation/quality/g1`, {
      headers: { authorization: "Bearer 01234567890123456789012345678901" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.assessments[0].diagnosticUrl, "signed://private/candidate.jpg?ttl=120");
    assert.equal("manualDecision" in body.assessments[0], false);
  });
});
