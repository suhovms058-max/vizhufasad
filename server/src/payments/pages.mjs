import express from "express";
import { createRequireSession } from "../auth/http.mjs";
import {
  PHOTO_PROCESSING_CONSENT_PATH, PHOTO_PROCESSING_CONSENT_VERSION,
} from "../legal/photo-consent.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function cleanLegalValue(value) {
  return String(value ?? "")
    .split(/\s+LEGAL_MERCHANT_[A-Z_]+=/u, 1)[0]
    .trim()
    .replace(/^["']|["';]+$/gu, "")
    .trim();
}

function legalPage(title, body, config) {
  const merchant = config.merchantName
    ? `<p><strong>Исполнитель:</strong> ${escapeHtml(cleanLegalValue(config.merchantName))}, ${escapeHtml(cleanLegalValue(config.merchantStatus))}, ИНН ${escapeHtml(cleanLegalValue(config.merchantInn))}.<br>
       <strong>Email:</strong> ${escapeHtml(cleanLegalValue(config.merchantEmail))}</p>`
    : "<p><strong>Оплата отключена.</strong> Реквизиты исполнителя будут опубликованы до включения приёма платежей.</p>";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark"><title>${escapeHtml(title)} — ВИЖУФАСАД</title><link rel="stylesheet" href="/assets/app-ui.css"></head>
    <body><a class="skip-link" href="#main">К содержанию</a><header class="app-header"><a class="brand brand-home" href="/" aria-label="Вернуться на главную страницу"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9M9.5 19v-5h5v5"/></svg><span>ВИЖУФАСАД</span></a>
    <nav aria-label="Основная навигация"><a href="/">На главную</a><a href="/auth/login">Войти</a></nav></header>
    <main id="main" class="app-main app-main-legal"><article class="panel legal-content"><p class="eyebrow">Правовая информация</p>
    <h1>${escapeHtml(title)}</h1>${merchant}${body}</article></main><footer class="app-footer"><a href="/legal/offer">Условия оплаты</a>
    <a href="/legal/privacy">Конфиденциальность</a><a href="${PHOTO_PROCESSING_CONSENT_PATH}">Согласие на обработку фото</a>
    <a href="/legal/refunds">Возвраты</a></footer><script src="/assets/product-analytics.js" defer></script></body></html>`;
}

function sameOrigin(request, config) {
  const origin = request.get("origin");
  const fetchSite = String(request.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "same-origin") return true;
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
  router.post("/app/payments/:id/cancel", express.urlencoded({ extended: false, limit: "8kb" }), requireHtmlSession, async (request, response, next) => {
    try {
      if (!sameOrigin(request, config)) return response.status(403).send("Недопустимый источник запроса");
      await paymentService.cancel(request.auth.user_id, request.params.id);
      return response.redirect(303, "/app/balance?payment_cancel=ok");
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
    "Политика обработки данных и фотографий",
    `<p><strong>Редакция от 22 августа 2026 года.</strong> Сервис обрабатывает email учётной записи, технические данные сессии, сведения о проектах и оплатах, а также загруженные пользователем фотографии.</p>
     <h2>Цели обработки</h2><p>Данные используются для входа, хранения проектов, технической проверки фотографии, автоматической генерации и проверки визуализации, начисления кредитов, оплаты, возвратов, выдачи чеков и защиты от злоупотреблений.</p>
     <h2>Фотографии</h2><p>Исходное фото загружается напрямую в приватное S3-совместимое хранилище по временной ссылке. Сервис удаляет EXIF из рабочей копии, создаёт миниатюру и передаёт изображение настроенным AI-провайдерам только для автоматической оценки и создания заказанной визуализации. Постоянные публичные ссылки не создаются.</p>
     <p>Текущий AI-шлюз генерации — GenAPI (ООО «ИНФИМУМ»). Для отдельных автоматических проверок могут использоваться настроенные российские облачные AI-сервисы. Актуальный состав обработчиков должен поддерживаться в этой политике при изменении production-конфигурации.</p>
     <h2>Срок хранения и удаление</h2><p>Фотографии хранятся, пока нужен пользовательский проект. При замене фото старые объекты удаляются; при удалении проекта объекты удаляются сразу, а служебные метаданные удалённого проекта по умолчанию хранятся до 30 дней. Незавершённые загрузки очищаются автоматически, по умолчанию через 24 часа.</p>
     <h2>Платёжные данные</h2><p>Сервис хранит внутренний идентификатор платежа, тариф, сумму, статус и сведения о чеке. Номер карты, CVC и иные платёжные реквизиты обрабатывает Robokassa; ВИЖУФАСАД их не получает и не хранит.</p>
     <h2>Права пользователя</h2><p>Пользователь может удалить проект в кабинете, запросить удаление аккаунта или отозвать согласие по email Исполнителя. Отзыв не отменяет обработку, которая уже законно выполнена до его получения, и может сделать дальнейшую генерацию невозможной.</p>
     <p>Перед каждой новой загрузкой пользователь отдельно подтверждает <a href="${PHOTO_PROCESSING_CONSENT_PATH}">согласие на обработку фотографии</a>.</p>`,
    config,
  )));
  router.get(PHOTO_PROCESSING_CONSENT_PATH, (_request, response) => response.type("html").send(legalPage(
    "Согласие на обработку фотографии и содержащихся в ней данных",
    `<p><strong>Версия ${PHOTO_PROCESSING_CONSENT_VERSION}.</strong> Этот документ подтверждается отдельно от оферты и иных условий сервиса.</p>
     <p>Устанавливая отдельную отметку перед загрузкой, пользователь свободно, конкретно, информированно и однозначно соглашается на автоматизированную обработку загружаемой фотографии для технической проверки и создания заказанных концептуальных визуализаций фасада.</p>
     <h2>Какие данные и действия охватывает согласие</h2><p>Фотография дома и содержащиеся в ней сведения; сбор, запись, приватное хранение, извлечение, техническая проверка, очистка метаданных, преобразование формата, создание рабочей копии и миниатюры, передача настроенным AI-провайдерам, получение результата, блокирование, удаление и уничтожение.</p>
     <h2>Кому поручается техническая обработка</h2><p>Провайдерам приватного S3-совместимого хранилища и AI-сервисам, которые оператор использует для автоматической оценки и генерации. Текущий шлюз генерации — GenAPI (ООО «ИНФИМУМ»). Категории и сроки обработки раскрыты в <a href="/legal/privacy">политике обработки данных</a>.</p>
     <h2>Срок и отзыв</h2><p>Согласие действует до достижения указанных целей, удаления проекта или его отзыва пользователем, если иной срок хранения не требуется по закону. Отозвать согласие можно по email Исполнителя. После отзыва новые операции с фотографией прекращаются, а дальнейшее оказание функции визуализации может стать невозможным.</p>
     <p>Пользователь отдельно подтверждает, что вправе использовать загружаемое изображение и не нарушает права третьих лиц.</p>`,
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
