import express from "express";
import { createRequireSession } from "../auth/http.mjs";
import { ProjectError } from "./service.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function page(title, body, { script = "" } = {}) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} — ВИЖУФАСАД</title>
  <style>
    :root{font-family:Inter,system-ui,sans-serif;color:#17201b;background:#f2f4ef}
    *{box-sizing:border-box}body{margin:0}header{padding:20px max(24px,calc((100% - 980px)/2));background:#173d2c}
    header a{color:#fff;text-decoration:none;font-weight:800;letter-spacing:.06em}
    main{max-width:980px;margin:0 auto;padding:36px 24px 72px}nav{display:flex;gap:18px;margin:0 0 32px}
    a{color:#176b46}button,.button{border:0;border-radius:9px;padding:11px 17px;background:#176b46;color:#fff;
      font:inherit;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block}
    button.danger{background:#a52e2e}input{border:1px solid #aeb8b0;border-radius:8px;padding:10px;font:inherit}
    .toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
    .card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 3px 16px #173d2c12}.card img{width:100%;height:180px;object-fit:cover;border-radius:9px}
    .muted{color:#617066}.drop{border:2px dashed #8ea698;border-radius:16px;padding:34px;text-align:center;background:#fff;cursor:pointer}
    .drop.drag{border-color:#176b46;background:#e9f5ee}.preview{max-width:100%;max-height:430px;border-radius:12px;margin-top:18px}
    progress{width:100%;height:18px}.error{color:#a52e2e}.success{color:#176b46}.hidden{display:none}
    form.inline{display:inline-flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .assessment{border-left:5px solid #176b46;margin:18px 0}.assessment.warning{border-color:#c48918}
    .assessment.retake{border-color:#a52e2e}.assessment ul{padding-left:20px}
  </style>
</head>
<body><header><a href="/app">ВИЖУФАСАД</a></header><main>${body}</main>${script}</body></html>`;
}

const navigation = '<nav><a href="/app">Мои проекты</a><a href="/app/new">Новый проект</a><a href="/app/settings">Настройки</a></nav>';

function statusLabel(status) {
  return ({
    draft: "Черновик",
    photo_uploading: "Загрузка фото",
    photo_processing: "Обработка фото",
    photo_ready: "Фото готово",
    photo_validation_queued: "Автоматическая проверка фото",
    photo_retake_required: "Нужно заменить фото",
    configuration_required: "Фото принято — настройте фасад",
    deleted: "Удалён",
  })[status] || status;
}

function projectCard(project) {
  const image = project.thumbnailUrl
    ? `<img src="${escapeHtml(project.thumbnailUrl)}" alt="Фото проекта">`
    : '<p class="muted">Фото ещё не загружено</p>';
  return `<article class="card">${image}
    <h2><a href="/app/projects/${escapeHtml(project.id)}">${escapeHtml(project.title)}</a></h2>
    <p class="muted">${escapeHtml(statusLabel(project.status))}</p>
    <a class="button" href="/app/projects/${escapeHtml(project.id)}">Открыть</a>
  </article>`;
}

function assessmentBlock(project) {
  const assessment = project.assessment;
  if (!project.image_id) return "";
  if (!assessment || ["queued", "processing"].includes(assessment.status)) {
    return '<section class="card assessment"><h2>Автоматическая проверка</h2><p>Проверяем фасад, кадр и качество фотографии.</p></section>';
  }
  if (assessment.status === "provider_unavailable") {
    return `<section class="card assessment warning"><h2>Проверка временно недоступна</h2>
      <p>Фотография сохранена и не потеряна. Повторите только автоматическую проверку.</p>
      <form method="post" action="/app/projects/${escapeHtml(project.id)}/images/${escapeHtml(project.image_id)}/assessment/retry">
        <button type="submit">Повторить проверку</button>
      </form></section>`;
  }
  const result = assessment.userResult || {};
  const className = assessment.decision === "retake_required"
    ? "retake"
    : assessment.decision === "accepted_with_warning" ? "warning" : "";
  const recommendations = Array.isArray(result.recommendations) && result.recommendations.length
    ? `<ul>${result.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  return `<section class="card assessment ${className}">
    <h2>${escapeHtml(result.title || "Автоматическая проверка завершена")}</h2>
    <p>${escapeHtml(result.summary || "")}</p>${recommendations}
  </section>`;
}

export function createProjectPagesRouter({ authService, projectService }) {
  const router = express.Router();
  const requireSession = createRequireSession(authService, { html: true });
  router.use("/app", requireSession);
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));

  router.get(["/app", "/app/projects"], async (request, response, next) => {
    try {
      const projects = await projectService.list(request.auth.user_id);
      const content = projects.length
        ? `<section class="grid">${projects.map(projectCard).join("")}</section>`
        : '<section class="card"><p>Проектов пока нет.</p><a class="button" href="/app/new">Создать первый проект</a></section>';
      return response.type("html").send(page("Мои проекты", `${navigation}<h1>Мои проекты</h1>${content}`));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/app/new", async (request, response, next) => {
    try {
      let project = null;
      if (request.query.project) {
        project = await projectService.open(request.auth.user_id, String(request.query.project));
      }
      return response.type("html").send(page(
        project ? "Заменить фотографию" : "Новый проект",
        `${navigation}
        <section id="upload-app" data-project-id="${escapeHtml(project?.id || "")}">
          <h1>${project ? `Заменить фото: ${escapeHtml(project.title)}` : "Новый проект"}</h1>
          <p>JPG, PNG или WEBP, до 25 МБ. Минимум 640×420, рекомендуется от 1200×800.</p>
          <p class="muted">HEIC/HEIF принимается только там, где сервер гарантированно умеет его декодировать. Иначе конвертируйте файл в JPG.</p>
          <label>Название проекта
            <input id="project-title" maxlength="120" required value="${escapeHtml(project?.title || "Мой дом")}">
          </label>
          <div id="drop-zone" class="drop" tabindex="0" role="button">
            Перетащите фотографию сюда или нажмите для выбора
            <input id="photo-input" class="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif">
          </div>
          <img id="preview" class="preview hidden" alt="Предварительный просмотр">
          <p id="file-info" class="muted"></p>
          <progress id="progress" class="hidden" max="100" value="0"></progress>
          <p id="message" aria-live="polite"></p>
          <button id="upload-button" type="button" disabled>${project ? "Заменить фото" : "Создать проект и загрузить"}</button>
        </section>`,
        { script: '<script src="/assets/app-new.js" defer></script>' },
      ));
    } catch (error) {
      if (error instanceof ProjectError && error.status === 404) return response.status(404).send("Проект не найден");
      return next(error);
    }
  });

  router.get("/app/projects/:projectId", async (request, response, next) => {
    try {
      const project = await projectService.open(request.auth.user_id, request.params.projectId);
      const image = project.thumbnailUrl
        ? `<img class="preview" src="${escapeHtml(project.thumbnailUrl)}" alt="Фото проекта">`
        : '<p class="muted">Исходная фотография ещё не готова.</p>';
      return response.type("html").send(page(
        project.title,
        `${navigation}<article class="card"><h1>${escapeHtml(project.title)}</h1>
          <p>Статус: ${escapeHtml(statusLabel(project.status))}</p>${image}</article>
          ${assessmentBlock(project)}
          <article class="card">
          <p><a class="button" href="/app/new?project=${escapeHtml(project.id)}">Загрузить или заменить фото</a></p>
          <form class="inline" method="post" action="/app/projects/${escapeHtml(project.id)}/rename">
            <input name="title" value="${escapeHtml(project.title)}" maxlength="120" required>
            <button type="submit">Переименовать</button>
          </form>
          <form class="inline" method="post" action="/app/projects/${escapeHtml(project.id)}/delete">
            <button class="danger" type="submit">Удалить проект</button>
          </form></article>`,
      ));
    } catch (error) {
      if (error instanceof ProjectError && error.status === 404) return response.status(404).send("Проект не найден");
      return next(error);
    }
  });

  router.post("/app/projects/:projectId/rename", async (request, response, next) => {
    try {
      await projectService.rename(request.auth.user_id, request.params.projectId, request.body?.title);
      return response.redirect(303, `/app/projects/${encodeURIComponent(request.params.projectId)}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/app/projects/:projectId/delete", async (request, response, next) => {
    try {
      await projectService.remove(request.auth.user_id, request.params.projectId);
      return response.redirect(303, "/app");
    } catch (error) {
      return next(error);
    }
  });
  router.post(
    "/app/projects/:projectId/images/:imageId/assessment/retry",
    async (request, response, next) => {
      try {
        await projectService.retryAssessment(
          request.auth.user_id, request.params.projectId, request.params.imageId,
        );
        return response.redirect(303, `/app/projects/${encodeURIComponent(request.params.projectId)}`);
      } catch (error) {
        return next(error);
      }
    },
  );
  return router;
}
