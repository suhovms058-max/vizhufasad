import express from "express";
import { createRequireSession } from "../auth/http.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function rubles(priceMinor) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 0,
  }).format(Number(priceMinor) / 100);
}

function creditsLabel(value) {
  const amount = Number(value);
  const mod100 = amount % 100;
  const mod10 = amount % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? "кредитов"
    : mod10 === 1 ? "кредит" : mod10 >= 2 && mod10 <= 4 ? "кредита" : "кредитов";
  return `${amount} ${noun}`;
}

function page(body) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Баланс и тарифы — ВИЖУФАСАД</title>
  <style>
  :root{font-family:Inter,system-ui,sans-serif;color:#17201b;background:#f2f4ef}
  body{margin:0}header{padding:20px max(24px,calc((100% - 980px)/2));background:#173d2c}
  header a{color:#fff;text-decoration:none;font-weight:800}main{max-width:980px;margin:auto;padding:36px 24px}
  nav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:28px}a{color:#176b46}.balance{font-size:2.2rem;font-weight:800}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
  .card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 3px 16px #173d2c12}
  table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:12px;border-bottom:1px solid #dce3dd}
  .muted{color:#617066}
  </style></head><body><header><a href="/app">ВИЖУФАСАД</a></header><main>${body}</main></body></html>`;
}

const navigation = `<nav><a href="/app">Мои проекты</a><a href="/app/new">Новый проект</a>
  <a href="/app/balance">Баланс и тарифы</a><a href="/app/settings">Настройки</a></nav>`;

export function createWalletPagesRouter({ authService, walletService }) {
  const router = express.Router();
  router.use("/app", createRequireSession(authService, { html: true }));
  router.get("/app/balance", async (request, response, next) => {
    try {
      const [wallet, catalog, history] = await Promise.all([
        walletService.summary(request.auth.user_id),
        walletService.catalog(),
        walletService.history(request.auth.user_id, 20),
      ]);
      const tariffs = catalog.tariffs.map((tariff) => `<article class="card">
        <h3>${escapeHtml(tariff.name)}</h3>
        <p><strong>${escapeHtml(rubles(tariff.priceMinor))}</strong></p>
        <p>${escapeHtml(creditsLabel(tariff.credits))}</p>
      </article>`).join("");
      const actions = catalog.actions.map((action) => `<tr>
        <td>${escapeHtml(action.name)}</td>
        <td>${action.credits === 0 ? "Бесплатно" : `${escapeHtml(action.credits)} кр.`}</td>
      </tr>`).join("");
      const rows = history.map((transaction) => `<tr>
        <td>${escapeHtml(new Date(transaction.created_at).toLocaleDateString("ru-RU"))}</td>
        <td>${escapeHtml(transaction.type)}</td>
        <td>${Number(transaction.amount) > 0 ? "+" : ""}${escapeHtml(transaction.amount)}</td>
        <td>${escapeHtml(transaction.balance_after)}</td>
      </tr>`).join("");
      return response.type("html").send(page(`${navigation}
        <h1>Баланс и тарифы</h1>
        <section class="card"><p class="muted">Доступно</p>
          <p class="balance">${escapeHtml(creditsLabel(wallet.balance))}</p></section>
        <h2>Пакеты кредитов</h2><div class="grid">${tariffs}</div>
        <p class="muted">Пакеты приведены как единая справочная тарифная сетка.</p>
        <h2>Стоимость действий</h2><table><tbody>${actions}</tbody></table>
        <h2>История</h2><table><thead><tr><th>Дата</th><th>Операция</th>
          <th>Изменение</th><th>Баланс</th></tr></thead><tbody>${rows}</tbody></table>`));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
