import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createCatalogRouter, createPublicCatalogRouter, createWalletRouter } from "../src/wallet/http.mjs";

async function withServer(callback) {
  const service = {
    async summary(userId) { return { id: "wallet", currency: "CREDIT", balance: userId ? 2 : 0 }; },
    async history() { return [{ id: "transaction", type: "free_bonus", amount: 2 }]; },
    async catalog() {
      return {
        tariffs: [{ code: "START", priceMinor: 79_000, credits: 25 }],
        actions: [{ code: "standard_generation", credits: 1 }],
        features: { wallet: true, tariffCatalog: true, payments: false },
      };
    },
  };
  const authService = {
    async sessionFromRequest(request) {
      return request.headers.authorization === "session"
        ? { id: "session", user_id: "user", email: "test@example.test" }
        : null;
    },
  };
  const app = express();
  app.use("/api/wallet", createWalletRouter({ authService, walletService: service }));
  app.use("/api/catalog", createCatalogRouter({ authService, walletService: service }));
  app.use("/api/public/catalog", createPublicCatalogRouter({ walletService: service }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("wallet and catalog API require a session and expose one catalog source", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/wallet`)).status, 401);
    const publicCatalog = await (await fetch(`${baseUrl}/api/public/catalog`)).json();
    assert.equal(publicCatalog.tariffs[0].priceMinor, 79_000);
    assert.equal("features" in publicCatalog, false);
    const headers = { Authorization: "session" };
    const wallet = await (await fetch(`${baseUrl}/api/wallet`, { headers })).json();
    const history = await (await fetch(`${baseUrl}/api/wallet/transactions`, { headers })).json();
    const tariffs = await (await fetch(`${baseUrl}/api/catalog/tariffs`, { headers })).json();
    const costs = await (await fetch(`${baseUrl}/api/catalog/action-costs`, { headers })).json();
    assert.equal(wallet.wallet.balance, 2);
    assert.equal(history.transactions[0].type, "free_bonus");
    assert.equal(tariffs.tariffs[0].priceMinor, 79_000);
    assert.equal(tariffs.features.payments, false);
    assert.equal(costs.actions[0].credits, 1);
  });
});
