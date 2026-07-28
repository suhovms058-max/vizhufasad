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
    async summary() { return { balance: 2 }; },
    async history() {
      return [{
        id: "bonus",
        type: "free_bonus",
        amount: 2,
        balance_after: 2,
        created_at: new Date("2026-07-29T00:00:00Z"),
      }];
    },
    async catalog() {
      return {
        tariffs: [{
          code: "START",
          name: "Старт",
          priceMinor: 79_000,
          credits: 25,
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
    assert.match(html, /2 кредита/);
    assert.match(html, /790(?:\s|&nbsp;)*₽/);
    assert.match(html, /Standard/);
    assert.doesNotMatch(html, /Купить|Оплатить|payment|checkout/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
