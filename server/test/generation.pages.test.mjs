import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createProjectPagesRouter } from "../src/projects/pages.mjs";

test("project page renders queued generation polling stages without WebSocket", async () => {
  const authService = {
    async sessionFromRequest() {
      return { id: "session", user_id: "user", email: "user@example.test" };
    },
  };
  const projectService = {
    async open() {
      return {
        id: "project-1",
        title: "Дом",
        status: "generation_queued",
        image_id: "image-1",
        thumbnailUrl: "https://example.test/thumb.jpg",
        assessment: {
          status: "completed",
          decision: "accepted",
          userResult: { title: "Фото принято", summary: "Можно продолжать" },
        },
      };
    },
    async imageUrl() { return "https://example.test/source.jpg"; },
  };
  const generationService = {
    async view() {
      return { id: "generation-1", revision: 1, status: "queued", resultAvailable: false };
    },
    async list() { return [{ id: "generation-1", revision: 1, status: "queued", created_at: new Date() }]; },
  };
  const walletService = { async summary() { return { balance: 1 }; } };
  const app = express();
  app.use(createProjectPagesRouter({ authService, projectService, generationService, walletService }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/app/projects/project-1/generations/generation-1`,
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Анализ/);
    assert.match(html, /Подготовка/);
    assert.match(html, /Генерация/);
    assert.match(html, /Проверка/);
    assert.match(html, /Скачивание/);
    assert.match(html, /app-generation\.js/);
    assert.doesNotMatch(html, /WebSocket/iu);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
