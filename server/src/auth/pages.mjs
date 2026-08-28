import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "./http.mjs";
import { AGE_CONFIRMATION, legalDocument } from "../legal/documents.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeNext(value, fallback = "/app") {
  const path = String(value || "");
  return path.startsWith("/app") && !path.startsWith("//") && !path.includes("\\") ? path : fallback;
}

function page(title, body, { cabinet = false, narrow = false } = {}) {
  const navigation = cabinet
    ? `<nav aria-label="Основная навигация"><a href="/app">Мои проекты</a><a href="/app/new">Новый проект</a>
       <a href="/app/balance">Баланс</a><a href="/app/settings">Настройки</a></nav>`
    : `<nav aria-label="Основная навигация"><a href="/">На главную</a></nav>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">
    <title>${escapeHtml(title)} — ВИЖУФАСАД</title><link rel="stylesheet" href="/assets/app-ui.css"></head><body>
    <a class="skip-link" href="#main">К содержанию</a><header class="app-header"><a class="brand brand-home" href="/" aria-label="Вернуться на главную страницу"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9M9.5 19v-5h5v5"/></svg><span>ВИЖУФАСАД</span></a>${navigation}</header>
    <main id="main" class="app-main${narrow ? " app-main-narrow" : ""}">${body}</main>
    <footer class="app-footer"><a href="/legal">Правовая информация</a><a href="/legal/offer">Оплата</a><a href="/legal/privacy">Конфиденциальность</a><button type="button" class="link-button" data-privacy-settings>Настройки конфиденциальности</button></footer>
    <script src="/assets/product-analytics.js" defer></script>
    </body></html>`;
}

function loginForm(message = "", nextPath = "/app") {
  const next = safeNext(nextPath);
  return page("Вход", `<section class="panel auth-card"><p class="eyebrow">Личный кабинет</p><h1>Вход по email</h1>
    ${message ? `<p class="notice error" role="alert">${escapeHtml(message)}</p>` : ""}
    <p class="muted">Получите одноразовый код. Пароль и телефон не требуются.</p>
    <form class="form-stack" method="post" action="/auth/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><label>Email
      <input name="email" type="email" autocomplete="email" inputmode="email" required maxlength="254" placeholder="name@example.ru"></label>
      <button type="submit">Получить код</button></form></section>`, { narrow: true });
}

export function createAuthPagesRouter({ service, config }) {
  const router = express.Router();
  const requireSession = createRequireSession(service, { html: true });
  const requestLimiter = rateLimit({
    windowMs: config.rateWindowMs,
    limit: config.requestLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const verifyLimiter = rateLimit({
    windowMs: config.rateWindowMs,
    limit: config.verifyLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));

  router.get("/login", (_request, response) => response.redirect(302, "/auth/login"));
  router.get("/auth/login", (request, response) => response.type("html").send(loginForm("", request.query.next)));
  router.post("/auth/login", requestLimiter, async (request, response, next) => {
    try {
      const result = await service.requestCode(request.body?.email, {
        ip: request.ip, userAgent: request.get("user-agent"),
      });
      const next = safeNext(request.body?.next);
      return response.redirect(303, `/auth/verify?challenge=${encodeURIComponent(result.challengeId)}&next=${encodeURIComponent(next)}`);
    } catch (error) {
      if (error.message === "INVALID_EMAIL") {
        return response.status(400).type("html").send(loginForm("Проверьте адрес email.", request.body?.next));
      }
      return next(error);
    }
  });

  const verificationPage = (challenge, next, message = "") => {
    const agreement = legalDocument("user-agreement");
    const personalData = legalDocument("personal-data-consent");
    return page("Подтверждение входа", `<section class="panel auth-card">
      <p class="eyebrow">Безопасный вход</p><h1>Введите код</h1><p class="muted">Шестизначный код отправлен на ваш email.</p>
      ${message ? `<p class="notice error" role="alert">${escapeHtml(message)}</p>` : ""}
      <form class="form-stack" method="post" action="/auth/verify"><input type="hidden" name="challengeId" value="${escapeHtml(challenge)}"><input type="hidden" name="next" value="${escapeHtml(next)}">
      <label>Код <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <input type="hidden" name="agreementVersion" value="${agreement.revision}"><input type="hidden" name="agreementHash" value="${agreement.hash}">
      <input type="hidden" name="personalDataVersion" value="${personalData.revision}"><input type="hidden" name="personalDataHash" value="${personalData.hash}">
      <input type="hidden" name="ageVersion" value="${AGE_CONFIRMATION.revision}"><input type="hidden" name="ageHash" value="${AGE_CONFIRMATION.hash}">
      <label class="confirm consent-confirm"><input type="checkbox" name="agreementAccepted" value="yes" required> Принимаю <a href="/legal/user-agreement" target="_blank" rel="noopener">Пользовательское соглашение</a></label>
      <label class="confirm consent-confirm"><input type="checkbox" name="ageConfirmed" value="yes" required> Подтверждаю, что мне исполнилось 18 лет</label>
      <label class="confirm consent-confirm"><input type="checkbox" name="personalDataAccepted" value="yes" required> Даю отдельное <a href="/legal/personal-data-consent" target="_blank" rel="noopener">согласие на обработку персональных данных</a></label>
      <button type="submit">Войти</button></form><p><a href="/auth/login">Запросить новый код</a></p></section>`, { narrow: true });
  };
  router.get("/auth/verify", (request, response) => {
    const challenge = String(request.query.challenge || "");
    const next = safeNext(request.query.next);
    response.type("html").send(verificationPage(challenge, next));
  });
  router.post("/auth/verify", verifyLimiter, async (request, response, next) => {
    try {
      const result = await service.verifyCode(request.body || {}, {
        ip: request.ip, userAgent: request.get("user-agent"),
      });
      if (!result.ok) {
        if (result.reason === "LEGAL_CONSENT_REQUIRED") {
          return response.status(400).type("html").send(verificationPage(
            String(request.body?.challengeId || ""), safeNext(request.body?.next),
            "Для создания аккаунта и входа нужны три отдельные подтверждения ниже.",
          ));
        }
        if (result.reason === "ACCOUNT_UNAVAILABLE") {
          return response.status(403).type("html").send(page("Вход недоступен", "<p>Аккаунт недоступен.</p>"));
        }
        return response.status(401).type("html").send(page("Код не принят", '<p role="alert">Код неверен, истёк или уже использован.</p><p><a href="/auth/login">Запросить новый код</a></p>'));
      }
      response.cookie(config.cookieName, result.token, service.cookieOptions());
      return response.redirect(303, safeNext(request.body?.next));
    } catch (error) {
      return next(error);
    }
  });

  router.use("/app", requireSession);
  const navigation = `<nav><a href="/app">Мои проекты</a> ·
    <a href="/app/balance">Баланс и тарифы</a> · <a href="/app/settings">Настройки</a></nav>`;
  router.get(["/app", "/app/projects"], (request, response) => response.type("html").send(page(
    "Мои проекты",
    `${navigation}<p>Проектов пока нет.</p><p>Здесь появятся автоматические визуализации фасада.</p>`,
    { cabinet: true },
  )));
  router.get("/app/settings", (request, response) => response.type("html").send(page(
    "Настройки",
    `<section class="page-heading"><div><p class="eyebrow">Аккаунт</p><h1>Настройки</h1></div></section>
     <section class="panel settings-panel"><p class="muted">Email</p><p><strong>${escapeHtml(request.auth.email)}</strong></p>
     <div class="actions"><form method="post" action="/app/logout"><button type="submit">Выйти</button></form>
     <form method="post" action="/app/account/delete" onsubmit="return confirm('Удалить аккаунт, проекты и файлы? Восстановить их будет невозможно.')"><button class="danger" type="submit">Удалить аккаунт и данные</button></form></div></section>`,
    { cabinet: true },
  )));
  router.post("/app/logout", async (request, response, next) => {
    try {
      await service.repository.revokeSession(request.auth.user_id, request.auth.id, "auth.logout");
      response.clearCookie(config.cookieName, service.clearCookieOptions());
      return response.redirect(303, "/auth/login");
    } catch (error) {
      return next(error);
    }
  });
  router.post("/app/account/delete", async (request, response, next) => {
    try {
      await service.repository.requestAccountDeletion(request.auth.user_id);
      response.clearCookie(config.cookieName, service.clearCookieOptions());
      return response.status(202).type("html").send(page(
        "Запрос на удаление принят",
        `<p>Запрос сохранён, все сессии отозваны. Проекты и их файлы поставлены на автоматическое удаление, а email аккаунта будет обезличен. Сведения о платежах, чеках, юридических акцептах и требованиях сохраняются только в объёме и на срок, необходимые по закону.</p><p>Если требуется уточнить запрос, напишите на <a href="mailto:vizhufasad0058@bk.ru">vizhufasad0058@bk.ru</a>.</p>`,
      ));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
