import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createWalletPagesRouter } from "../src/wallet/pages.mjs";

test("balance page uses catalog data and exposes no payment action", async () => {
  const authService = {
    async sessionFromRequest() {
      return { id: "session", user_id: "user", email: "user@example.test" };
    },
  };
  const walletService = {
    async summary() { return { balance: 1 }; },
    async history() {
      return [{
        id: "bonus",
        type: "free_bonus",
        amount: 1,
        balance_after: 1,
        created_at: new Date("2026-07-29T00:00:00Z"),
      }];
    },
    async catalog() {
      return {
        tariffs: [{
          code: "START",
          name: "Старт",
          priceMinor: 79_000,
          credits: 4,
        }],
        actions: [{ code: "standard_generation", name: "Standard", credits: 1 }],
        features: { payments: false },
      };
    },
  };
  const app = express();
  app.use(createWalletPagesRouter({ authService, walletService }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/app/balance`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /1 кредит/);
    assert.match(html, /790(?:\s|&nbsp;)*₽/);
    assert.match(html, /Обычная генерация/);
    assert.match(html, /4 кредита/);
    assert.match(html, /До 4 обычных генераций/);
    assert.doesNotMatch(html, /Standard-вариант/u);
    assert.match(html, /\/assets\/app-ui\.css/);
    assert.match(html, /class="tariff-grid"/);
    assert.doesNotMatch(html, /Купить|Оплатить|payment|checkout/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("enabled balance page offers checkout only for paid tariffs and shows owner-scoped payment history", async () => {
  const authService = { async sessionFromRequest() { return { user_id: "user", email: "user@example.test" }; } };
  const walletService = {
    async summary() { return { balance: 27 }; },
    async history() { return []; },
    async catalog() {
      return {
        tariffs: [
          { id: "free-id", name: "Бесплатный", priceMinor: 0, credits: 1 },
          { id: "start-id", name: "Старт", priceMinor: 79_000, credits: 4 },
        ],
        actions: [],
      };
    },
  };
  const paymentService = { async history(userId) {
    assert.equal(userId, "user");
    return [{
      id: "payment-id", createdAt: new Date("2026-08-08T12:00:00Z"), tariffName: "Старт",
      description: "Пакет Старт", amountMinor: 79_000, status: "paid", refundable: false,
      receipts: [{ status: "pending" }],
    }];
  } };
  const app = express();
  app.use(createWalletPagesRouter({
    authService, walletService, paymentService,
    paymentConfig: { enabled: true, password3: null },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/app/balance`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal((html.match(/action="\/app\/payments\/checkout"/g) || []).length, 1);
    assert.match(html, /value="start-id"/);
    assert.doesNotMatch(html, /value="free-id"/);
    assert.match(html, /Чек формирует Robokassa/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
