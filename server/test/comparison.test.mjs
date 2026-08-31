import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { normalizeComparisonGenerationIds } from "../src/comparison/contract.mjs";
import { createComparisonRouter } from "../src/comparison/http.mjs";
import { ComparisonService } from "../src/comparison/service.mjs";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

function post(url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: "POST", headers }, (response) => {
      response.resume();
      response.once("end", () => resolve(response));
    });
    request.once("error", reject);
    request.end(body);
  });
}

test("comparison accepts two to four unique generation ids", () => {
  assert.deepEqual(normalizeComparisonGenerationIds(ids.slice(0, 2)), ids.slice(0, 2));
  assert.equal(normalizeComparisonGenerationIds(ids).length, 4);
  assert.throws(() => normalizeComparisonGenerationIds(ids.slice(0, 1)));
  assert.throws(() => normalizeComparisonGenerationIds([...ids.slice(0, 2), ids[0]]));
});

function harness({ access = true } = {}) {
  let comparison = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    project_id: "project-1",
    winner_generation_id: null,
    collage_key: null,
    items: ids.slice(0, 2).map((generationId, index) => ({
      generationId, position: index + 1, resultKey: `${generationId}.jpg`, isFavorite: false,
    })),
  };
  const repository = {
    async hasAccess() { return access; },
    async createOwned() { return comparison; },
    async findOwned() { return comparison; },
    async selectWinnerOwned(_u, _p, _c, generationId) {
      comparison = { ...comparison, winner_generation_id: generationId };
      return comparison;
    },
    async setFavoriteOwned() { return true; },
    async setCollageOwned(_u, _p, _c, _bucket, key) {
      comparison = { ...comparison, collage_key: key };
      return comparison;
    },
  };
  const stored = [];
  const storage = {
    async createDownloadUrl(key) { return `https://signed.test/${key}`; },
    async getPrivateObjectBuffer(key) {
      return sharp({ create: { width: 1200, height: 800, channels: 3, background: key.startsWith("1") ? "#887766" : "#d8d0c4" } }).jpeg().toBuffer();
    },
    async putPrivateObject(input) { stored.push(input); },
    getStorageBucket() { return "private"; },
  };
  return { service: new ComparisonService({ repository, storage }), stored };
}

test("comparison plan gate is enforced server-side", async () => {
  const { service } = harness({ access: false });
  await assert.rejects(
    service.create("owner", "project-1", { generationIds: ids.slice(0, 2) }),
    (error) => error.code === "COMPARISON_PLAN_REQUIRED" && error.status === 403,
  );
});

test("comparison returns temporary images, winner and a uniform private collage", async () => {
  const { service, stored } = harness();
  const created = await service.create("owner", "project-1", { generationIds: ids.slice(0, 2) });
  assert.equal(created.items.length, 2);
  assert.match(created.items[0].imageUrl, /^https:\/\/signed\.test\//u);
  const winner = await service.selectWinner("owner", "project-1", created.id, ids[1]);
  assert.equal(winner.winner_generation_id, ids[1]);
  const collage = await service.createCollage("owner", "project-1", created.id);
  assert.match(collage.collageUrl, /collage\.jpg$/u);
  const metadata = await sharp(stored[0].body).metadata();
  assert.deepEqual([metadata.width, metadata.height], [2400, 800]);
});

test("comparison HTTP endpoint delegates only after authentication", async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createComparisonRouter({
    authService: { async sessionFromRequest(request) { return request.get("x-user") ? { user_id: "owner" } : null; } },
    comparisonService: { async create(...args) { calls.push(args); return { id: "comparison-1" }; } },
  }));
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/projects/project-1/comparisons`;
    assert.equal((await post(url)).statusCode, 401);
    const response = await post(url, {
      headers: { "content-type": "application/json", "x-user": "yes" },
      body: JSON.stringify({ generationIds: ids.slice(0, 2) }),
    });
    assert.equal(response.statusCode, 201);
    assert.equal(calls[0][0], "owner");
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});
