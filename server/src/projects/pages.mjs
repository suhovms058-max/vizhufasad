import express from "express";
import { createRequireSession } from "../auth/http.mjs";
import {
  PHOTO_PROCESSING_CONSENT_PATH, PHOTO_PROCESSING_CONSENT_VERSION,
} from "../legal/photo-consent.mjs";
import { ProjectError } from "./service.mjs";

const STYLES = [
  "современный", "минимализм", "скандинавский", "барнхаус", "шале",
  "классический", "неоклассический", "контемпорари", "лофт", "тёмный хай-тек",
  "автоподбор",
];
const FEATURED_STYLES = [
  {
    value: "автоподбор", title: "Автоподбор", description: "ИИ предложит подходящий образ",
    image: "/facade-before-bright.webp", alt: "Исходный дом до выбора фасадного стиля",
  },
  {
    value: "современный", title: "Современный", description: "Чистые линии и несколько материалов",
    image: "/facade-after-bright.webp", alt: "Современная отделка фасада на примере дома",
  },
  {
    value: "скандинавский", title: "Скандинавский", description: "Фиброцемент, дерево и природные тона",
    image: "/facade-scandinavian-bright.webp", alt: "Скандинавская отделка фасада на примере дома",
  },
  {
    value: "неоклассический", title: "Неоклассика", description: "Светлая штукатурка и сдержанный декор",
    image: "/facade-neoclassical-bright.webp", alt: "Неоклассическая отделка фасада на примере дома",
  },
];
const MATERIALS = [
  ["штукатурка", "Ровная матовая поверхность", "plaster"],
  ["кирпич", "Тёплая кладка с заметным швом", "brick"],
  ["клинкер", "Плотная выразительная кладка", "clinker"],
  ["дерево", "Натуральные рейки или планкен", "wood"],
  ["камень", "Фактурный природный акцент", "stone"],
  ["панели", "Крупный современный формат", "panels"],
  ["фиброцемент", "Практичная ровная облицовка", "fiber-cement"],
  ["металл", "Фальц или вертикальный профиль", "metal"],
  ["комбинированная", "Два-три материала в балансе", "combined"],
  ["автоподбор", "ИИ подберёт сочетание", "auto"],
];
const PALETTES = [
  ["автоподбор", "Автоподбор", ["#d8d0c2", "#8d5b42", "#303531"]],
  ["тёплая светлая", "Тёплая светлая", ["#eee2cf", "#c8aa83", "#705646"]],
  ["холодная светлая", "Холодная светлая", ["#edf0ed", "#c5ccc9", "#66716f"]],
  ["земляная", "Земляная", ["#b59572", "#806044", "#4f5144"]],
  ["графитовая", "Графитовая", ["#303532", "#59605c", "#b58b67"]],
  ["контрастная", "Контрастная", ["#f1e9dc", "#282b29", "#a45f3d"]],
];
const PRESERVE = [
  ["geometry", "Геометрию дома"], ["windows", "Окна"], ["doors", "Двери"],
  ["roof", "Кровлю"], ["balconies", "Балконы"], ["terraces", "Террасы"],
  ["plot", "Участок"], ["noNewFloors", "Не добавлять этажи"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function jsonData(value) {
  return JSON.stringify(value ?? {}).replaceAll("<", "\\u003c").replaceAll("&", "\\u0026");
}

function page(title, body, { scripts = [] } = {}) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark"><title>${escapeHtml(title)} — ВИЖУФАСАД</title>
  <link rel="stylesheet" href="/assets/app-ui.css"></head><body>
  <a class="skip-link" href="#main">К содержанию</a>
  <header class="app-header"><a class="brand" href="/app">ВИЖУФАСАД</a>
    <nav aria-label="Основная навигация"><a href="/app">Мои проекты</a><a href="/app/new">Новый проект</a>
    <a href="/app/balance">Баланс</a><a href="/app/settings">Настройки</a></nav></header>
  <main id="main" class="app-main">${body}</main>
  ${["/assets/product-analytics.js", ...scripts].map((src) => `<script src="${src}" defer></script>`).join("")}</body></html>`;
}

function statusLabel(status) {
  return ({
    draft: "Черновик", photo_uploading: "Загрузка фото", photo_processing: "Обработка фото",
    photo_ready: "Фото готово", photo_validation_queued: "Проверка фото",
    photo_retake_required: "Нужно заменить фото", configuration_required: "Нужны настройки",
    generation_queued: "В очереди", generating: "Генерация", qa_queued: "Автопроверка",
    qa_failed_retrying: "Повторная генерация", ready: "Результат готов",
    failed_terminal: "Не выполнено — кредит возвращён", deleted: "Удалён",
  })[status] || status;
}

function assessmentBlock(project) {
  const assessment = project.assessment;
  if (!project.image_id) return "";
  if (!assessment || ["queued", "processing"].includes(assessment.status)) {
    return '<section class="panel assessment" aria-live="polite"><h2>Автоматическая проверка фото</h2><p>Проверяем дом, полноту кадра, перспективу, резкость и препятствия.</p></section>';
  }
  if (assessment.status === "provider_unavailable") {
    return `<section class="panel assessment warning"><h2>Проверка временно недоступна</h2>
      <p>Фото сохранено. Кредит не списан.</p><form method="post" action="/app/projects/${escapeHtml(project.id)}/images/${escapeHtml(project.image_id)}/assessment/retry">
      <button type="submit">Повторить автоматическую проверку</button></form></section>`;
  }
  const result = assessment.userResult || {};
  const kind = assessment.decision === "retake_required" ? "retake"
    : assessment.decision === "accepted_with_warning" ? "warning" : "accepted";
  const recommendations = Array.isArray(result.recommendations) && result.recommendations.length
    ? `<ul>${result.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  return `<section class="panel assessment ${kind}"><p class="eyebrow">Проверка фото</p>
    <h2>${escapeHtml(result.title || "Проверка завершена")}</h2>
    <p>${escapeHtml(result.summary || "")}</p>${recommendations}</section>`;
}

function projectCard(project) {
  const source = project.thumbnailUrl
    ? `<img src="${escapeHtml(project.thumbnailUrl)}" alt="Исходное фото проекта ${escapeHtml(project.title)}">`
    : '<div class="image-placeholder">Нет фото</div>';
  const result = project.preferredResultUrl
    ? `<div class="result-thumb"><img src="${escapeHtml(project.preferredResultUrl)}" alt="Лучший результат проекта ${escapeHtml(project.title)}">
       ${project.preferredResult?.requires_watermark ? '<span class="visual-watermark">ВИЖУФАСАД · КОНЦЕПЦИЯ</span>' : ""}</div>`
    : '<div class="image-placeholder">Результатов пока нет</div>';
  return `<article class="project-card"><div class="project-visuals">${source}${result}</div>
    <div class="project-card-body"><p class="eyebrow">${escapeHtml(statusLabel(project.status))}</p>
    <h2><a href="/app/projects/${escapeHtml(project.id)}">${escapeHtml(project.title)}</a></h2>
    <p class="muted">Обновлён ${escapeHtml(new Date(project.updated_at).toLocaleDateString("ru-RU"))} · Результатов: ${project.generationCount || 0}</p>
    <div class="actions"><a class="button" href="/app/new?project=${escapeHtml(project.id)}">Продолжить</a>
    <a class="button secondary" href="/app/projects/${escapeHtml(project.id)}">История</a></div>
    <details><summary>Управление проектом</summary>
      <form class="inline-form" method="post" action="/app/projects/${escapeHtml(project.id)}/rename"><label>Название
      <input name="title" value="${escapeHtml(project.title)}" maxlength="120" required></label><button type="submit">Переименовать</button></form>
      <form method="post" action="/app/projects/${escapeHtml(project.id)}/delete" onsubmit="return confirm('Удалить проект и его файлы?')">
      <button class="danger" type="submit">Удалить проект</button></form></details></div></article>`;
}

function uploadStep(project) {
  return `<section id="upload-app" class="flow upload-flow" data-project-id="${escapeHtml(project?.id || "")}"
    data-consent-version="${PHOTO_PROCESSING_CONSENT_VERSION}">
    <div class="flow-heading"><p class="eyebrow">Шаг 1 из 3 · бесплатно</p><h1>${project ? "Замените фотографию дома" : "Загрузите фотографию дома"}</h1>
    <p>Сначала автоматически проверим, подходит ли снимок для визуализации. Кредит на этом шаге не списывается.</p></div>
    <div class="upload-layout">
      <div class="panel upload-panel">
        <label for="project-title">Название проекта</label>
        <input id="project-title" maxlength="120" required value="${escapeHtml(project?.title || "Мой дом")}">
        <div id="drop-zone" class="drop-zone" aria-describedby="upload-help upload-formats">
          <button id="photo-picker" class="drop-zone-picker" type="button">
            <span class="drop-zone-icon" aria-hidden="true">↥</span>
            <strong>Перетащите фотографию сюда</strong>
            <span class="drop-zone-action">или выберите из галереи</span>
            <span id="upload-formats" class="muted">JPG, PNG или WEBP · до 25 МБ</span>
          </button>
          <input id="photo-input" class="visually-hidden" type="file" aria-label="Фотография дома" accept="image/jpeg,image/png,image/webp,image/heic,image/heif">
        </div>
        <div id="preview-shell" class="upload-preview-shell hidden">
          <img id="preview" class="upload-preview" alt="Предпросмотр выбранной фотографии">
          <div class="upload-preview-actions">
            <button id="replace-photo" class="secondary" type="button">Выбрать другое фото</button>
            <button id="remove-photo" class="text-button" type="button">Удалить</button>
          </div>
        </div>
        <p id="file-info" class="file-info muted"></p><progress id="progress" class="hidden" max="100"></progress>
        <p id="message" class="form-message" role="status" aria-live="polite"></p>
        <div class="upload-consents" aria-labelledby="upload-consent-title">
          <h2 id="upload-consent-title">Перед безопасной загрузкой</h2>
          <label class="confirm consent-confirm"><input id="photo-processing-consent" type="checkbox">
            <span>Я даю отдельное согласие на приватное хранение и автоматизированную обработку фотографии для проверки и создания новой визуализации, включая передачу настроенным AI-провайдерам. <a href="${PHOTO_PROCESSING_CONSENT_PATH}" target="_blank" rel="noopener">Текст согласия</a></span></label>
          <label class="confirm consent-confirm"><input id="photo-usage-rights" type="checkbox">
            <span>Подтверждаю, что вправе использовать фотографию и её обработка не нарушает права других лиц.</span></label>
        </div>
        <button id="upload-button" type="button" data-analytics-event="photo_upload_started" disabled>${project ? "Заменить и проверить фото" : "Загрузить и проверить фото"}</button>
        <p class="privacy-note">Файл хранится приватно, а ссылки действуют ограниченное время. <a href="/legal/privacy">Как мы защищаем фотографии</a>. Согласие можно отозвать по email Исполнителя.</p>
      </div>
      <aside class="photo-guide" aria-labelledby="photo-guide-title">
        <p class="eyebrow">Хороший исходник</p><h2 id="photo-guide-title">Как снять фасад</h2>
        <ul class="photo-guide-list">
          <li><strong>Дом целиком</strong><span>Крыша, стены и цоколь не обрезаны.</span></li>
          <li><strong>Прямой понятный ракурс</strong><span>Без сильного наклона и панорамы.</span></li>
          <li><strong>Дневной свет</strong><span>Фасад резкий, без ночной темноты.</span></li>
          <li><strong>Минимум препятствий</strong><span>Деревья и машины не закрывают дом.</span></li>
        </ul>
        <div class="photo-requirements" id="upload-help"><strong>Минимум 640×420</strong><span>Для лучшей детализации рекомендуем от 1200×800. HEIC/HEIF может потребовать конвертацию в JPG.</span></div>
      </aside>
    </div></section>`;
}

function option(value, selected) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`;
}

function generationKindLabel(kind) {
  return ({ standard: "Standard", pro: "Pro", edit: "Доработка" })[kind] || "Standard";
}

function transformationLevelLabel(level) {
  return ({ gentle: "Бережный", balanced: "Сбалансированный", conceptual: "Концептуальный" })[level] || "Бережный";
}

function featuredStyleCard(style, selectedStyle) {
  const active = style.value === selectedStyle;
  return `<button class="style-card${active ? " active" : ""}" type="button" data-style="${escapeHtml(style.value)}" aria-pressed="${active}">
    <img src="${escapeHtml(style.image)}" alt="${escapeHtml(style.alt)}">
    <span class="style-card-copy"><strong>${escapeHtml(style.title)}</strong><small>${escapeHtml(style.description)}</small></span>
    <span class="style-card-action">Выбрать</span></button>`;
}

function settingsStep(project, balance, costs, features) {
  const config = project.configuration || {};
  const selectedMaterials = new Set(config.materials || []);
  const preserve = config.preserve || {};
  const selectedStyle = config.style || "автоподбор";
  const selectedPalette = config.palette?.[0] || "автоподбор";
  return `<section id="generation-app" class="flow" data-project-id="${escapeHtml(project.id)}" data-image-id="${escapeHtml(project.image_id)}"
    data-standard-cost="${escapeHtml(costs.standard)}" data-pro-cost="${escapeHtml(costs.pro)}" data-pro-enabled="${features.pro}">
    <script id="initial-configuration" type="application/json">${jsonData(config)}</script>
    <div class="flow-heading"><p class="eyebrow">Шаг 3 из 3</p><h1>Настройте фасад</h1>
    <p>Баланс: <strong>${escapeHtml(balance)} кр.</strong></p></div>
    <form id="generation-form" class="settings-form panel" data-wizard-current="1">
      <ol class="settings-progress" aria-label="Шаги настройки фасада">
        <li aria-current="step"><span>1</span><strong>Задача и стиль</strong></li>
        <li><span>2</span><strong>Отделка и цвета</strong></li>
        <li><span>3</span><strong>Ограничения и запуск</strong></li>
      </ol>
      <div class="settings-step" data-wizard-step="1">
      <div class="settings-step-heading"><p class="eyebrow">Настройка 1 из 3</p><h2>Как должен измениться фасад</h2><p>Выберите глубину изменений, качество результата и архитектурное направление.</p></div>
      <fieldset><legend>Уровень изменений</legend><div class="mode-grid">${[["gentle", "Бережный", "Освежить отделку без изменения архитектуры"], ["balanced", "Сбалансированный", "Заметнее обновить сочетание материалов"], ["conceptual", "Концептуальный", "Создать выразительное решение в пределах ограничений"]].map(([value, label, description]) => `<label class="mode"><input type="radio" name="transformationLevel" value="${value}" ${(config.transformationLevel || "gentle") === value ? "checked" : ""}><span><strong>${label}</strong><small>${description}</small></span></label>`).join("")}</div></fieldset>
      <fieldset><legend>Качество результата</legend><div class="generation-tier-grid">
        <label class="generation-tier"><input type="radio" name="generationKind" value="standard" checked><span><strong>Standard · ${escapeHtml(costs.standard)} кредит</strong><small>Быстрый вариант для поиска отделки и цветового решения.</small></span></label>
        <label class="generation-tier ${features.pro ? "" : "is-disabled"}"><input type="radio" name="generationKind" value="pro" ${features.pro ? "" : "disabled"}><span><strong>Pro · ${escapeHtml(costs.pro)} кредита</strong><small>${features.pro ? "Модель более высокого качества, больше деталей и реалистичности." : "Появится после подтверждения качества модели на реальных фасадах."}</small></span></label>
      </div></fieldset>
      <fieldset><legend>Стиль</legend><p class="hint">Сравните популярные направления на одном доме или откройте полный список.</p>
      <div class="style-card-grid" aria-label="Популярные стили">${FEATURED_STYLES.map((item) => featuredStyleCard(item, selectedStyle)).join("")}</div>
      <label for="style">Все направления</label><select id="style" name="style">${STYLES.map((item) => option(item, selectedStyle)).join("")}</select></fieldset>
      </div>
      <div class="settings-step hidden" data-wizard-step="2">
      <div class="settings-step-heading"><p class="eyebrow">Настройка 2 из 3</p><h2>Отделка и цветовое решение</h2><p>Материалы, палитра и ваши уточнения автоматически попадут в задание генератору.</p></div>
      <fieldset><legend>Отделка</legend><p class="hint">Можно сочетать несколько материалов. Финальная совместимость системы требует проверки основания.</p>
      <div class="choice-grid material-grid">${MATERIALS.map(([value, description, visual]) => `<label class="choice material-choice" data-material="${escapeHtml(visual)}"><input type="checkbox" name="materials" value="${escapeHtml(value)}" ${selectedMaterials.has(value) ? "checked" : ""}><span><i class="material-swatch" aria-hidden="true"></i><b>${escapeHtml(value)}</b><small>${escapeHtml(description)}</small></span></label>`).join("")}</div></fieldset>
      <fieldset><legend>Палитра</legend><p class="hint">Готовое сочетание задаёт настроение, а точные оттенки можно описать ниже.</p>
      <div class="palette-grid">${PALETTES.map(([value, label, colors]) => `<label class="palette-choice"><input type="radio" name="palettePreset" value="${escapeHtml(value)}" ${selectedPalette === value ? "checked" : ""}><span><i class="palette-chips" aria-hidden="true">${colors.map((color) => `<b style="background:${escapeHtml(color)}"></b>`).join("")}</i><strong>${escapeHtml(label)}</strong></span></label>`).join("")}</div>
      <label for="palette-description">Описание цветов</label><input id="palette-description" name="paletteDescription" maxlength="120" value="${escapeHtml(config.palette?.slice(1).join(", ") || "")}" placeholder="Например: молочный, натуральное дерево, графит"></fieldset>
      </div>
      <div class="settings-step hidden" data-wizard-step="3">
      <div class="settings-step-heading"><p class="eyebrow">Настройка 3 из 3</p><h2>Что обязательно сохранить</h2><p>Проверьте ограничения, добавьте пожелания и подтвердите стоимость перед запуском.</p></div>
      <fieldset><legend>Что сохранить</legend><p class="hint">Все ограничения включены по умолчанию.</p><div class="choice-grid preserve-grid">${PRESERVE.map(([name, label]) => `<label class="choice"><input type="checkbox" name="preserve.${name}" ${(preserve[name] ?? true) ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("")}</div></fieldset>
      <fieldset><legend>Пожелания</legend><label for="wishes">Что важно учесть</label><textarea id="wishes" name="wishes" maxlength="700" rows="5" placeholder="Материалы, цвета, отделка карниза, цоколя, существующих опор…">${escapeHtml(config.wishes || "")}</textarea><p class="hint">Просьба передаётся генератору автоматически. Не просите менять этажность или геометрию, если соответствующие ограничения включены.</p><p class="counter"><span id="wishes-count">0</span>/700</p></fieldset>
      <label class="confirm"><input id="cost-confirm" type="checkbox" required><span id="cost-confirm-text">Подтверждаю списание ${escapeHtml(costs.standard)} кредита за Standard. Assessment и скачивание бесплатны.</span></label>
      </div>
      <p id="draft-status" class="muted" role="status" aria-live="polite"></p>
      <p id="generation-message" class="form-message" role="status" aria-live="polite"></p>
      <div class="settings-wizard-actions"><button id="settings-back" class="secondary hidden" type="button">Назад</button><button id="settings-next" type="button">Продолжить</button><button id="generation-start" class="hidden" type="submit">Запустить Standard</button><a class="button secondary" href="/app">Вернуться в проекты</a></div>
    </form></section>`;
}

function statusSteps() {
  return `<ol class="status-steps" aria-label="Этапы генерации">
    <li data-step="analysis">Анализ</li><li data-step="preprocessing">Подготовка</li>
    <li data-step="generating">Генерация</li><li data-step="quality_check_pending">Проверка</li>
    <li data-step="completed">Скачивание</li></ol>`;
}

function resultTools(project, generation, history, costs, features, comparisonAccess) {
  if (generation.status !== "completed") return "";
  const editor = features.editor ? `<section class="panel stage12-tool"><p class="eyebrow">ИИ-редактор · ${escapeHtml(costs.edit)} кредит</p><h2>Доработать результат</h2>
    <p>Команда применяется к текущему результату. Остальные части дома защищены от изменений.</p>
    <form id="edit-form" class="form-stack"><label for="edit-scope">Область<select id="edit-scope" name="scope">
      <option value="full_facade">Весь фасад</option><option value="walls">Стены</option><option value="plinth">Цоколь</option>
      <option value="roof">Кровля</option><option value="entrance">Входная группа</option><option value="custom_mask">Пользовательская маска PNG</option>
    </select></label><label id="edit-mask-row" class="hidden" for="edit-mask">Маска той же ширины и высоты, что результат<input id="edit-mask" type="file" accept="image/png"></label>
    <label for="edit-command">Что изменить<textarea id="edit-command" name="command" maxlength="700" rows="4" required placeholder="Например: заменить отделку стен на светлый клинкер, не меняя окна и кровлю"></textarea></label>
    <label class="confirm"><input type="checkbox" required><span>Подтверждаю списание ${escapeHtml(costs.edit)} кредита. При технической неудаче кредит вернётся автоматически.</span></label>
    <button id="edit-start" type="submit">Создать доработку</button></form></section>` : "";
  const upscale = features.upscale ? `<section class="panel stage12-tool"><p class="eyebrow">4K · ${escapeHtml(costs.upscale)} кредит</p><h2>Подготовить 4K</h2>
    <p>Отдельная задача увеличит изображение минимум до 3840×2160 и проверит его на артефакты.</p>
    <button id="upscale-start" type="button">Создать 4K</button><div id="upscale-status" class="form-message" role="status" aria-live="polite"></div></section>` : "";
  const completed = history.filter((item) => item.status === "completed");
  const versionItems = completed.map((item) => `<li class="version-item ${item.id === generation.id ? "current" : ""}">
    <span><strong>${escapeHtml(generationKindLabel(item.kind))} · вариант ${escapeHtml(item.revision)}</strong>${item.parent_generation_id ? " · доработка" : ""}</span>
    ${item.id === generation.id ? "<em>открыт сейчас</em>" : `<button class="secondary restore-version" type="button" data-generation-id="${escapeHtml(item.id)}">Вернуться к версии</button>`}</li>`).join("");
  const versions = `<section class="panel stage12-tool"><p class="eyebrow">Версии</p><h2>История доработок</h2><ol class="version-list">${versionItems}</ol><p class="hint">Возврат не удаляет более новые варианты.</p></section>`;
  let compare = "";
  if (completed.length >= 2) {
    compare = comparisonAccess?.allowed ? `<section class="panel stage12-tool"><p class="eyebrow">Оптимум и выше</p><h2>Сравнить варианты</h2><p>Выберите от двух до четырёх результатов.</p>
      <form id="comparison-create" class="comparison-picker">${completed.map((item) => `<label><input type="checkbox" name="generationId" value="${escapeHtml(item.id)}" ${item.id === generation.id ? "checked" : ""}><span>${escapeHtml(generationKindLabel(item.kind))} · вариант ${escapeHtml(item.revision)}</span></label>`).join("")}
      <button type="submit">Открыть сравнение</button></form></section>`
      : `<section class="panel stage12-tool"><p class="eyebrow">Сравнение</p><h2>До четырёх вариантов рядом</h2><p>Доступно после покупки пакета «Оптимум» или «Максимум».</p><a class="button secondary" href="/app/balance">Посмотреть тарифы</a></section>`;
  }
  return `<section class="stage12-tools" aria-label="Дополнительные возможности"><p id="stage12-message" class="form-message" role="status" aria-live="polite"></p>${editor}${upscale}${versions}${compare}</section>`;
}

function resultPage(project, generation, history, sourceUrl, resultUrl, balance, costs, features, comparisonAccess) {
  const config = generation.config_snapshot || {};
  const kind = generation.kind || config.generationKind || "standard";
  const terminal = ["completed", "failed_refunded", "cancelled"].includes(generation.status);
  const visual = generation.status === "completed" && resultUrl
    ? `<section class="result-layout"><div id="comparison" class="comparison" style="--position:50%">
      <img src="${escapeHtml(resultUrl)}" alt="Проверенный результат фасада">
      <div class="before-layer"><img src="${escapeHtml(sourceUrl)}" alt="Исходная фотография"></div>
      ${generation.requires_watermark ? '<span class="visual-watermark large">ВИЖУФАСАД · КОНЦЕПЦИЯ</span>' : ""}
      <label class="comparison-control"><span class="visually-hidden">Положение ползунка до и после</span><input id="compare-range" type="range" min="0" max="100" value="50"></label></div>
      <aside class="panel result-details"><p class="eyebrow">${escapeHtml(generationKindLabel(kind))} · вариант ${escapeHtml(generation.revision)}</p><h1>Фасад готов</h1>
      <div class="result-verification"><strong>Автопроверка пройдена</strong><span>Результат допущен к показу автоматическим контролем качества.</span></div>
      <dl><div><dt>Стиль</dt><dd>${escapeHtml(config.style)}</dd></div><div><dt>Материалы</dt><dd>${escapeHtml((config.materials || []).join(", ") || "Автоподбор")}</dd></div>
      <div><dt>Палитра</dt><dd>${escapeHtml((config.palette || []).join(", ") || "Автоподбор")}</dd></div><div><dt>Режим</dt><dd>${escapeHtml(transformationLevelLabel(config.transformationLevel))}</dd></div></dl>
      <p class="concept-note">Визуализация является концепцией, а не рабочим строительным проектом.${generation.requires_watermark ? " Водяной знак означает, что использованы бесплатные кредиты." : ""}</p>
      <div class="actions stacked"><a class="button" href="${escapeHtml(resultUrl)}" download>Скачать</a>
      <button id="favorite-button" class="secondary" type="button" data-favorite="${generation.is_favorite}">${generation.is_favorite ? "Убрать из избранного" : "В избранное"}</button>
      <a class="button secondary" href="/app/new?project=${escapeHtml(project.id)}&repeat=${escapeHtml(generation.id)}">Повторить настройки</a>
      <a class="button secondary" href="/app/new">Создать ещё</a></div><div class="result-balance"><span>Доступно</span><strong>${escapeHtml(balance)} кр.</strong><a href="/app/balance">Баланс и пакеты →</a></div></aside></section>`
    : `<section class="generation-wait-layout" aria-label="Состояние создания фасада">
      <figure class="generation-source-preview"><img src="${escapeHtml(sourceUrl)}" alt="Исходная фотография проекта ${escapeHtml(project.title)}"><figcaption>Исходное фото · геометрия под защитой</figcaption></figure>
      <div class="panel status-panel"><p class="eyebrow">${escapeHtml(generationKindLabel(kind))} · вариант ${escapeHtml(generation.revision)}</p><h1>${terminal ? "Генерация остановлена" : "Создаём фасад"}</h1>
      <dl class="generation-brief"><div><dt>Стиль</dt><dd>${escapeHtml(config.style || "Автоподбор")}</dd></div><div><dt>Материалы</dt><dd>${escapeHtml((config.materials || []).join(", ") || "Автоподбор")}</dd></div><div><dt>Режим</dt><dd>${escapeHtml(transformationLevelLabel(config.transformationLevel))}</dd></div></dl>
      ${statusSteps()}<p id="generation-message" role="status" aria-live="polite"></p><button id="generation-cancel" class="danger hidden" type="button">Отменить до начала генерации</button>
      <p class="generation-leave-note"><a href="/app">Можно перейти в проекты</a> — задача продолжит выполняться, а актуальный этап сохранится после обновления страницы.</p></div></section>`;
  const items = history.map((item) => `<li><a href="/app/projects/${escapeHtml(project.id)}/generations/${escapeHtml(item.id)}">${escapeHtml(generationKindLabel(item.kind))} · вариант ${escapeHtml(item.revision)}</a>
    <span>${escapeHtml(statusLabel(item.status))} · ${escapeHtml(new Date(item.created_at).toLocaleString("ru-RU"))}${item.is_favorite ? " · ★" : ""}</span></li>`).join("");
  return `<div id="result-app" data-project-id="${escapeHtml(project.id)}" data-generation-id="${escapeHtml(generation.id)}" data-status="${escapeHtml(generation.status)}"
    data-editor-enabled="${features.editor}" data-upscale-enabled="${features.upscale}" data-edit-cost="${escapeHtml(costs.edit)}" data-upscale-cost="${escapeHtml(costs.upscale)}">
    <nav class="breadcrumbs" aria-label="Хлебные крошки"><a href="/app">Проекты</a><span>/</span><a href="/app/projects/${escapeHtml(project.id)}">${escapeHtml(project.title)}</a><span>/</span><span>Вариант ${escapeHtml(generation.revision)}</span></nav>
    ${visual}${resultTools(project, generation, history, costs, features, comparisonAccess)}<section class="panel history"><h2>История вариантов</h2><ol>${items}</ol></section></div>`;
}

function comparisonPage(project, comparison) {
  const cards = comparison.items.map((item) => `<article class="comparison-card" data-generation-id="${escapeHtml(item.generationId)}">
    <div class="comparison-image-frame" tabindex="0" aria-label="Масштабируемое изображение варианта ${escapeHtml(item.revision)}"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(generationKindLabel(item.kind))}, вариант ${escapeHtml(item.revision)}"></div>
    <div class="comparison-card-body"><p class="eyebrow">${escapeHtml(generationKindLabel(item.kind))} · вариант ${escapeHtml(item.revision)}</p>
    <dl><div><dt>Стиль</dt><dd>${escapeHtml(item.style || "Автоподбор")}</dd></div><div><dt>Материалы</dt><dd>${escapeHtml((item.materials || []).join(", ") || "Автоподбор")}</dd></div>
    <div><dt>Палитра</dt><dd>${escapeHtml((item.palette || []).join(", ") || "Автоподбор")}</dd></div><div><dt>Режим</dt><dd>${escapeHtml(item.transformationLevel || "—")}</dd></div></dl>
    <div class="actions"><button class="comparison-winner ${comparison.winner_generation_id === item.generationId ? "selected" : "secondary"}" type="button">${comparison.winner_generation_id === item.generationId ? "Выбран победителем" : "Выбрать победителем"}</button>
    <button class="comparison-favorite secondary" type="button" data-favorite="${item.isFavorite}">${item.isFavorite ? "Убрать из избранного" : "В избранное"}</button>
    <button class="comparison-fullscreen secondary" type="button">На весь экран</button></div></div></article>`).join("");
  return `<div id="comparison-app" data-project-id="${escapeHtml(project.id)}" data-comparison-id="${escapeHtml(comparison.id)}">
    <nav class="breadcrumbs"><a href="/app">Проекты</a><span>/</span><a href="/app/projects/${escapeHtml(project.id)}">${escapeHtml(project.title)}</a><span>/</span><span>Сравнение</span></nav>
    <div class="page-heading"><div><p class="eyebrow">До четырёх вариантов</p><h1>Сравнение фасадов</h1></div><div class="actions"><button id="comparison-collage" type="button">Создать коллаж</button><a class="button secondary" href="/app/projects/${escapeHtml(project.id)}">К проекту</a></div></div>
    <label class="sync-zoom"><span>Общий масштаб</span><input id="sync-zoom" type="range" min="100" max="220" value="100"><output id="sync-zoom-value">100%</output></label>
    <p id="comparison-message" class="form-message" role="status" aria-live="polite"></p>
    ${comparison.collageUrl ? `<p><a class="button secondary" href="${escapeHtml(comparison.collageUrl)}" download>Скачать коллаж</a></p>` : ""}
    <section class="comparison-grid" style="--comparison-zoom:1">${cards}</section></div>`;
}

export function createProjectPagesRouter({
  authService, projectService, generationService, walletService,
  generationConfig = {}, upscaleConfig = {}, comparisonService = null,
}) {
  const router = express.Router();
  const features = Object.freeze({
    pro: generationConfig.proEnabled === true,
    editor: generationConfig.editorEnabled === true,
    upscale: upscaleConfig.enabled === true,
  });
  router.use("/app", createRequireSession(authService, { html: true }));
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));

  router.get(["/app", "/app/projects"], async (request, response, next) => {
    try {
      const projects = await projectService.list(request.auth.user_id);
      const enriched = await Promise.all(projects.map(async (project) => {
        const generations = generationService ? await generationService.list(request.auth.user_id, project.id) : [];
        const preferred = generations.find((item) => item.is_favorite && item.status === "completed")
          || generations.find((item) => item.status === "completed");
        return { ...project, generationCount: generations.length, preferredResult: preferred,
          preferredResultUrl: preferred ? await generationService.resultUrl(request.auth.user_id, project.id, preferred.id) : null };
      }));
      const content = enriched.length ? `<section class="project-grid">${enriched.map(projectCard).join("")}</section>`
        : '<section class="panel empty"><h1>Мои проекты</h1><p>Создайте первый проект и загрузите фотографию дома.</p><a class="button" href="/app/new">Новый проект</a></section>';
      return response.type("html").send(page("Мои проекты", `<div class="page-heading"><p class="eyebrow">Личный кабинет</p><h1>Мои проекты</h1><a class="button" href="/app/new">Новый проект</a></div>${content}`));
    } catch (error) { return next(error); }
  });

  router.get("/app/new", async (request, response, next) => {
    try {
      const [projects, wallet, catalog] = await Promise.all([
        projectService.list(request.auth.user_id), walletService.summary(request.auth.user_id),
        typeof walletService.catalog === "function" ? walletService.catalog() : { actions: [] },
      ]);
      let project = request.query.project
        ? await projectService.open(request.auth.user_id, String(request.query.project)) : null;
      if (project && request.query.repeat && generationService) {
        const repeated = await generationService.view(request.auth.user_id, project.id, String(request.query.repeat));
        project = { ...project, configuration: repeated.config_snapshot };
      }
      const accepted = ["accepted", "accepted_with_warning"].includes(project?.assessment?.decision);
      const forceReplace = request.query.replace === "1";
      const costs = {
        standard: catalog.actions.find((item) => item.code === "standard_generation")?.credits ?? 1,
        pro: catalog.actions.find((item) => item.code === "pro_generation")?.credits ?? 2,
      };
      const projectPicker = !project && projects.length ? `<section class="panel"><h2>Или выберите проект</h2><div class="compact-projects">${projects.map((item) => `<a href="/app/new?project=${escapeHtml(item.id)}">${escapeHtml(item.title)}</a>`).join("")}</div></section>` : "";
      const body = project && project.image_id && !forceReplace
        ? `<nav class="breadcrumbs"><a href="/app">Проекты</a><span>/</span><span>${escapeHtml(project.title)}</span></nav>
          <section class="source-summary"><img src="${escapeHtml(project.thumbnailUrl)}" alt="Исходное фото"><div><p class="eyebrow">Шаг 2 из 3</p><h1>Фото проекта</h1><a href="/app/new?project=${escapeHtml(project.id)}&replace=1">Заменить фото</a></div></section>
          ${assessmentBlock(project)}${accepted ? settingsStep(project, wallet.balance, costs, features) : uploadStep(project)}`
        : `${uploadStep(project)}${projectPicker}`;
      return response.type("html").send(page("Новый проект", body, { scripts: ["/assets/app-new.js", "/assets/app-generation.js"] }));
    } catch (error) {
      if (error instanceof ProjectError && error.status === 404) return response.status(404).send("Проект не найден");
      return next(error);
    }
  });

  router.get("/app/projects/:projectId", async (request, response, next) => {
    try {
      const project = await projectService.open(request.auth.user_id, request.params.projectId);
      const generations = generationService ? await generationService.list(request.auth.user_id, project.id) : [];
      const history = generations.map((item) => `<li><a href="/app/projects/${escapeHtml(project.id)}/generations/${escapeHtml(item.id)}">Вариант ${escapeHtml(item.revision)}</a> — ${escapeHtml(statusLabel(item.status))}</li>`).join("");
      return response.type("html").send(page(project.title, `<nav class="breadcrumbs"><a href="/app">Проекты</a><span>/</span><span>${escapeHtml(project.title)}</span></nav>
        <section class="source-summary"><img src="${escapeHtml(project.thumbnailUrl || "")}" alt="Исходное фото"><div><p class="eyebrow">${escapeHtml(statusLabel(project.status))}</p><h1>${escapeHtml(project.title)}</h1>
        <a class="button" href="/app/new?project=${escapeHtml(project.id)}">Открыть настройки</a></div></section>${assessmentBlock(project)}
        <section class="panel history"><h2>История вариантов</h2>${history ? `<ol>${history}</ol>` : "<p>Генераций пока нет.</p>"}</section>`));
    } catch (error) { return next(error); }
  });

  router.get("/app/projects/:projectId/generations/:generationId", async (request, response, next) => {
    try {
      const [project, generation, history, wallet, catalog, comparisonAccess] = await Promise.all([
        projectService.open(request.auth.user_id, request.params.projectId),
        generationService.view(request.auth.user_id, request.params.projectId, request.params.generationId),
        generationService.list(request.auth.user_id, request.params.projectId),
        walletService.summary(request.auth.user_id),
        typeof walletService.catalog === "function" ? walletService.catalog() : { actions: [] },
        comparisonService ? comparisonService.access(request.auth.user_id) : { allowed: false, minimumPlan: "OPTIMUM" },
      ]);
      const sourceUrl = project.image_id ? await projectService.imageUrl(request.auth.user_id, project.id, project.image_id, "working") : null;
      const resultUrl = generation.status === "completed" ? await generationService.resultUrl(request.auth.user_id, project.id, generation.id) : null;
      const costs = {
        edit: catalog.actions.find((item) => item.code === "text_revision")?.credits ?? 1,
        upscale: catalog.actions.find((item) => item.code === "upscale_4k")?.credits ?? 1,
      };
      return response.type("html").send(page(`Вариант ${generation.revision}`, resultPage(
        project, generation, history, sourceUrl, resultUrl, wallet.balance, costs, features, comparisonAccess,
      ), { scripts: ["/assets/app-generation.js", "/assets/app-result.js"] }));
    } catch (error) { return next(error); }
  });

  router.get("/app/projects/:projectId/comparisons/:comparisonId", async (request, response, next) => {
    try {
      if (!comparisonService) return response.status(404).send("Сравнение недоступно");
      const [project, comparison] = await Promise.all([
        projectService.open(request.auth.user_id, request.params.projectId),
        comparisonService.view(request.auth.user_id, request.params.projectId, request.params.comparisonId),
      ]);
      return response.type("html").send(page("Сравнение фасадов", comparisonPage(project, comparison), {
        scripts: ["/assets/app-result.js"],
      }));
    } catch (error) { return next(error); }
  });

  router.post("/app/projects/:projectId/rename", async (request, response, next) => {
    try { await projectService.rename(request.auth.user_id, request.params.projectId, request.body?.title); return response.redirect(303, "/app"); }
    catch (error) { return next(error); }
  });
  router.post("/app/projects/:projectId/delete", async (request, response, next) => {
    try { await projectService.remove(request.auth.user_id, request.params.projectId); return response.redirect(303, "/app"); }
    catch (error) { return next(error); }
  });
  router.post("/app/projects/:projectId/images/:imageId/assessment/retry", async (request, response, next) => {
    try { await projectService.retryAssessment(request.auth.user_id, request.params.projectId, request.params.imageId); return response.redirect(303, `/app/new?project=${encodeURIComponent(request.params.projectId)}`); }
    catch (error) { return next(error); }
  });
  return router;
}
