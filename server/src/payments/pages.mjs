import express from "express";
import { createRequireSession } from "../auth/http.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function legalPage(title, body, config) {
  const merchant = config.merchantName
    ? `<p><strong>Исполнитель:</strong> ${escapeHtml(config.merchantName)}, ${escapeHtml(config.merchantStatus)}, ИНН ${escapeHtml(config.merchantInn)}.<br>
       <strong>Email:</strong> ${escapeHtml(config.merchantEmail)}</p>`
    : "<p><strong>Оплата отключена.</strong> Реквизиты исполнителя будут опубликованы до включения приёма платежей.</p>";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)} — ВИЖУФАСАД</title><style>:root{font-family:Inter,system-ui,sans-serif;color:#17201b;background:#f5f6f2}body{margin:0}main{max-width:780px;margin:auto;padding:36px 20px;line-height:1.6}a{color:#176b46}section{background:#fff;padding:24px;border-radius:16px}h1,h2{line-height:1.2}</style></head>
    <body><main><p><a href="/">← На главную</a></p><section><h1>${escapeHtml(title)}</h1>${merchant}${body}</section></main></body></html>`;
}

function sameOrigin(request, config) {
  const origin = request.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(config.siteOrigin).origin; } catch { return false; }
}

export function createPaymentPagesRouter({ authService, paymentService, config }) {
  const router = express.Router();
  const requireHtmlSession = createRequireSession(authService, { html: true });
  router.post("/app/payments/checkout", express.urlencoded({ extended: false, limit: "8kb" }), requireHtmlSession, async (request, response, next) => {
    try {
      if (!sameOrigin(request, config)) return response.status(403).send("Недопустимый источник запроса");
      const result = await paymentService.createCheckout(request.auth, request.body, request.body.idempotencyKey);
      if (!result.checkout) return response.redirect(303, `/app/balance?payment=${result.payment.id}`);
      return response.redirect(303, result.checkout.url);
    } catch (error) {
      if (error?.code) return response.redirect(303, `/app/balance?payment_error=${encodeURIComponent(error.code)}`);
      return next(error);
    }
  });
  router.post("/app/payments/:id/refund", express.urlencoded({ extended: false, limit: "8kb" }), requireHtmlSession, async (request, response, next) => {
    try {
      if (!sameOrigin(request, config)) return response.status(403).send("Недопустимый источник запроса");
      await paymentService.refund(request.auth.user_id, request.params.id, { reason: "customer_request" }, request.body.idempotencyKey);
      return response.redirect(303, "/app/balance?refund=pending");
    } catch (error) {
      if (error?.code) return response.redirect(303, `/app/balance?payment_error=${encodeURIComponent(error.code)}`);
      return next(error);
    }
  });
  router.get("/legal/offer", (_request, response) => response.type("html").send(legalPage(
    "Публичная оферта на оказание цифровых услуг",
    `<p><strong>Редакция от 8 августа 2026 года.</strong> Настоящий документ является предложением заключить договор оказания цифровых услуг. Оплата означает полное и безоговорочное принятие условий оферты.</p>
     <h2>1. Предмет услуги</h2><p>Пользователь приобретает кредиты для самостоятельного автоматического создания концептуальных визуализаций фасада по загруженной фотографии. Сервис не предоставляет услуги дизайнера или оператора. Результат не является строительным проектом, чертежом, сметой или расчётом материалов.</p>
     <h2>2. Стоимость и оплата</h2><p>Действующие цена пакета и количество кредитов показываются до перехода в Robokassa и определяются серверным тарифным справочником. Карты и иные платёжные реквизиты обрабатывает Robokassa; ВИЖУФАСАД их не получает и не хранит. Подписка и автоматическое продление не предлагаются.</p>
     <h2>3. Исполнение</h2><p>Кредиты начисляются после подписанного серверного подтверждения оплаты Robokassa. Возврат браузера на сайт сам по себе не подтверждает оплату. Услуга по конкретной генерации считается начатой после её запуска пользователем и оказанной после предоставления прошедшего автоматический контроль результата.</p>
     <h2>4. Требования к исходным данным</h2><p>Пользователь подтверждает право использовать загружаемые фотографии и обязан не передавать незаконные материалы. Возможность сохранить геометрию зависит от качества исходного снимка; непригодное фото отклоняется автоматической проверкой без списания кредита.</p>
     <h2>5. Ошибки и возвраты</h2><p>При подтверждённой технической неудаче генерации списанный кредит автоматически возвращается во внутренний кошелёк. Условия денежного возврата неиспользованного пакета опубликованы на странице <a href="/legal/refunds">«Возвраты»</a>. Статус возврата и сведения о чеке доступны в истории платежей.</p>
     <h2>6. Чеки и обращения</h2><p>Чек формируется через Robokassa для плательщика НПД и направляется по контактным данным покупателя. Обращение по оплате или качеству услуги направляется на email Исполнителя, указанный выше.</p>
     <h2>7. Заключительные положения</h2><p>К отношениям сторон применяется законодательство Российской Федерации. Актуальная редакция оферты постоянно доступна по этому адресу до оплаты.</p>`,
    config,
  )));
  router.get("/legal/privacy", (_request, response) => response.type("html").send(legalPage(
    "Конфиденциальность и платёжные данные",
    `<p>Сервис хранит только внутренний идентификатор платежа, выбранный тариф, сумму, статус, служебный способ оплаты и сведения о чеке. Номер карты, CVC и иные платёжные реквизиты в ВИЖУФАСАД не передаются.</p>
     <p>Данные используются для исполнения покупки, выдачи чека, предотвращения дублей, возврата и обязательного учёта.</p>`,
    config,
  )));
  router.get("/legal/refunds", (_request, response) => response.type("html").send(legalPage(
    "Условия возврата",
    `<p>Запрос полного возврата доступен для оплаченного пакета, если приобретённые по нему кредиты ещё находятся на балансе. После запуска генераций за эти кредиты автоматический возврат может быть недоступен.</p>
     <p>При подтверждённой технической неудаче генерации сервис автоматически возвращает кредит в кошелёк; это не является денежным возвратом покупки.</p>
     <p>Денежный возврат выполняется через Robokassa тем же способом оплаты. Статус и чек возврата отображаются в истории.</p>`,
    config,
  )));
  return router;
}
