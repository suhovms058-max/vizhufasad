import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createAdminPagesRouter } from "../src/admin/pages.mjs";

function dashboard() {
  return {
    stats: { total: 2, completed: 1, active: 1, failed: 0 },
    generations: [{
      id: "g1", project_id: "p1", project_title: "Дом", user_reference: "12345678",
      kind: "standard", status: "completed", provider: "genapi", model: "seedream",
      created_at: new Date("2026-09-01T10:00:00Z"), resultUrl: "https://storage.test/result.jpg",
    }],
    partnerCodes: [{
      code_suffix: "JK23", credits: 40, contract_reference: "П-14", partner_name: "Партнёр",
      recipient_email_masked: "pa********@example.com",
      is_active: true, expires_at: null, redeemed_at: null, redeemed_user_reference: null,
    }],
  };
}

test("admin dashboard is hidden from non-owner accounts and lists private work metadata", async () => {
  const app = express();
  app.use(createAdminPagesRouter({
    authService: { async sessionFromRequest(request) { return { user_id: request.get("x-user") || "other" }; } },
    ownerAccessService: { async status(userId) { return { eligible: userId === "owner" }; } },
    partnerCreditService: { async register() { return { issuedCode: "VF-P-ABCD-EFGH-JK23" }; } },
    adminService: { async dashboard() { return dashboard(); } },
    siteOrigin: "https://vizhufasad.ru",
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/app/admin`, { headers: { "x-user": "other" } })).status, 404);
    const response = await fetch(`${base}/app/admin`, { headers: { "x-user": "owner" } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Работы и партнёрские коды/u);
    assert.match(html, /Дом/u);
    assert.match(html, /…JK23/u);
    assert.match(html, /pa\*{8}@example\.com/u);
    assert.doesNotMatch(html, /buyer@example/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("owner generates a nominal partner code and sees plaintext once", async () => {
  let input;
  const app = express();
  app.use(createAdminPagesRouter({
    authService: { async sessionFromRequest() { return { user_id: "owner" }; } },
    ownerAccessService: { async status() { return { eligible: true }; } },
    partnerCreditService: { async register(value) { input = value; return { issuedCode: "VF-P-ABCD-EFGH-JK23" }; } },
    adminService: { async dashboard() { return dashboard(); } },
    siteOrigin: "https://vizhufasad.ru",
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/app/admin/partner-codes`, {
      method: "POST",
      headers: { origin: "https://vizhufasad.ru", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ credits: "40", contractReference: "П-14", partnerName: "Партнёр", recipientEmail: "partner@example.com" }),
    });
    const html = await response.text();
    assert.equal(response.status, 201);
    assert.equal(input.credits, "40");
    assert.equal(input.recipientEmail, "partner@example.com");
    assert.match(html, /VF-P-ABCD-EFGH-JK23/u);
    assert.match(html, /показываются только один раз/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
