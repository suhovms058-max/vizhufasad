import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createGenerationRouter } from "../src/generation/http.mjs";

test("history and favorite routes remain session and owner scoped", async () => {
  const calls = [];
  const authService = { async sessionFromRequest(request) { return request.get("x-user") ? { user_id: request.get("x-user") } : null; } };
  const generationService = {
    async list(userId, projectId) { calls.push(["list", userId, projectId]); return [{ id: "g1" }]; },
    async favorite(userId, projectId, generationId, favorite) { calls.push(["favorite", userId, projectId, generationId, favorite]); return { id: generationId, is_favorite: favorite }; },
  };
  const app = express(); app.use(express.json());
  app.use("/api/projects", createGenerationRouter({ authService, generationService }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/projects/p/generations`;
    assert.equal((await fetch(base)).status, 401);
    const list = await fetch(base, { headers: { "x-user": "owner" } });
    assert.equal(list.status, 200); assert.equal((await list.json()).generations[0].id, "g1");
    const favorite = await fetch(`${base}/g1/favorite`, { method: "PATCH", headers: { "content-type": "application/json", "x-user": "owner" }, body: JSON.stringify({ favorite: true }) });
    assert.equal(favorite.status, 200); assert.equal((await favorite.json()).generation.is_favorite, true);
    assert.deepEqual(calls[1], ["favorite", "owner", "p", "g1", true]);
  } finally { server.close(); await once(server, "close"); }
});
