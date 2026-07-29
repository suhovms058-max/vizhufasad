import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createProjectsRouter } from "../src/projects/http.mjs";
import { ProjectError } from "../src/projects/service.mjs";

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

test("project API requires a session and never opens another user's project", async () => {
  const authService = {
    async sessionFromRequest(request) {
      const userId = request.get("x-test-user");
      return userId ? { id: `session-${userId}`, user_id: userId } : null;
    },
  };
  const projectService = {
    async open(userId, projectId) {
      if (userId !== "owner" || projectId !== "project-1") {
        throw new ProjectError("PROJECT_NOT_FOUND", 404);
      }
      return { id: projectId, user_id: userId, title: "Дом" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createProjectsRouter({ authService, projectService }));

  await withServer(app, async (baseUrl) => {
    const anonymous = await fetch(`${baseUrl}/api/projects/project-1`);
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error, "AUTH_REQUIRED");

    const owner = await fetch(`${baseUrl}/api/projects/project-1`, {
      headers: { "x-test-user": "owner" },
    });
    assert.equal(owner.status, 200);
    assert.equal((await owner.json()).project.user_id, "owner");

    const stranger = await fetch(`${baseUrl}/api/projects/project-1`, {
      headers: { "x-test-user": "stranger" },
    });
    assert.equal(stranger.status, 404);
    assert.equal((await stranger.json()).error, "PROJECT_NOT_FOUND");
  });
});
