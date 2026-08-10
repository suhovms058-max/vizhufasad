import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createAuthRouter } from "../src/auth/http.mjs";
import { createAuthPagesRouter } from "../src/auth/pages.mjs";

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

function fixture(overrides = {}) {
  const revoked = [];
  const repository = {
    async listSessions() { return []; },
    async revokeSession(userId, sessionId) { revoked.push([userId, sessionId]); return true; },
    async revokeAllSessions() { return 1; },
    async requestAccountDeletion() {},
  };
  const service = {
    repository,
    async requestCode() { return { challengeId: "challenge", expiresInSeconds: 600 }; },
    async verifyCode() {
      return {
        ok: true,
        token: "raw-session-token",
        user: { id: "user-1", email: "user@example.com" },
        session: { id: "session-1", expires_at: new Date("2026-08-01T00:00:00Z") },
      };
    },
    async sessionFromRequest(request) {
      if (!request.headers.cookie?.includes("session=valid")) return null;
      return {
        id: "session-1", user_id: "user-1", email: "user@example.com",
        expires_at: new Date("2026-08-01T00:00:00Z"),
      };
    },
    cookieOptions() {
      return { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 3_600_000 };
    },
    clearCookieOptions() {
      return { httpOnly: true, secure: false, sameSite: "lax", path: "/" };
    },
    ...overrides,
  };
  const config = {
    hashSecret: "test-secret-with-at-least-thirty-two-characters",
    requestLimit: 2,
    verifyLimit: 2,
    rateWindowMs: 60_000,
    cookieName: "session",
  };
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ service, config }));
  app.use(createAuthPagesRouter({ service, config }));
  return { app, revoked };
}

test("protected API and cabinet reject missing sessions", async () => {
  const { app } = fixture();
  await withServer(app, async (baseUrl) => {
    const me = await fetch(`${baseUrl}/api/auth/me`, { redirect: "manual" });
    assert.equal(me.status, 401);
    assert.equal((await me.json()).error, "AUTH_REQUIRED");

    const cabinet = await fetch(`${baseUrl}/app`, { redirect: "manual" });
    assert.equal(cabinet.status, 303);
    assert.equal(cabinet.headers.get("location"), "/auth/login");
  });
});

test("email login and verification pages use the responsive cabinet design", async () => {
  const { app } = fixture();
  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/auth/login`);
    const loginHtml = await login.text();
    assert.equal(login.status, 200);
    assert.match(loginHtml, /\/assets\/app-ui\.css/u);
    assert.match(loginHtml, /class="panel auth-card"/u);
    assert.match(loginHtml, /autocomplete="email"/u);
    assert.doesNotMatch(loginHtml, /телефон[^<]*обязателен/iu);

    const verify = await fetch(`${baseUrl}/auth/verify?challenge=challenge`);
    const verifyHtml = await verify.text();
    assert.match(verifyHtml, /autocomplete="one-time-code"/u);
    assert.match(verifyHtml, /class="code-input"/u);
  });
});
test("confirmation sets hardened cookie and logout revokes the session", async () => {
  const { app, revoked } = fixture();
  await withServer(app, async (baseUrl) => {
    const confirmation = await fetch(`${baseUrl}/api/auth/code/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "challenge", code: "123456" }),
    });
    assert.equal(confirmation.status, 200);
    const cookie = confirmation.headers.get("set-cookie");
    assert.match(cookie, /session=raw-session-token/u);
    assert.match(cookie, /HttpOnly/iu);
    assert.match(cookie, /SameSite=Lax/iu);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: "session=valid" },
    });
    assert.equal(logout.status, 204);
    assert.deepEqual(revoked, [["user-1", "session-1"]]);
  });
});

test("code request route is rate limited", async () => {
  const { app } = fixture();
  await withServer(app, async (baseUrl) => {
    const statuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/code/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [202, 202, 429]);
  });
});
