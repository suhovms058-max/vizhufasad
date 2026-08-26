import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createProjectPagesRouter } from "../src/projects/pages.mjs";

const project = {
  id: "project-1", title: "Дом", status: "ready", image_id: "image-1",
  thumbnailUrl: "https://example.test/source.jpg", updated_at: new Date(),
  assessment: { status: "completed", decision: "accepted", userResult: { title: "Фото принято" } },
};
const generations = [
  {
    id: "11111111-1111-4111-8111-111111111111", revision: 1, kind: "standard", status: "completed",
    created_at: new Date(), config_snapshot: { style: "шале", materials: ["камень"], palette: ["земляная"], transformationLevel: "gentle" },
  },
  {
    id: "22222222-2222-4222-8222-222222222222", revision: 2, kind: "pro", status: "completed",
    parent_generation_id: null, created_at: new Date(), config_snapshot: { style: "шале", materials: ["дерево"], palette: ["земляная"], transformationLevel: "gentle" },
  },
];

async function render(path) {
  const authService = { async sessionFromRequest() { return { user_id: "owner" }; } };
  const projectService = {
    async list() { return [project]; }, async open() { return project; },
    async imageUrl() { return "https://example.test/source.jpg"; },
  };
  const generationService = {
    async list() { return generations; },
    async view(_userId, _projectId, generationId) { return generations.find((item) => item.id === generationId); },
    async resultUrl() { return "https://example.test/result.jpg"; },
  };
  const walletService = {
    async summary() { return { balance: 10 }; },
    async catalog() { return { actions: [
      { code: "standard_generation", credits: 1 }, { code: "pro_generation", credits: 2 },
      { code: "text_revision", credits: 1 }, { code: "upscale_4k", credits: 1 },
    ] }; },
  };
  const comparisonService = {
    async access() { return { allowed: true, minimumPlan: "OPTIMUM" }; },
    async view() { return {
      id: "comparison-1", winner_generation_id: generations[1].id, collageUrl: null,
      items: generations.map((item) => ({
        generationId: item.id, revision: item.revision, kind: item.kind, imageUrl: "https://example.test/result.jpg",
        style: "шале", materials: ["камень"], palette: ["земляная"], transformationLevel: "gentle", isFavorite: false,
      })),
    }; },
  };
  const app = express();
  app.use(createProjectPagesRouter({
    authService, projectService, generationService, walletService, comparisonService,
    generationConfig: { proEnabled: true, editorEnabled: true }, upscaleConfig: { enabled: true },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, html: await response.text() };
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("Stage 12 new-project page shows clear generation and enabled Pro costs", async () => {
  const { status, html } = await render("/app/new?project=project-1");
  assert.equal(status, 200);
  assert.match(html, /Генерация · 1 кредит/u);
  assert.match(html, /Pro · 2 кредита/u);
  assert.doesNotMatch(html, /Standard-вариант/u);
  assert.match(html, /data-pro-enabled="true"/u);
});

test("Stage 12 result page exposes editor, 4K, versions and entitled comparison", async () => {
  const { status, html } = await render(`/app/projects/project-1/generations/${generations[0].id}`);
  assert.equal(status, 200);
  for (const marker of ["edit-form", "upscale-start", "restore-version", "comparison-create", "Пользовательская маска PNG"]) {
    assert.match(html, new RegExp(marker, "u"));
  }
});

test("Stage 12 comparison page renders equal-scale controls and all variants", async () => {
  const { status, html } = await render("/app/projects/project-1/comparisons/comparison-1");
  assert.equal(status, 200);
  assert.match(html, /sync-zoom/u);
  assert.match(html, /comparison-fullscreen/u);
  assert.match(html, /Выбран победителем/u);
  assert.match(html, /Создать коллаж/u);
});
