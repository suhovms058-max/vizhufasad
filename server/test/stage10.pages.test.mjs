import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createProjectPagesRouter } from "../src/projects/pages.mjs";

async function render(path, { status = "completed" } = {}) {
  const authService = { async sessionFromRequest() { return { user_id: "owner" }; } };
  const project = {
    id: "project-1", title: "Дом у леса", status: "ready", image_id: "image-1",
    thumbnailUrl: "https://example.test/source-thumb.jpg", updated_at: new Date("2026-08-01T10:00:00Z"),
    configuration: null,
    assessment: { status: "completed", decision: "accepted_with_warning", userResult: {
      title: "Фото подходит", summary: "Можно продолжать", recommendations: ["Лучше дневной свет"],
    } },
  };
  const generation = {
    id: "generation-1", revision: 1, status, resultAvailable: status === "completed",
    requires_watermark: true, is_favorite: false, created_at: new Date("2026-08-01T11:00:00Z"),
    config_snapshot: { style: "скандинавский", materials: ["дерево"], palette: ["графитовая"], transformationLevel: "gentle" },
  };
  const projectService = {
    async list() { return [project]; }, async open() { return project; },
    async imageUrl() { return "https://example.test/source.jpg"; },
  };
  const generationService = {
    async list() { return [generation]; }, async view() { return generation; },
    async resultUrl() { return "https://example.test/result-watermarked.jpg"; },
  };
  const walletService = {
    async summary() { return { balance: 2 }; },
    async catalog() { return { actions: [{ code: "standard_generation", credits: 1 }] }; },
  };
  const app = express();
  app.use(createProjectPagesRouter({ authService, projectService, generationService, walletService }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, html: await response.text() };
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("/app/new renders the complete generation settings path from catalog data", async () => {
  const { status, html } = await render("/app/new?project=project-1");
  assert.equal(status, 200);
  for (const text of ["Фото подходит", "современный", "тёмный хай-тек", "фиброцемент", "Архитектура дома защищена автоматически", "Сбалансированный", "Генерация · 1 кредит", "700"]) {
    assert.match(html, new RegExp(text, "u"));
  }
  for (const marker of ["style-card-grid", "facade-scandinavian-bright-960.webp", "facade-neoclassical-bright-960.webp", "facade-barnhouse-bright-960.webp", "facade-chalet-bright-960.webp", "facade-loft-bright-960.webp", "facade-dark-high-tech-bright-960.webp", "material-photo", "material-brick.webp", "material-metal.webp", "material-auto.webp", "palette-chips", "settings-progress", "data-wizard-step=\"3\""]) {
    assert.match(html, new RegExp(marker, "u"));
  }
  assert.equal((html.match(/class="style-card(?: active)?" type="button"/g) || []).length, 11);
  assert.match(html, /facade-minimalism-bright-960\.webp\?v=20260825-2/u);
  assert.match(html, /material-plaster\.webp\?v=20260825-2/u);
  assert.match(html, /data-style="скандинавский"/u);
  assert.match(html, /name="palettePreset" value="автоподбор" checked/u);
  assert.match(html, /app-new\.js/u);
  assert.doesNotMatch(html, /name="preserve\./u);
  assert.doesNotMatch(html, /material-swatch/u);
  assert.doesNotMatch(html, /телефон|специалист|отправить заявку/iu);
});

test("/app/new explains the private free photo check before upload", async () => {
  const { status, html } = await render("/app/new");
  assert.equal(status, 200);
  for (const text of ["Загрузите фотографию дома", "бесплатно", "Дом целиком", "Минимум 640×420", "Как мы защищаем фотографии"]) {
    assert.match(html, new RegExp(text, "u"));
  }
  assert.match(html, /id="preview-shell"/u);
  assert.match(html, /id="photo-processing-consent"/u);
  assert.match(html, /id="photo-usage-rights"/u);
  assert.match(html, /\/legal\/photo-processing-consent/u);
  assert.match(html, /id="remove-photo"/u);
  assert.doesNotMatch(html, /телефон|специалист|отправить заявку/iu);
});

test("completed result renders owner-only before/after, configuration and free watermark", async () => {
  const { status, html } = await render("/app/projects/project-1/generations/generation-1");
  assert.equal(status, 200);
  assert.match(html, /compare-range/u);
  assert.match(html, /result-watermarked\.jpg/u);
  assert.match(html, /ВИЖУФАСАД · КОНЦЕПЦИЯ/u);
  assert.match(html, /скандинавский/u);
  assert.match(html, /Повторить настройки/u);
  assert.match(html, /В избранное/u);
  assert.match(html, /не рабочим строительным проектом/iu);
});
