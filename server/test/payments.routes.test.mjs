import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createPaymentRouter, createPaymentWebhookRouter } from "../src/payments/http.mjs";
import { createPaymentPagesRouter } from "../src/payments/pages.mjs";

async function withServer(callback) {
  const authService = { async sessionFromRequest(request) {
    return request.get("authorization") === "session"
      ? { user_id: "user-id", email: "buyer@example.test" } : null;
  } };
  const paymentService = {
    async history() { return [{ id: "payment-id", status: "paid" }]; },
    async view() { return { id: "payment-id", status: "paid" }; },
    async createCheckout(_user, body, key) {
      assert.equal(body.tariffPlanId, "tariff-id");
      assert.equal(key, "checkout-key");
      return { payment: { id: "payment-id" }, checkout: { url: "https://pay.test" }, idempotent: false };
    },
    async refund() { return { id: "refund-id", status: "pending" }; },
    async handleResult(body) {
      assert.equal(body.InvId, "100001");
      return { acknowledgment: "OK100001" };
    },
    async handleResult2() {},
  };
  const app = express();
  app.use("/api/payments/webhooks", createPaymentWebhookRouter({ paymentService }));
  app.use(express.json());
  app.use("/api/payments", createPaymentRouter({ authService, paymentService }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("payment routes require a session and checkout requires server idempotency", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/payments`)).status, 401);
    const headers = { authorization: "session" };
    assert.equal((await fetch(`${baseUrl}/api/payments`, { headers })).status, 200);
    const checkout = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "checkout-key" },
      body: JSON.stringify({ tariffPlanId: "tariff-id", priceMinor: 1, credits: 999999 }),
    });
    assert.equal(checkout.status, 201);
    const subscription = await fetch(`${baseUrl}/api/payments/subscriptions`, { method: "POST", headers });
    assert.equal(subscription.status, 404);
  });
});

test("Robokassa ResultURL is unauthenticated and receives form data", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payments/webhooks/robokassa/result`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ InvId: "100001", OutSum: "790.00", SignatureValue: "signature" }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "OK100001");
  });
});

test("public offer identifies the automated digital service and published merchant", async () => {
  const app = express();
  app.use(createPaymentPagesRouter({
    authService: { async sessionFromRequest() { return null; } },
    paymentService: {},
    config: {
      siteOrigin: "https://stage.example.test",
      merchantName: "Иванов Иван Иванович",
      merchantInn: "000000000000",
      merchantEmail: "merchant@example.test",
      merchantStatus: "Самозанятый, плательщик НПД",
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/legal/offer`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Публичная оферта/);
    assert.match(html, /Иванов Иван Иванович/);
    assert.match(html, /самостоятельного автоматического создания/);
    assert.doesNotMatch(html, /дизайнера или оператора[^<]*предоставляет/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
