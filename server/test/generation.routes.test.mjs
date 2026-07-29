import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import {
  createGenerationRouter, createGenerationStagingRouter,
} from "../src/generation/http.mjs";
import { GenerationError } from "../src/generation/contract.mjs";

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
      return { id: generationId, project_id: projectId, status: "ready" };
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
  });
});

test("staging generation endpoint is fail-closed and token protected", async () => {
  const generationService = {
    async create() { return { id: "g", status: "ready" }; },
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
    assert.equal(allowed.status, 201);
  });
});
