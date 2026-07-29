(() => {
  const root = document.querySelector("#upload-app");
  if (!root) return;
  const dropZone = document.querySelector("#drop-zone");
  const input = document.querySelector("#photo-input");
  const preview = document.querySelector("#preview");
  const info = document.querySelector("#file-info");
  const progress = document.querySelector("#progress");
  const message = document.querySelector("#message");
  const button = document.querySelector("#upload-button");
  const title = document.querySelector("#project-title");
  const accepted = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  let selectedFile;

  const errors = {
    AUTH_REQUIRED: "Сессия истекла. Войдите снова.",
    HEIF_CONVERSION_REQUIRED: "Этот сервер не может надёжно обработать HEIC/HEIF. Конвертируйте фото в JPG.",
    UNSUPPORTED_IMAGE_TYPE: "Поддерживаются JPG, PNG и WEBP.",
    IMAGE_SIZE_LIMIT: "Размер файла должен быть не больше 25 МБ.",
    IMAGE_TOO_SMALL: "Разрешение фото меньше 640×420.",
    PIXEL_LIMIT_EXCEEDED: "У изображения слишком большое число пикселей.",
    UNSUPPORTED_OR_MISMATCHED_IMAGE: "Содержимое файла не соответствует поддерживаемому формату.",
    IMAGE_DECODE_FAILED: "Файл повреждён или не может быть декодирован.",
  };

  function show(text, kind = "") {
    message.textContent = text;
    message.className = kind;
  }

  function choose(file) {
    if (!file) return;
    if (!accepted.has(file.type)) return show("Выберите JPG, PNG, WEBP или HEIC/HEIF.", "error");
    if (file.size > 25 * 1024 * 1024) return show(errors.IMAGE_SIZE_LIMIT, "error");
    selectedFile = file;
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
    info.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ`;
    button.disabled = false;
    show("");
  }

  async function jsonRequest(url, options) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    });
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "REQUEST_FAILED");
      error.code = body.error;
      throw error;
    }
    return body;
  }

  function directUpload(upload, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", upload.url);
      Object.entries(upload.headers || {}).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) progress.value = Math.round((event.loaded / event.total) * 90);
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error("DIRECT_UPLOAD_FAILED"));
      xhr.onerror = () => reject(new Error("DIRECT_UPLOAD_FAILED"));
      xhr.send(file);
    });
  }

  async function run() {
    if (!selectedFile || !title.value.trim()) return;
    button.disabled = true;
    progress.value = 1;
    progress.classList.remove("hidden");
    show("Подготавливаем безопасную загрузку…");
    try {
      let projectId = root.dataset.projectId;
      if (!projectId) {
        const created = await jsonRequest("/api/projects", {
          method: "POST", body: JSON.stringify({ title: title.value.trim() }),
        });
        projectId = created.project.id;
        root.dataset.projectId = projectId;
        history.replaceState(null, "", `/app/new?project=${encodeURIComponent(projectId)}`);
      } else {
        await jsonRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH", body: JSON.stringify({ title: title.value.trim() }),
        });
      }
      const intent = await jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/images/upload-intent`, {
        method: "POST",
        body: JSON.stringify({
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          byteSize: selectedFile.size,
        }),
      });
      show("Загружаем напрямую в приватное хранилище…");
      await directUpload(intent.upload, selectedFile);
      progress.value = 92;
      show("Проверяем и создаём безопасные копии…");
      await jsonRequest(
        `/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(intent.image.id)}/complete`,
        { method: "POST", body: "{}" },
      );
      progress.value = 100;
      show("Фотография готова.", "success");
      location.assign(`/app/projects/${encodeURIComponent(projectId)}`);
    } catch (error) {
      show(errors[error.code] || "Не удалось обработать фотографию. Проверьте файл и повторите.", "error");
      button.disabled = false;
    }
  }

  dropZone.addEventListener("click", () => input.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") input.click();
  });
  input.addEventListener("change", () => choose(input.files[0]));
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag");
  }));
  dropZone.addEventListener("drop", (event) => choose(event.dataTransfer.files[0]));
  button.addEventListener("click", run);
})();
