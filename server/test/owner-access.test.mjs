import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { hashAuthValue } from "../src/auth/crypto.mjs";
import { createOwnerAccessPagesRouter } from "../src/owner-access/pages.mjs";
import { OwnerAccessService } from "../src/owner-access/service.mjs";

const secret = "owner-access-test-secret-with-at-least-32-characters";
const ownerCode = "VF-OWNER-4M7K9Q2X6R8T3W5Z";

test("owner access hashes the code and validates package and idempotency", async () => {
  const calls = [];
  const service = new OwnerAccessService({
    hashSecret: secret,
    repository: { async redeem(input) { calls.push(input); return { redemption: { credits: 25 }, idempotent: false }; } },
  });
  const result = await service.redeem("owner-user", {
    code: ownerCode.toLowerCase(), packageCode: "maximum", idempotencyKey: "owner-request-12345",
  });
  assert.equal(result.redemption.credits, 25);
  assert.deepEqual(calls[0], {
    userId: "owner-user",
    codeHash: hashAuthValue(secret, "owner-access-code", ownerCode),
    packageCode: "MAXIMUM",
    idempotencyKey: "owner-request-12345",
  });
  assert.equal(JSON.stringify(calls).includes(ownerCode), false);
  assert.throws(
    () => service.redeem("owner-user", { code: ownerCode, packageCode: "TOPUP_3", idempotencyKey: "owner-request-12345" }),
    { code: "OWNER_PACKAGE_INVALID" },
  );
});

test("owner access page rejects cross-origin requests", async () => {
  const calls = [];
  const app = express();
  app.use(createOwnerAccessPagesRouter({
    authService: { async sessionFromRequest() { return { user_id: "owner-user" }; } },
    ownerAccessService: { async redeem(userId, input) { calls.push({ userId, input }); return { idempotent: false }; } },
    siteOrigin: "https://vizhufasad.ru",
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/app/owner-access/redeem`;
    const blocked = await fetch(url, {
      method: "POST", headers: { origin: "https://evil.test", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: ownerCode, packageCode: "MAXIMUM", idempotencyKey: "owner-request-12345" }),
      redirect: "manual",
    });
    assert.equal(blocked.status, 403);
    const allowed = await fetch(url, {
      method: "POST", headers: { origin: "https://vizhufasad.ru", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: ownerCode, packageCode: "MAXIMUM", idempotencyKey: "owner-request-12345" }),
      redirect: "manual",
    });
    assert.equal(allowed.status, 303);
    assert.equal(allowed.headers.get("location"), "/app/balance?owner_access=credited");
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
