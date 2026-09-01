import express from "express";
import { LEGAL_DOCUMENTS, LEGAL_OPERATOR, legalDocument } from "./documents.mjs";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function legalNavigation(active = "") {
  return `<nav class="legal-nav" aria-label="Правовые документы">${LEGAL_DOCUMENTS.map((document) =>
    `<a href="/legal/${document.key}"${document.key === active ? ' aria-current="page"' : ""}>${escapeHtml(document.title)}</a>`).join("")}</nav>`;
}

function shell(title, body, active = "") {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark"><title>${escapeHtml(title)} — ВИЖУФАСАД</title><link rel="shortcut icon" href="/favicon-32x32.png"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32"><link rel="stylesheet" href="/assets/app-ui.css"></head><body>
  <a class="skip-link" href="#main">К содержанию</a><header class="app-header"><a class="brand brand-home" href="/" aria-label="Вернуться на главную страницу"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9M9.5 19v-5h5v5"/></svg><span>ВИЖУФАСАД</span></a><nav aria-label="Основная навигация"><a href="/">На главную</a><a href="/auth/login">Войти</a></nav></header>
  <main id="main" class="app-main app-main-legal">${body}</main><footer class="app-footer"><a href="/legal">Правовая информация</a><a href="/legal/offer">Оплата</a><a href="/legal/privacy">Конфиденциальность</a><button type="button" class="link-button" data-privacy-settings>Настройки конфиденциальности</button></footer><script src="/assets/product-analytics.js" defer></script></body></html>`;
}

function documentCard(document) {
  return `<a class="panel legal-card" href="/legal/${document.key}"><span>${escapeHtml(document.short)}</span><strong>${escapeHtml(document.title)}</strong><small>Редакция ${escapeHtml(document.revision)}</small></a>`;
}

function revisionDate(revision) {
  const [year, month, day] = String(revision).split("-").map(Number);
  if (!year || !month || !day) return revision;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function createLegalPagesRouter() {
  const router = express.Router();
  router.get("/legal", (_request, response) => response.type("html").send(shell("Правовая информация", `<section class="page-heading"><div><p class="eyebrow">Документы сервиса</p><h1>Правовая информация</h1><p class="muted">Условия работы, обработки данных, оплаты и обращений собраны в одном месте.</p></div></section><section class="legal-grid">${LEGAL_DOCUMENTS.map(documentCard).join("")}</section><section class="panel legal-operator"><h2>Оператор ВИЖУФАСАД</h2><p>${escapeHtml(LEGAL_OPERATOR.name)}, ${escapeHtml(LEGAL_OPERATOR.status)}, ИНН ${escapeHtml(LEGAL_OPERATOR.inn)}.</p><p><a href="mailto:${escapeHtml(LEGAL_OPERATOR.email)}">${escapeHtml(LEGAL_OPERATOR.email)}</a></p></section>`)));
  router.get("/legal/:key", (request, response) => {
    const document = legalDocument(request.params.key);
    if (!document) return response.status(404).type("html").send(shell("Документ не найден", '<article class="panel legal-content"><h1>Документ не найден</h1><p><a href="/legal">Вернуться к правовой информации</a></p></article>'));
    const content = document.sections.map(([heading, html]) => `<section><h2>${escapeHtml(heading)}</h2>${html}</section>`).join("");
    return response.type("html").send(shell(document.title, `${legalNavigation(document.key)}<article class="panel legal-content"><p class="eyebrow">Правовая информация</p><h1>${escapeHtml(document.title)}</h1><p class="legal-revision">Редакция от ${escapeHtml(revisionDate(document.revision))} · версия ${escapeHtml(document.revision)}</p>${content}<details class="legal-hash"><summary>Контрольная версия документа</summary><code>SHA-256: ${escapeHtml(document.hash)}</code></details></article>`, document.key));
  });
  return router;
}
