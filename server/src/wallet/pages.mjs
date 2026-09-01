import { randomUUID } from "node:crypto";
import express from "express";
import { createRequireSession } from "../auth/http.mjs";
import { legalDocument } from "../legal/documents.mjs";

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

function vfCoinsLabel(value) {
  const amount = Number(value);
  const mod100 = amount % 100;
  const mod10 = amount % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? "ВФ-коинов"
    : mod10 === 1 ? "ВФ-коин" : mod10 >= 2 && mod10 <= 4 ? "ВФ-коина" : "ВФ-коинов";
  return `${amount} ${noun}`;
}

function generationLimitLabel(value) {
  const amount = Number(value);
  const mod100 = amount % 100;
  const mod10 = amount % 10;
  const noun = mod10 === 1 && !(mod100 >= 11 && mod100 <= 14) ? "генерации" : "генераций";
  return `${amount} ${noun}`;
}

function actionLabel(action) {
  return ({
    standard_generation: "Генерация фасада",
    pro_generation: "Pro-генерация",
    text_revision: "Текстовая доработка",
    upscale_4k: "Подготовка 4K",
    photo_assessment: "Проверка фото",
    download: "Скачивание",
  })[action.code] || action.name;
}

const PACKAGE_BENEFITS = Object.freeze({
  START: ["4 популярных стиля и автоподбор", "Подходящие материалы", "Обычные генерации с автопроверкой"],
  OPTIMUM: ["7 стилей и расширенный выбор материалов", "Pro-генерация", "Сравнение до четырёх решений"],
  MAXIMUM: ["Все 10 стилей и все материалы", "Pro и точечные доработки готового варианта", "Сравнение и подготовка 4K"],
});

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
  <meta name="color-scheme" content="dark"><title>Баланс и тарифы — ВИЖУФАСАД</title>
  <link rel="shortcut icon" href="/favicon-32x32.png"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32"><link rel="stylesheet" href="/assets/app-ui.css"></head><body><a class="skip-link" href="#main">К содержанию</a>
  <header class="app-header"><a class="brand brand-home" href="/" aria-label="Вернуться на главную страницу"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9M9.5 19v-5h5v5"/></svg><span>ВИЖУФАСАД</span></a><nav aria-label="Основная навигация">
  <a href="/app">Мои проекты</a><a href="/app/new">Новый проект</a><a href="/app/balance" aria-current="page">Баланс</a><a href="/app/settings">Настройки</a></nav></header>
  <main id="main" class="app-main">${body}</main><footer class="app-footer"><a href="/legal">Правовая информация</a><a href="/legal/offer">Оплата</a><a href="/legal/privacy">Конфиденциальность</a><button type="button" class="link-button" data-privacy-settings>Настройки конфиденциальности</button></footer><script src="/assets/product-analytics.js" defer></script></body></html>`;
}

function returnNotice(query) {
  if (query.payment_error) {
    const messages = {
      PROMO_NOT_AVAILABLE: "Промокод недействителен или срок его действия закончился.",
      PROMO_ALREADY_USED: "Этот промокод уже был использован вашим аккаунтом.",
      PROMO_LIMIT_REACHED: "Лимит применений промокода исчерпан.",
      OFFER_ACCEPTANCE_REQUIRED: "Перед оплатой необходимо отдельно принять актуальную публичную оферту.",
      INSUFFICIENT_CREDITS: "Автоматический возврат не рассчитан для частично использованного пакета. Направьте требование через раздел «Правовая информация» — право на обращение сохраняется.",
      REFUND_OPERATION_KEY_UNAVAILABLE: "Автоматический возврат ещё недоступен: Robokassa не передала идентификатор операции.",
    };
    return `<div class="notice error" role="alert">${escapeHtml(messages[query.payment_error] || "Операцию выполнить не удалось. Баланс не изменён.")}</div>`;
  }
  if (query.payment_cancel === "ok") {
    return '<div class="notice success" role="status">Платёжный сеанс отменён. Можно запустить новую оплату.</div>';
  }
  if (query.refund === "pending") {
    return '<div class="notice success" role="status">Запрос возврата передан в Robokassa. Итоговый статус появится в истории.</div>';
  }
  if (!query.payment_return) return "";
  const failed = query.payment_return === "fail";
  return `<div class="notice ${failed ? "error" : "success"}" role="status">
    ${failed
      ? "Платёж не завершён. ВФ-коины не начислялись."
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
      const standardCost = Number(catalog.actions.find((action) => action.code === "standard_generation")?.credits || 1);
      const requestedPlan = ["START", "OPTIMUM", "MAXIMUM"].includes(String(request.query.plan || "").toUpperCase())
        ? String(request.query.plan).toUpperCase()
        : "";
      const packagePlans = catalog.tariffs.filter((tariff) => !String(tariff.code || "").startsWith("TOPUP_") && Number(tariff.priceMinor) > 0);
      const topupPlans = catalog.tariffs.filter((tariff) => String(tariff.code || "").startsWith("TOPUP_"));
      const offer = legalDocument("offer");
      const checkoutForm = (tariff, buttonLabel = "Перейти к оплате") => paymentConfig?.enabled && tariff.priceMinor > 0 ? `<form method="post" action="/app/payments/checkout">
          <input type="hidden" name="tariffPlanId" value="${escapeHtml(tariff.id)}">
          <input type="hidden" name="idempotencyKey" value="${randomUUID()}">
          <input type="hidden" name="offerVersion" value="${escapeHtml(offer.revision)}">
          <input type="hidden" name="offerHash" value="${escapeHtml(offer.hash)}">
          <details class="promo-disclosure"><summary>Есть промокод?</summary>
            <div class="promo-disclosure-body"><label for="promo-${escapeHtml(tariff.id)}">Введите промокод</label>
            <input id="promo-${escapeHtml(tariff.id)}" name="promoCode" maxlength="32" autocomplete="off">
            <p class="muted">Промокоды предназначены для партнёров ресурса. Чтобы получить код, свяжитесь с администрацией сайта: <a href="mailto:vizhufasad0058@bk.ru">vizhufasad0058@bk.ru</a>.</p></div>
          </details>
          <label class="confirm consent-confirm"><input type="checkbox" name="offerAccepted" value="yes" required><span>Принимаю <a href="/legal/offer" target="_blank" rel="noopener">публичную оферту</a> редакции от 28 августа 2026 года</span></label>
          <p><button type="submit" data-analytics-event="payment_checkout_started" data-analytics-plan="${escapeHtml(tariff.code)}">${escapeHtml(buttonLabel)}</button></p></form>` : "";
      const tariffs = packagePlans.map((tariff) => `<article id="plan-${escapeHtml(tariff.code)}" class="panel tariff-card${requestedPlan === tariff.code ? " selected-plan" : ""}">
        ${requestedPlan === tariff.code ? '<p class="selected-plan-label">Вы выбрали этот пакет</p>' : ""}
        <h3>${escapeHtml(tariff.name)}</h3><p><strong>${escapeHtml(rubles(tariff.priceMinor))}</strong></p>
        <p class="tariff-outcome"><strong>До ${escapeHtml(generationLimitLabel(Math.floor(tariff.credits / standardCost)))}</strong><br>
        <span class="muted">${escapeHtml(vfCoinsLabel(tariff.credits))} в пакете</span></p>
        <ul class="tariff-benefits">${(PACKAGE_BENEFITS[tariff.code] || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        ${checkoutForm(tariff)}
      </article>`).join("");
      const topups = topupPlans.map((tariff) => `<article class="panel tariff-card topup-card">
        <h3>${escapeHtml(vfCoinsLabel(tariff.credits))}</h3>
        <p><strong>${escapeHtml(rubles(tariff.priceMinor))}</strong></p>
        <p class="muted">Когда до нужного действия не хватает нескольких ВФ-коинов. Пополнение не меняет доступный набор стилей и инструментов.</p>
        ${checkoutForm(tariff, "Пополнить баланс")}
      </article>`).join("");
      const actions = catalog.actions.map((action) => `<tr><td>${escapeHtml(actionLabel(action))}</td>
        <td>${action.credits === 0 ? "Бесплатно" : escapeHtml(vfCoinsLabel(action.credits))}</td></tr>`).join("");
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
        <td>${(() => {
          const actions = [];
          if (payment.refundable && paymentConfig.password3) {
            actions.push(`<form method="post" action="/app/payments/${escapeHtml(payment.id)}/refund">
          <input type="hidden" name="idempotencyKey" value="${randomUUID()}"><button class="secondary" type="submit">Вернуть всю оплату</button></form>`);
          }
          if (payment.status === "paid") {
            const subject = encodeURIComponent(`Возврат ВИЖУФАСАД — платёж ${payment.id}`);
            const body = encodeURIComponent(`Прошу рассмотреть возврат по платежу ${payment.id}.\nУкажите причину и желаемую сумму возврата:`);
            actions.push(`<a class="button secondary" href="mailto:vizhufasad0058@bk.ru?subject=${subject}&body=${body}">Запросить частичный или иной возврат</a>`);
          }
          if (["created", "pending", "failed"].includes(payment.status)) {
            actions.push(`<form method="post" action="/app/payments/${escapeHtml(payment.id)}/cancel">
              <button class="secondary" type="submit">Отменить</button></form>`);
          }
          return actions.length ? actions.join(" ") : "";
        })()}</td>
      </tr>`).join("");
      return response.type("html").send(page(`${returnNotice(request.query)}
        <section class="page-heading"><div><p class="eyebrow">Продолжение работы</p><h1>Получите ещё варианты фасада</h1><p class="muted">Первый результат уже показал возможности сервиса. Выберите пакет для серии решений или добавьте несколько отдельных ВФ-коинов.</p></div></section>
        <section class="panel balance-card"><p class="muted">Доступно</p>
          <p class="balance-value">${escapeHtml(vfCoinsLabel(wallet.balance))}</p></section>
        ${requestedPlan ? `<div class="notice success" role="status">Выбранный на главной пакет выделен ниже. Проверьте состав и переходите к оплате.</div>` : ""}
        <section class="purchase-choice" aria-label="Способы продолжить работу"><div><strong>Пакет</strong><span>Выгоднее для нескольких вариантов одного или разных домов.</span></div><div><strong>Отдельные ВФ-коины</strong><span>Когда нужна ещё одна, две или три генерации.</span></div></section>
        <h2>Пакеты для нескольких вариантов</h2><p class="muted">Обычная генерация фасада стоит ${escapeHtml(vfCoinsLabel(standardCost))}. Перед каждым платным действием сервис показывает точную стоимость.</p><div class="tariff-grid">${tariffs}</div>
        ${topups ? `<section id="topups" class="topup-section"><h2>Добавить ВФ-коины</h2><p class="muted">Точечное пополнение удобно, когда немного не хватает. Пакеты остаются выгоднее по цене одного ВФ-коина.</p><div class="tariff-grid topup-grid">${topups}</div></section>` : ""}
        <p class="muted">Цена и количество ВФ-коинов загружаются из единого серверного справочника.</p>
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
