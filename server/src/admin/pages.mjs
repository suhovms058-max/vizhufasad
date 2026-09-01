import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "../auth/http.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function sameOrigin(request, siteOrigin) {
  const origin = request.get("origin");
  const fetchSite = String(request.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "same-origin" || !origin) return true;
  try { return new URL(origin).origin === new URL(siteOrigin).origin; } catch { return false; }
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}

const statusLabel = Object.freeze({
  completed: "Готово", created: "Создано", queued: "В очереди", preprocessing: "Подготовка",
  generating: "Генерация", quality_check_pending: "Проверка", retrying: "Повтор",
  qa_queued: "Проверка", qa_failed_retrying: "Повтор проверки", failed_refunded: "Ошибка, возврат",
  failed_terminal: "Ошибка", cancelled: "Отменено",
});

function adminPage(data, { issuedCode = null, error = null } = {}) {
  const generationRows = data.generations.map((item) => `<tr>
    <td>${escapeHtml(formatDate(item.created_at))}</td><td>${escapeHtml(item.project_title || "Без названия")}</td>
    <td>${escapeHtml(item.user_reference)}</td><td>${escapeHtml(item.kind)}</td>
    <td>${escapeHtml(statusLabel[item.status] || item.status)}${item.failure_code ? `<br><small>${escapeHtml(item.failure_code)}</small>` : ""}</td>
    <td>${escapeHtml(item.provider || "—")}<br><small>${escapeHtml(item.model || "")}</small></td>
    <td>${item.resultUrl ? `<a href="${escapeHtml(item.resultUrl)}" target="_blank" rel="noopener"><img class="admin-result-thumb" src="${escapeHtml(item.resultUrl)}" alt="Результат генерации"></a>` : "—"}</td>
  </tr>`).join("");
  const codeRows = data.partnerCodes.map((item) => `<tr>
    <td>…${escapeHtml(item.code_suffix)}</td><td>${escapeHtml(item.credits)}</td>
    <td>${escapeHtml(item.contract_reference)}</td><td>${escapeHtml(item.partner_name || "—")}</td>
    <td>${escapeHtml(item.recipient_email_masked || "—")}</td>
    <td>${item.redeemed_at ? "Погашен" : item.is_active ? "Активен" : "Отключён"}</td>
    <td>${escapeHtml(formatDate(item.expires_at))}</td><td>${escapeHtml(item.redeemed_user_reference || "—")}</td>
  </tr>`).join("");
  const pager = Number(data.pageCount || 1) > 1 ? `<nav class="admin-pager" aria-label="Страницы работ">
    ${data.page > 1 ? `<a class="button secondary" href="/app/admin?page=${data.page - 1}">← Новее</a>` : ""}
    <span>Страница ${escapeHtml(data.page)} из ${escapeHtml(data.pageCount)}</span>
    ${data.page < data.pageCount ? `<a class="button secondary" href="/app/admin?page=${data.page + 1}">Старше →</a>` : ""}
  </nav>` : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark"><title>Администрирование — ВИЖУФАСАД</title>
  <link rel="shortcut icon" href="/favicon-32x32.png"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/app-ui.css"></head><body>
  <header class="app-header"><a class="brand brand-home" href="/"><span>ВИЖУФАСАД</span></a><nav><a href="/app">Проекты</a><a href="/app/balance">Баланс</a><a href="/app/admin" aria-current="page">Админка</a></nav></header>
  <main class="app-main admin-main"><section class="page-heading"><div><p class="eyebrow">Закрытый раздел владельца</p><h1>Работы и партнёрские коды</h1><p class="muted">Полные коды не хранятся и после выпуска показываются только один раз.</p></div></section>
  ${error ? `<div class="notice error" role="alert">${escapeHtml(error)}</div>` : ""}
  ${issuedCode ? `<section class="notice success admin-issued-code"><strong>Новый код создан</strong><code>${escapeHtml(issuedCode)}</code><p>Скопируйте его сейчас и внесите в договор/реестр. Позже сервис покажет только последние четыре символа.</p></section>` : ""}
  <section class="admin-stats"><article class="panel"><span>Всего</span><strong>${escapeHtml(data.stats.total)}</strong></article><article class="panel"><span>Готово</span><strong>${escapeHtml(data.stats.completed)}</strong></article><article class="panel"><span>В работе</span><strong>${escapeHtml(data.stats.active)}</strong></article><article class="panel"><span>Ошибки/возвраты</span><strong>${escapeHtml(data.stats.failed)}</strong></article></section>
  <section class="panel admin-code-create"><div><p class="eyebrow">Новый договор</p><h2>Выпустить партнёрский код</h2><p class="muted">Номинал начисляется целиком и один раз. После активации аккаунт получает все возможности тарифа «Максимум» на указанный срок.</p></div>
    <form method="post" action="/app/admin/partner-codes">
      <div class="owner-partner-fields"><label>Номинал, ВФ-коинов<input name="credits" type="number" min="1" max="100000" step="1" required></label>
      <label>Договор №<input name="contractReference" maxlength="160" required></label>
      <label>Партнёр / организация<input name="partnerName" maxlength="240"></label>
      <label>Email получателя<input name="recipientEmail" type="email" maxlength="254" autocomplete="off" required></label>
      <label>Активировать и использовать до<input name="expiresAt" type="date"></label></div>
      <p><button type="submit">Сгенерировать и активировать код</button></p>
    </form></section>
  <section><h2>Партнёрские коды</h2><div class="table-wrap"><table><thead><tr><th>Код</th><th>Номинал</th><th>Договор</th><th>Партнёр</th><th>Email</th><th>Статус</th><th>До</th><th>Аккаунт</th></tr></thead><tbody>${codeRows || '<tr><td colspan="8">Кодов пока нет</td></tr>'}</tbody></table></div></section>
  <section><h2>Все работы</h2><p class="muted">По 50 работ на странице. Короткие ссылки на приватные результаты действуют не более пяти минут.</p><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Проект</th><th>Аккаунт</th><th>Тип</th><th>Статус</th><th>Модель</th><th>Результат</th></tr></thead><tbody>${generationRows || '<tr><td colspan="7">Работ пока нет</td></tr>'}</tbody></table></div>${pager}</section>
  </main><footer class="app-footer"><a href="/legal">Правовая информация</a><a href="/app/balance">Баланс</a></footer></body></html>`;
}

function registerError(code) {
  return ({
    PARTNER_CREDITS_INVALID: "Укажите целое положительное количество ВФ-коинов.",
    PARTNER_CONTRACT_REQUIRED: "Укажите номер или ссылку на договор.",
    PARTNER_EXPIRY_INVALID: "Срок действия должен быть будущей датой.",
    PARTNER_EMAIL_INVALID: "Укажите корректный email аккаунта получателя.",
  })[code] || "Код создать не удалось.";
}

export function createAdminPagesRouter({
  authService, ownerAccessService, partnerCreditService, adminService, siteOrigin,
}) {
  const router = express.Router();
  const requireSession = createRequireSession(authService, { html: true });
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  const requireOwner = async (request, response, next) => {
    try {
      const status = await ownerAccessService.status(request.auth.user_id);
      if (!status.eligible) return response.status(404).send("Страница не найдена");
      return next();
    } catch (error) { return next(error); }
  };
  router.get("/app/admin", requireSession, requireOwner, async (request, response, next) => {
    try { return response.type("html").send(adminPage(await adminService.dashboard(request.query.page))); }
    catch (error) { return next(error); }
  });
  router.post("/app/admin/partner-codes", limiter, express.urlencoded({ extended: false, limit: "8kb" }), requireSession, requireOwner, async (request, response, next) => {
    try {
      if (!sameOrigin(request, siteOrigin)) return response.status(403).send("Недопустимый источник запроса");
      const registered = await partnerCreditService.register(request.body);
      return response.status(201).type("html").send(adminPage(await adminService.dashboard(), { issuedCode: registered.issuedCode }));
    } catch (error) {
      if (error?.code) return response.status(error.status || 400).type("html").send(adminPage(await adminService.dashboard(), { error: registerError(error.code) }));
      return next(error);
    }
  });
  return router;
}
