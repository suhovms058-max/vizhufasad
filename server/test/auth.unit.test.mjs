import assert from "node:assert/strict";
import test from "node:test";
import { loadAuthConfig } from "../src/auth/config.mjs";
import { hashAuthValue, normalizeEmail, parseCookies } from "../src/auth/crypto.mjs";
import { AuthService } from "../src/auth/service.mjs";

const secret = "test-secret-with-at-least-thirty-two-characters";

test("production cannot use console auth mail", () => {
  assert.throws(
    () => loadAuthConfig({ NODE_ENV: "production", AUTH_MAIL_MODE: "console", AUTH_HASH_SECRET: secret }),
    /forbidden/,
  );
  assert.throws(
    () => loadAuthConfig({
      NODE_ENV: "production",
      AUTH_MAIL_MODE: "smtp",
      AUTH_HASH_SECRET: secret,
      AUTH_COOKIE_SECURE: "false",
      SMTP_USER: "smtp-user",
      SMTP_PASSWORD: "smtp-password",
      AUTH_EMAIL_FROM: "auth@example.test",
    }),
    /AUTH_COOKIE_SECURE=false is forbidden/,
  );
});

test("auth config requires a strong server-side hash secret", () => {
  assert.throws(() => loadAuthConfig({ AUTH_HASH_SECRET: "short" }), /at least 32/);
});

test("email normalization and cookie parsing do not require a phone", () => {
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
  assert.deepEqual(parseCookies("a=1; vizhufasad_session=abc%2F123"), {
    a: "1",
    vizhufasad_session: "abc/123",
  });
  assert.throws(() => normalizeEmail("not-an-email"), /INVALID_EMAIL/);
});

test("request stores only a code hash and sends the short-lived code", async () => {
  let stored;
  let delivered;
  const repository = {
    async createLoginCode(value) { stored = value; },
    async invalidateLoginCode() {},
  };
  const mailer = {
    async sendLoginCode(value) { delivered = value; },
  };
  const config = {
    hashSecret: secret,
    codeTtlSeconds: 600,
    codeMaxAttempts: 5,
    sessionTtlSeconds: 3600,
    cookieSecure: false,
    cookieName: "session",
  };
  const service = new AuthService({
    repository,
    mailer,
    config,
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
  });
  const result = await service.requestCode("USER@example.com", { ip: "127.0.0.1" });

  assert.equal(stored.email, "user@example.com");
  assert.equal(stored.attemptsRemaining, 5);
  assert.equal(stored.expiresAt.toISOString(), "2026-07-28T12:10:00.000Z");
  assert.match(stored.codeHash, /^[a-f0-9]{64}$/u);
  assert.equal(stored.codeHash, hashAuthValue(secret, "login-code", `${result.challengeId}:${delivered.code}`));
  assert.ok(!JSON.stringify(stored).includes(delivered.code));
  assert.equal(delivered.expiresInSeconds, 600);
});
