import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "./http.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function page(title, body, { cabinet = false, narrow = false } = {}) {
  const navigation = cabinet
    ? `<nav aria-label="Основная навигация"><a href="/app">Мои проекты</a><a href="/app/new">Новый проект</a>
       <a href="/app/balance">Баланс</a><a href="/app/settings">Настройки</a></nav>`
    : `<nav aria-label="Основная навигация"><a href="/">На главную</a></nav>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
    <title>${escapeHtml(title)} — ВИЖУФАСАД</title><link rel="stylesheet" href="/assets/app-ui.css"></head><body>
    <a class="skip-link" href="#main">К содержанию</a><header class="app-header"><a class="brand" href="/">ВИЖУФАСАД</a>${navigation}</header>
    <main id="main" class="app-main${narrow ? " app-main-narrow" : ""}">${body}</main>
    <footer class="app-footer"><a href="/legal/offer">Условия оплаты</a><a href="/legal/privacy">Конфиденциальность</a><a href="/legal/refunds">Возвраты</a></footer>
    </body></html>`;
}

function loginForm(message = "") {
  return page("Вход", `<section class="panel auth-card"><p class="eyebrow">Личный кабинет</p><h1>Вход по email</h1>
    ${message ? `<p class="notice error" role="alert">${escapeHtml(message)}</p>` : ""}
    <p class="muted">Получите одноразовый код. Пароль и телефон не требуются.</p>
    <form class="form-stack" method="post" action="/auth/login"><label>Email
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
  router.get("/auth/login", (_request, response) => response.type("html").send(loginForm()));
  router.post("/auth/login", requestLimiter, async (request, response, next) => {
    try {
      const result = await service.requestCode(request.body?.email, {
        ip: request.ip, userAgent: request.get("user-agent"),
      });
      return response.redirect(303, `/auth/verify?challenge=${encodeURIComponent(result.challengeId)}`);
    } catch (error) {
      if (error.message === "INVALID_EMAIL") {
        return response.status(400).type("html").send(loginForm("Проверьте адрес email."));
      }
      return next(error);
    }
  });

  router.get("/auth/verify", (request, response) => {
    const challenge = String(request.query.challenge || "");
    response.type("html").send(page("Подтверждение входа", `<section class="panel auth-card">
      <p class="eyebrow">Безопасный вход</p><h1>Введите код</h1><p class="muted">Шестизначный код отправлен на ваш email.</p>
      <form class="form-stack" method="post" action="/auth/verify"><input type="hidden" name="challengeId" value="${escapeHtml(challenge)}">
      <label>Код <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <button type="submit">Войти</button></form><p><a href="/auth/login">Запросить новый код</a></p></section>`, { narrow: true }));
  });
  router.post("/auth/verify", verifyLimiter, async (request, response, next) => {
    try {
      const result = await service.verifyCode(request.body || {}, {
        ip: request.ip, userAgent: request.get("user-agent"),
      });
      if (!result.ok) {
        if (result.reason === "ACCOUNT_UNAVAILABLE") {
          return response.status(403).type("html").send(page("Вход недоступен", "<p>Аккаунт недоступен.</p>"));
        }
        return response.status(401).type("html").send(page("Код не принят", '<p role="alert">Код неверен, истёк или уже использован.</p><p><a href="/auth/login">Запросить новый код</a></p>'));
      }
      response.cookie(config.cookieName, result.token, service.cookieOptions());
      return response.redirect(303, "/app");
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
     <form method="post" action="/app/account/delete"><button class="danger" type="submit">Запросить удаление аккаунта</button></form></div></section>`,
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
        "Удаление запланировано",
        "<p>Запрос сохранён, все сессии отозваны. Физическое удаление будет выполнено отдельным фоновым процессом после обязательного срока хранения.</p>",
      ));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
