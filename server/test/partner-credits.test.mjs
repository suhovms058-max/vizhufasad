import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { hashAuthValue } from "../src/auth/crypto.mjs";
import { createPartnerCreditPagesRouter } from "../src/partner-credits/pages.mjs";
import { PartnerCreditService } from "../src/partner-credits/service.mjs";
import { PartnerCreditRepository } from "../src/partner-credits/repository.mjs";

const secret = "partner-code-test-secret-with-at-least-32-characters";
const code = "VF-P-ABCD-EFGH-JK23";

test("partner code is hashed and bound to the account email", async () => {
  const calls = [];
  const service = new PartnerCreditService({
    hashSecret: secret,
    repository: {
      async userEmail() { return "Partner.User@Example.com"; },
      async redeem(input) { calls.push(input); return { credits: 40, idempotent: false }; },
    },
  });
  const result = await service.redeem("partner-user", { code: code.toLowerCase(), idempotencyKey: "partner-request-123" });
  assert.equal(result.credits, 40);
  assert.deepEqual(calls[0], {
    userId: "partner-user",
    codeHash: hashAuthValue(secret, "partner-credit-code", code),
    recipientEmailHash: hashAuthValue(secret, "partner-recipient-email", "partner.user@example.com"),
    idempotencyKey: "partner-request-123",
  });
  assert.equal(JSON.stringify(calls).includes(code), false);
});

test("owner sets a positive nominal value when registering a partner code", async () => {
  const calls = [];
  const service = new PartnerCreditService({
    hashSecret: secret,
    repository: { async register(input) { calls.push(input); return { ...input, is_active: true }; } },
  });
  const result = await service.register({
    code, credits: "40", contractReference: "Договор П-14", partnerName: "Партнёр",
    recipientEmail: "Partner.User@Example.com",
    expiresAt: "2030-12-31",
  });
  assert.equal(result.credits, 40);
  assert.equal(result.codeSuffix, "JK23");
  assert.equal(result.codeHash, hashAuthValue(secret, "partner-credit-code", code));
  assert.equal(result.recipientEmailHash, hashAuthValue(secret, "partner-recipient-email", "partner.user@example.com"));
  assert.equal(result.recipientEmailMasked, "pa********@example.com");
  assert.equal(JSON.stringify(calls).includes(code), false);
  assert.throws(() => service.register({ code, credits: 0, contractReference: "П-14", recipientEmail: "partner@example.com" }), {
    code: "PARTNER_CREDITS_INVALID",
  });
  assert.throws(() => service.register({ code, credits: 40, contractReference: "П-14", recipientEmail: "invalid" }), {
    code: "PARTNER_EMAIL_INVALID",
  });
});

test("partner code cannot be redeemed by an account with another email", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(String(sql));
      if (String(sql).includes("select * from partner_credit_codes")) return { rowCount: 1, rows: [{
        id: "partner-code-id", recipient_email_hash: "expected-email-hash", redeemed_at: null,
        is_active: true, expires_at: null, credits: 40,
      }] };
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const repository = new PartnerCreditRepository({ async connect() { return client; } });
  await assert.rejects(() => repository.redeem({
    userId: "partner-user", codeHash: "code-hash", recipientEmailHash: "another-email-hash",
    idempotencyKey: "partner-request-123",
  }), { code: "PARTNER_CODE_EMAIL_MISMATCH", status: 403 });
  assert.equal(queries.some((sql) => sql.includes("insert into wallets") || sql.includes("wallet_transactions")), false);
  assert.equal(queries.at(-1), "rollback");
});

test("partner redemption endpoint redirects with the credited amount", async () => {
  const app = express();
  app.use(createPartnerCreditPagesRouter({
    authService: { async sessionFromRequest() { return { user_id: "partner-user" }; } },
    partnerCreditService: { async redeem() { return { credits: 40 }; } },
    ownerAccessService: { async status() { return { eligible: false }; } },
    siteOrigin: "https://vizhufasad.ru",
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/app/partner-code/redeem`, {
      method: "POST",
      headers: { origin: "https://vizhufasad.ru", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, idempotencyKey: "partner-request-123" }),
      redirect: "manual",
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/app/balance?partner_credits=40");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
