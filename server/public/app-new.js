(() => {
  const errors = {
    AUTH_REQUIRED: "Сессия истекла. Войдите снова.",
    HEIF_CONVERSION_REQUIRED: "Этот сервер не может надёжно обработать HEIC/HEIF. Конвертируйте фото в JPG.",
    UNSUPPORTED_IMAGE_TYPE: "Поддерживаются JPG, PNG и WEBP.",
    IMAGE_SIZE_LIMIT: "Файл должен быть не больше 25 МБ.",
    IMAGE_TOO_SMALL: "Разрешение фотографии меньше 640×420.",
    PIXEL_LIMIT_EXCEEDED: "У изображения слишком большое число пикселей.",
    MIME_DECODER_MISMATCH: "Содержимое файла не соответствует его формату.",
    IMAGE_DECODE_FAILED: "Файл повреждён или не декодируется.",
    INSUFFICIENT_BALANCE: "Недостаточно кредитов для Standard.",
    STANDARD_GENERATION_DISABLED: "Standard-генерация пока не включена на этом сервере.",
  };

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "REQUEST_FAILED");
      error.code = body.error || "REQUEST_FAILED";
      throw error;
    }
    return body;
  }

  function setupUpload() {
    const root = document.querySelector("#upload-app");
    if (!root) return;
    const dropZone = root.querySelector("#drop-zone");
    const input = root.querySelector("#photo-input");
    const preview = root.querySelector("#preview");
    const info = root.querySelector("#file-info");
    const progress = root.querySelector("#progress");
    const message = root.querySelector("#message");
    const button = root.querySelector("#upload-button");
    const title = root.querySelector("#project-title");
    const accepted = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
    let selectedFile;

    const show = (text, kind = "") => { message.textContent = text; message.className = `form-message ${kind}`; };
    const choose = (file) => {
      if (!file) return;
      if (!accepted.has(file.type)) return show("Выберите JPG, PNG, WEBP или HEIC/HEIF.", "error");
      if (file.size > 25 * 1024 * 1024) return show(errors.IMAGE_SIZE_LIMIT, "error");
      selectedFile = file;
      preview.src = URL.createObjectURL(file);
      preview.classList.remove("hidden");
      info.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ`;
      button.disabled = false;
      show("");
    };
    const directUpload = (upload, file) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", upload.url);
      Object.entries(upload.headers || {}).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) progress.value = Math.round((event.loaded / event.total) * 100);
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("DIRECT_UPLOAD_FAILED"));
      xhr.onerror = () => reject(new Error("DIRECT_UPLOAD_FAILED"));
      xhr.send(file);
    });
    const run = async () => {
      if (!selectedFile || !title.value.trim()) return;
      button.disabled = true;
      progress.value = 0;
      progress.classList.remove("hidden");
      show("Подготавливаем безопасную загрузку…");
      try {
        let projectId = root.dataset.projectId;
        if (!projectId) {
          const created = await request("/api/projects", { method: "POST", body: JSON.stringify({ title: title.value.trim() }) });
          projectId = created.project.id;
          root.dataset.projectId = projectId;
          history.replaceState(null, "", `/app/new?project=${encodeURIComponent(projectId)}&replace=1`);
        } else {
          await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify({ title: title.value.trim() }) });
        }
        const intent = await request(`/api/projects/${encodeURIComponent(projectId)}/images/upload-intent`, {
          method: "POST",
          body: JSON.stringify({ filename: selectedFile.name, mimeType: selectedFile.type, byteSize: selectedFile.size }),
        });
        show("Загружаем напрямую в приватное хранилище…");
        await directUpload(intent.upload, selectedFile);
        progress.removeAttribute("value");
        show("Файл загружен. Декодируем, очищаем метаданные и проверяем фото…");
        await request(`/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(intent.image.id)}/complete`, { method: "POST", body: "{}" });
        progress.classList.add("hidden");
        show("Фото обработано.", "success");
        location.assign(`/app/new?project=${encodeURIComponent(projectId)}`);
      } catch (error) {
        progress.classList.add("hidden");
        show(errors[error.code] || "Не удалось обработать фотографию. Проверьте файл и повторите.", "error");
        button.disabled = false;
      }
    };
    dropZone.addEventListener("click", () => input.click());
    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
    });
    input.addEventListener("change", () => choose(input.files[0]));
    ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault(); dropZone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault(); dropZone.classList.remove("drag");
    }));
    dropZone.addEventListener("drop", (event) => choose(event.dataTransfer.files[0]));
    button.addEventListener("click", run);
  }

  function setupSettings() {
    const root = document.querySelector("#generation-app");
    const form = document.querySelector("#generation-form");
    if (!root || !form) return;
    const projectId = root.dataset.projectId;
    const imageId = root.dataset.imageId;
    const start = form.querySelector("#generation-start");
    const message = form.querySelector("#generation-message");
    const draftStatus = form.querySelector("#draft-status");
    const wishes = form.querySelector("#wishes");
    const count = form.querySelector("#wishes-count");
    const storageKey = `vizhufasad:stage10:draft:${projectId}`;
    let saveTimer;

    const configuration = () => {
      const data = new FormData(form);
      const description = String(data.get("paletteDescription") || "").trim();
      const preserve = {};
      ["geometry", "windows", "doors", "roof", "balconies", "terraces", "plot", "noNewFloors"]
        .forEach((name) => { preserve[name] = data.has(`preserve.${name}`); });
      return {
        version: "1",
        style: data.get("style"),
        materials: data.getAll("materials"),
        palette: [data.get("palettePreset"), description].filter(Boolean),
        preserve,
        transformationLevel: data.get("transformationLevel"),
        wishes: data.get("wishes"),
        negativeConstraints: [],
      };
    };
    const applyDraft = (config) => {
      if (!config || typeof config !== "object") return;
      if (config.style) form.elements.style.value = config.style;
      [...form.querySelectorAll('input[name="materials"]')].forEach((input) => { input.checked = (config.materials || []).includes(input.value); });
      if (config.palette?.[0]) form.elements.palettePreset.value = config.palette[0];
      form.elements.paletteDescription.value = config.palette?.slice(1).join(", ") || "";
      if (config.transformationLevel) form.elements.transformationLevel.value = config.transformationLevel;
      form.elements.wishes.value = config.wishes || "";
      Object.entries(config.preserve || {}).forEach(([name, value]) => {
        const input = form.elements[`preserve.${name}`]; if (input) input.checked = value;
      });
    };
    const save = async () => {
      const config = configuration();
      localStorage.setItem(storageKey, JSON.stringify(config));
      draftStatus.textContent = "Сохраняем настройки…";
      await request(`/api/projects/${encodeURIComponent(projectId)}/configuration`, {
        method: "PATCH", body: JSON.stringify(config),
      });
      draftStatus.textContent = "Настройки сохранены";
      return config;
    };
    const scheduleSave = () => {
      localStorage.setItem(storageKey, JSON.stringify(configuration()));
      draftStatus.textContent = "Есть несохранённые изменения";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save().catch(() => { draftStatus.textContent = "Черновик сохранён в этом браузере"; }), 700);
    };
    try { applyDraft(JSON.parse(localStorage.getItem(storageKey) || "null")); } catch {}
    const updateCount = () => { count.textContent = String(wishes.value.length); };
    updateCount();
    form.addEventListener("input", () => { updateCount(); scheduleSave(); });
    form.addEventListener("change", scheduleSave);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      start.disabled = true;
      message.className = "form-message";
      message.textContent = "Сохраняем настройки и ставим задачу в очередь…";
      try {
        clearTimeout(saveTimer);
        const config = await save();
        const keyName = `vizhufasad:stage10:start:${projectId}`;
        let idempotencyKey = localStorage.getItem(keyName);
        if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); localStorage.setItem(keyName, idempotencyKey); }
        const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/standard`, {
          method: "POST", headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ sourceImageId: imageId, input: config }),
        });
        localStorage.removeItem(keyName);
        location.assign(`/app/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(body.generation.id)}`);
      } catch (error) {
        start.disabled = false;
        message.className = "form-message error";
        message.textContent = errors[error.code] || "Не удалось запустить генерацию. Кредит не списан или будет автоматически возвращён.";
      }
    });
  }

  setupUpload();
  setupSettings();
})();
