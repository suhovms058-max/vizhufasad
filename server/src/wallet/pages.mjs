import { randomUUID } from "node:crypto";
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

const statusLabels = {
  created: "Создан",
  pending: "Ожидает оплаты",
  paid: "Оплачен",
  cancelled: "Отменён",
  failed: "Ошибка",
  refunded: "Возвращён",
};

function page(body) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Баланс и тарифы — ВИЖУФАСАД</title>
  <style>
  :root{font-family:Inter,system-ui,sans-serif;color:#17201b;background:#f2f4ef;color-scheme:light}
  *{box-sizing:border-box}body{margin:0}header{padding:20px max(20px,calc((100% - 1040px)/2));background:#173d2c}
  header a{color:#fff;text-decoration:none;font-weight:800}main{max-width:1040px;margin:auto;padding:34px 20px}
  nav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:28px}a{color:#176b46}.balance{font-size:2.2rem;font-weight:800}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 3px 16px #173d2c12}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden}th,td{text-align:left;padding:12px;border-bottom:1px solid #dce3dd;vertical-align:top}
  .muted{color:#617066}.notice{padding:14px 16px;border-radius:12px;background:#fff3cd;margin:16px 0}.success{background:#dff5e7}.error{background:#ffe4e4}
  label{display:block;font-size:.9rem;margin:10px 0 5px}input{width:100%;padding:10px;border:1px solid #aab8ae;border-radius:9px}.button,button{display:inline-block;border:0;border-radius:10px;background:#176b46;color:#fff;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
  button.secondary{background:#fff;color:#176b46;border:1px solid #176b46}.table-wrap{overflow-x:auto;margin-bottom:24px}footer{margin-top:30px;display:flex;gap:14px;flex-wrap:wrap;font-size:.9rem}
  @media(max-width:620px){main{padding:24px 14px}th,td{padding:10px;font-size:.9rem}.optional{display:none}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style></head><body><header><a href="/app">ВИЖУФАСАД</a></header><main>${body}
  <footer><a href="/legal/offer">Условия оплаты</a><a href="/legal/privacy">Конфиденциальность</a><a href="/legal/refunds">Возвраты</a></footer>
  </main></body></html>`;
}

const navigation = `<nav><a href="/app">Мои проекты</a><a href="/app/new">Новый проект</a>
  <a href="/app/balance" aria-current="page">Баланс и тарифы</a><a href="/app/settings">Настройки</a></nav>`;

function returnNotice(query) {
  if (query.payment_error) {
    const messages = {
      PROMO_NOT_AVAILABLE: "Промокод недействителен или срок его действия закончился.",
      PROMO_ALREADY_USED: "Этот промокод уже был использован вашим аккаунтом.",
      PROMO_LIMIT_REACHED: "Лимит применений промокода исчерпан.",
      INSUFFICIENT_CREDITS: "Возврат невозможен: часть купленных кредитов уже использована.",
      REFUND_OPERATION_KEY_UNAVAILABLE: "Автоматический возврат ещё недоступен: Robokassa не передала идентификатор операции.",
    };
    return `<div class="notice error" role="alert">${escapeHtml(messages[query.payment_error] || "Операцию выполнить не удалось. Баланс не изменён.")}</div>`;
  }
  if (query.refund === "pending") {
    return '<div class="notice success" role="status">Запрос возврата передан в Robokassa. Итоговый статус появится в истории.</div>';
  }
  if (!query.payment_return) return "";
  const failed = query.payment_return === "fail";
  return `<div class="notice ${failed ? "error" : "success"}" role="status">
    ${failed
      ? "Платёж не завершён. Кредиты не начислялись."
      : "Вы вернулись со страницы оплаты. Это не подтверждение платежа: баланс изменится только после подписанного уведомления Robokassa."}
  </div>`;
}

export function createWalletPagesRouter({ authService, walletService, paymentService, paymentConfig }) {
  const router = express.Router();
  router.use("/app", createRequireSession(authService, { html: true }));
  router.get("/app/balance", async (request, response, next) => {
    try {
      const paymentHistoryPromise = paymentConfig?.enabled
        ? paymentService.history(request.auth.user_id, 30)
        : Promise.resolve([]);
      const [wallet, catalog, history, payments] = await Promise.all([
        walletService.summary(request.auth.user_id),
        walletService.catalog(),
        walletService.history(request.auth.user_id, 20),
        paymentHistoryPromise,
      ]);
      const tariffs = catalog.tariffs.map((tariff) => `<article class="card">
        <h3>${escapeHtml(tariff.name)}</h3><p><strong>${escapeHtml(rubles(tariff.priceMinor))}</strong></p>
        <p>${escapeHtml(creditsLabel(tariff.credits))}</p>
        ${paymentConfig?.enabled && tariff.priceMinor > 0 ? `<form method="post" action="/app/payments/checkout">
          <input type="hidden" name="tariffPlanId" value="${escapeHtml(tariff.id)}">
          <input type="hidden" name="idempotencyKey" value="${randomUUID()}">
          <label for="promo-${escapeHtml(tariff.id)}">Промокод, если есть</label>
          <input id="promo-${escapeHtml(tariff.id)}" name="promoCode" maxlength="32" autocomplete="off">
          <p><button type="submit">Перейти к оплате</button></p></form>` : ""}
      </article>`).join("");
      const actions = catalog.actions.map((action) => `<tr><td>${escapeHtml(action.name)}</td>
        <td>${action.credits === 0 ? "Бесплатно" : `${escapeHtml(action.credits)} кр.`}</td></tr>`).join("");
      const walletRows = history.map((item) => `<tr><td>${escapeHtml(new Date(item.created_at).toLocaleDateString("ru-RU"))}</td>
        <td>${escapeHtml(item.type)}</td><td>${Number(item.amount) > 0 ? "+" : ""}${escapeHtml(item.amount)}</td>
        <td>${escapeHtml(item.balance_after)}</td></tr>`).join("");
      const paymentRows = payments.map((payment) => `<tr>
        <td>${escapeHtml(new Date(payment.createdAt).toLocaleString("ru-RU"))}</td>
        <td>${escapeHtml(payment.tariffName || payment.description)}</td><td>${escapeHtml(rubles(payment.amountMinor))}</td>
        <td>${escapeHtml(statusLabels[payment.status] || payment.status)}</td>
        <td class="optional">${payment.receipts?.length
          ? payment.receipts.map((receipt) => escapeHtml(receipt.status === "succeeded" ? "Чек выдан" : "Чек формирует Robokassa")).join("<br>")
          : "—"}</td>
        <td>${payment.refundable && paymentConfig.password3 ? `<form method="post" action="/app/payments/${escapeHtml(payment.id)}/refund">
          <input type="hidden" name="idempotencyKey" value="${randomUUID()}"><button class="secondary" type="submit">Вернуть</button></form>` : ""}</td>
      </tr>`).join("");
      return response.type("html").send(page(`${navigation}${returnNotice(request.query)}
        <h1>Баланс и тарифы</h1><section class="card"><p class="muted">Доступно</p>
          <p class="balance">${escapeHtml(creditsLabel(wallet.balance))}</p></section>
        <h2>Пакеты кредитов</h2><div class="grid">${tariffs}</div>
        <p class="muted">Цена и количество кредитов загружаются из единого серверного справочника.</p>
        ${paymentConfig?.enabled ? "" : '<p class="notice">Платежи временно выключены. Неработающая оплата пользователю не показывается.</p>'}
        <h2>Стоимость действий</h2><div class="table-wrap"><table><tbody>${actions}</tbody></table></div>
        ${paymentConfig?.enabled ? `<h2>Платежи и чеки</h2><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Пакет</th><th>Сумма</th><th>Статус</th><th class="optional">Чек</th><th></th></tr></thead><tbody>${paymentRows || '<tr><td colspan="6">Платежей пока нет</td></tr>'}</tbody></table></div>` : ""}
        <h2>История баланса</h2><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Операция</th><th>Изменение</th><th>Баланс</th></tr></thead><tbody>${walletRows}</tbody></table></div>`));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
