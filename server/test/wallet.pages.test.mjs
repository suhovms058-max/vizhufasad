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
    assert.match(html, /1 ВФ-коин/);
    assert.match(html, /790(?:\s|&nbsp;)*₽/);
    assert.match(html, /Генерация фасада/);
    assert.match(html, /4 ВФ-коина/);
    assert.match(html, /До 4 генераций/);
    assert.doesNotMatch(html, /Standard-вариант/u);
    assert.match(html, /\/assets\/app-ui\.css/);
    assert.match(html, /rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/u);
    assert.match(html, /rel="shortcut icon" href="\/favicon-32x32\.png"/u);
    assert.match(html, /class="tariff-grid"/);
    assert.match(html, /class="brand brand-home" href="\/" aria-label="Вернуться на главную страницу"/u);
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
          { id: "topup-id", code: "TOPUP_1", name: "1 кредит", priceMinor: 24_900, credits: 1 },
          { id: "start-id", code: "START", name: "Старт", priceMinor: 79_000, credits: 4 },
          { id: "optimum-id", code: "OPTIMUM", name: "Оптимум", priceMinor: 129_000, credits: 8 },
          { id: "maximum-id", code: "MAXIMUM", name: "Максимум", priceMinor: 349_000, credits: 25 },
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
    ownerAccessService: { async status() { return { eligible: true, activated: false }; } },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/app/balance?plan=START`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal((html.match(/action="\/app\/payments\/checkout"/g) || []).length, 4);
    assert.equal((html.match(/name="offerAccepted" value="yes" required/g) || []).length, 4);
    assert.equal((html.match(/required><span>Принимаю <a href="\/legal\/offer"/g) || []).length, 4);
    assert.doesNotMatch(html, /name="promoCode"/u);
    assert.match(html, /Для партнёров по договору/u);
    assert.match(html, /action="\/app\/partner-code\/redeem"/u);
    assert.match(html, /открывает все стили, материалы, Pro, сравнение, точечные доработки и 4K тарифа «Максимум»/u);
    assert.match(html, /4 популярных стиля и автоподбор/u);
    assert.match(html, /7 стилей и расширенный выбор материалов/u);
    assert.match(html, /Все 10 стилей и все материалы/u);
    assert.match(html, /Пополнение не меняет доступный набор стилей и инструментов/u);
    assert.match(html, /vizhufasad0058@bk\.ru/u);
    assert.doesNotMatch(html, /name="offerAccepted"[^>]*checked/u);
    assert.match(html, /name="offerHash" value="[a-f0-9]{64}"/u);
    assert.match(html, /value="start-id"/);
    assert.match(html, /value="topup-id"/);
    assert.match(html, /Добавить ВФ-коины/);
    assert.match(html, /Пакеты остаются выгоднее/);
    assert.match(html, /До 4 генераций/);
    assert.match(html, /id="plan-START" class="panel tariff-card selected-plan"/);
    assert.match(html, /Вы выбрали этот пакет/);
    assert.doesNotMatch(html, /value="free-id"/);
    assert.match(html, /Чек формирует Robokassa/);
    assert.match(html, /Запросить частичный или иной возврат/);
    assert.match(html, /payment-id/);
    assert.match(html, /Служебный доступ владельца/u);
    assert.match(html, /action="\/app\/owner-access\/redeem"/u);
    assert.match(html, /href="\/app\/admin"/u);
    assert.match(html, /type="password"/u);
    assert.doesNotMatch(html, /VF-OWNER-/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
