(() => {
  const landingDraft = {
    database: "vizhufasad-browser-drafts",
    store: "files",
    key: "landing-photo-v1",
    maxAgeMs: 30 * 60 * 1000,
  };

  const openDraftDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(landingDraft.database, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(landingDraft.store)) {
        request.result.createObjectStore(landingDraft.store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const readLandingDraft = async () => {
    const database = await openDraftDatabase();
    const draft = await new Promise((resolve, reject) => {
      const request = database.transaction(landingDraft.store).objectStore(landingDraft.store).get(landingDraft.key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    if (!draft?.file || Date.now() - Number(draft.savedAt || 0) > landingDraft.maxAgeMs) return null;
    return draft.file;
  };

  const deleteLandingDraft = async () => {
    const database = await openDraftDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(landingDraft.store, "readwrite");
      transaction.objectStore(landingDraft.store).delete(landingDraft.key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  };

  const errors = {
    AUTH_REQUIRED: "Сессия истекла. Войдите снова.",
    HEIF_CONVERSION_REQUIRED: "Этот сервер не может надёжно обработать HEIC/HEIF. Конвертируйте фото в JPG.",
    UNSUPPORTED_IMAGE_TYPE: "Поддерживаются JPG, PNG и WEBP.",
    IMAGE_SIZE_LIMIT: "Файл должен быть не больше 25 МБ.",
    IMAGE_TOO_SMALL: "Разрешение фотографии меньше 640×420.",
    PIXEL_LIMIT_EXCEEDED: "У изображения слишком большое число пикселей.",
    MIME_DECODER_MISMATCH: "Содержимое файла не соответствует его формату.",
    IMAGE_DECODE_FAILED: "Файл повреждён или не декодируется.",
    PHOTO_ANONYMIZATION_UNAVAILABLE: "Не удалось безопасно подготовить фотографию. Скройте лица, номера и адресные данные вручную либо загрузите другой снимок.",
    PHOTO_ANONYMIZATION_MODELS_MISSING: "Не удалось безопасно подготовить фотографию. Скройте лица, номера и адресные данные вручную либо загрузите другой снимок.",
    PHOTO_ANONYMIZATION_DETECTOR_FAILED: "Автоматическая защита данных не завершилась. Скройте лица, номера и адресные данные вручную либо загрузите другой снимок.",
    PHOTO_ANONYMIZATION_TIMEOUT: "Автоматическая защита данных не завершилась вовремя. Скройте лица, номера и адресные данные вручную либо загрузите другой снимок.",
    PHOTO_ANONYMIZATION_DOCUMENT_SUSPECTED: "На фотографии обнаружен документ или много читаемого текста. Скройте данные вручную либо загрузите снимок фасада без документов и адресных табличек.",
    INSUFFICIENT_BALANCE: "Недостаточно ВФ-коинов для генерации.",
    STANDARD_GENERATION_DISABLED: "Генерация фасада пока не включена на этом сервере.",
    PRO_GENERATION_DISABLED: "Pro пока не включён: модель должна пройти реальную проверку качества.",
    PHOTO_PROCESSING_CONSENT_REQUIRED: "Подтвердите отдельное согласие на обработку фотографии.",
    FREE_TRIAL_ALREADY_USED: "Пробный запуск уже использован на этом устройстве или для этого объекта.",
    FREE_TRIAL_REVIEW_REQUIRED: "Не удалось подтвердить право на пробный запуск. ВФ-коин не списан.",
  };

  const vfCoinsLabel = (value) => {
    const amount = Number(value);
    const mod100 = amount % 100;
    const mod10 = amount % 10;
    const noun = mod100 >= 11 && mod100 <= 14
      ? "ВФ-коинов"
      : mod10 === 1 ? "ВФ-коин" : mod10 >= 2 && mod10 <= 4 ? "ВФ-коина" : "ВФ-коинов";
    return `${amount} ${noun}`;
  };

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      });
    } catch {
      const error = new Error("NETWORK_ERROR");
      error.code = "NETWORK_ERROR";
      throw error;
    }
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "REQUEST_FAILED");
      error.code = body.error || "REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    return body;
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function waitForAssessment(projectId, imageId, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const body = await request(`/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}/assessment`);
        if (["completed", "provider_unavailable"].includes(body.assessment?.status)) return body.assessment;
      } catch (error) {
        if (![404, 409, 502, 503, 504].includes(error.status) && error.code !== "NETWORK_ERROR") throw error;
      }
      await wait(1_500);
    }
    const error = new Error("PHOTO_ASSESSMENT_STATUS_TIMEOUT");
    error.code = "PHOTO_ASSESSMENT_STATUS_TIMEOUT";
    throw error;
  }

  function setupUpload() {
    const root = document.querySelector("#upload-app");
    if (!root) return;
    const dropZone = root.querySelector("#drop-zone");
    const photoPicker = root.querySelector("#photo-picker");
    const input = root.querySelector("#photo-input");
    const preview = root.querySelector("#preview");
    const previewShell = root.querySelector("#preview-shell");
    const replacePhoto = root.querySelector("#replace-photo");
    const removePhoto = root.querySelector("#remove-photo");
    const info = root.querySelector("#file-info");
    const progress = root.querySelector("#progress");
    const message = root.querySelector("#message");
    const button = root.querySelector("#upload-button");
    const title = root.querySelector("#project-title");
    const processingConsent = root.querySelector("#photo-processing-consent");
    const usageRights = root.querySelector("#photo-usage-rights");
    const accepted = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
    let selectedFile;
    let previewUrl;

    const show = (text, kind = "") => { message.textContent = text; message.className = `form-message ${kind}`; };
    const updateUploadButton = () => {
      button.disabled = !selectedFile || !processingConsent.checked || !usageRights.checked;
    };
    const clearSelection = () => {
      selectedFile = undefined;
      input.value = "";
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      preview.removeAttribute("src");
      previewShell.classList.add("hidden");
      info.textContent = "";
      updateUploadButton();
      show("");
    };
    const inspectDimensions = (file) => new Promise((resolve) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return resolve(null);
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dimensions);
      };
      image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      image.src = url;
    });
    const choose = async (file) => {
      if (!file) return;
      if (!accepted.has(file.type)) return show("Выберите JPG, PNG, WEBP или HEIC/HEIF.", "error");
      if (file.size > 25 * 1024 * 1024) return show(errors.IMAGE_SIZE_LIMIT, "error");
      const dimensions = await inspectDimensions(file);
      if (dimensions && (dimensions.width < 640 || dimensions.height < 420)) {
        clearSelection();
        return show(`${errors.IMAGE_TOO_SMALL} Выбрано: ${dimensions.width}×${dimensions.height}.`, "error");
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      selectedFile = file;
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      previewShell.classList.remove("hidden");
      const dimensionsText = dimensions ? ` · ${dimensions.width}×${dimensions.height}` : "";
      info.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ${dimensionsText}`;
      updateUploadButton();
      show(dimensions && (dimensions.width < 1200 || dimensions.height < 800)
        ? "Фото подходит по минимальному размеру. Для более детального результата лучше использовать снимок от 1200×800."
        : "Фотография готова к безопасной загрузке.", "success");
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
      if (!processingConsent.checked || !usageRights.checked) {
        show("Подтвердите согласие на обработку фотографии и право её использовать.", "error");
        updateUploadButton();
        return;
      }
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
          body: JSON.stringify({
            filename: selectedFile.name,
            mimeType: selectedFile.type,
            byteSize: selectedFile.size,
            consent: { accepted: true, version: root.dataset.consentVersion, hash: root.dataset.consentHash },
            rights: { accepted: true, version: root.dataset.rightsVersion, hash: root.dataset.rightsHash },
          }),
        });
        show("Загружаем напрямую в приватное хранилище…");
        await directUpload(intent.upload, selectedFile);
        progress.removeAttribute("value");
        show("Файл загружен. Декодируем, очищаем метаданные и проверяем фото…");
        try {
          await request(`/api/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(intent.image.id)}/complete`, { method: "POST", body: "{}" });
        } catch (error) {
          if (![502, 504].includes(error.status) && error.code !== "NETWORK_ERROR") throw error;
          show("Соединение прервалось, но фото уже загружено. Получаем результат автоматической проверки…");
          await waitForAssessment(projectId, intent.image.id);
        }
        window.vizhufasadTrack?.("photo_upload_completed", { outcome: "processed" });
        await deleteLandingDraft().catch(() => {});
        progress.classList.add("hidden");
        show("Фото обработано.", "success");
        location.assign(`/app/new?project=${encodeURIComponent(projectId)}`);
      } catch (error) {
        progress.classList.add("hidden");
        show(errors[error.code] || "Не удалось обработать фотографию. Проверьте файл и повторите.", "error");
        updateUploadButton();
      }
    };
    photoPicker.addEventListener("click", () => input.click());
    input.addEventListener("change", () => choose(input.files[0]));
    replacePhoto.addEventListener("click", () => input.click());
    removePhoto.addEventListener("click", clearSelection);
    processingConsent.addEventListener("change", updateUploadButton);
    usageRights.addEventListener("change", updateUploadButton);
    ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault(); dropZone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault(); dropZone.classList.remove("drag");
    }));
    dropZone.addEventListener("drop", (event) => choose(event.dataTransfer.files[0]));
    button.addEventListener("click", run);
    if (new URLSearchParams(location.search).get("from") === "landing") {
      readLandingDraft()
        .then((draft) => draft && choose(draft))
        .catch(() => show("Выберите фотографию ещё раз — браузер не сохранил локальный черновик.", "error"));
    }
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
    const costText = form.querySelector("#cost-confirm-text");
    const styleSelect = form.querySelector("#style");
    const styleCards = [...form.querySelectorAll("[data-style]")];
    const storageKey = `vizhufasad:stage10:draft:${projectId}`;
    const wizardStorageKey = `${storageKey}:step`;
    const wizardSteps = [...form.querySelectorAll("[data-wizard-step]")];
    const wizardProgress = [...form.querySelectorAll(".settings-progress li")];
    const wizardBack = form.querySelector("#settings-back");
    const wizardNext = form.querySelector("#settings-next");
    let saveTimer;
    let wizardStep = Math.min(3, Math.max(1, Number(localStorage.getItem(wizardStorageKey)) || 1));

    const showWizardStep = (nextStep, focusHeading = false) => {
      wizardStep = Math.min(3, Math.max(1, nextStep));
      form.dataset.wizardCurrent = String(wizardStep);
      wizardSteps.forEach((step) => step.classList.toggle("hidden", Number(step.dataset.wizardStep) !== wizardStep));
      wizardProgress.forEach((item, index) => {
        const active = index + 1 === wizardStep;
        item.toggleAttribute("aria-current", active);
        item.classList.toggle("completed", index + 1 < wizardStep);
      });
      wizardBack.classList.toggle("hidden", wizardStep === 1);
      wizardNext.classList.toggle("hidden", wizardStep === 3);
      start.classList.toggle("hidden", wizardStep !== 3);
      localStorage.setItem(wizardStorageKey, String(wizardStep));
      if (focusHeading) {
        const heading = wizardSteps[wizardStep - 1]?.querySelector("h2");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
      }
    };

    const updateStyleCards = () => {
      styleCards.forEach((card) => {
        const active = card.dataset.style === styleSelect.value;
        card.classList.toggle("active", active);
        card.setAttribute("aria-pressed", String(active));
      });
    };
    styleCards.forEach((card) => card.addEventListener("click", () => {
      styleSelect.value = card.dataset.style;
      updateStyleCards();
      styleSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }));
    styleSelect.addEventListener("change", updateStyleCards);

    const configuration = () => {
      const data = new FormData(form);
      const description = String(data.get("paletteDescription") || "").trim();
      const preserve = {
        geometry: true, floors: true, noNewFloors: true, roof: true,
        windows: true, doors: true, balconies: true, terraces: true,
        plot: false, perspective: true, housePosition: true,
      };
      return {
        version: "1",
        style: data.get("style"),
        materials: data.getAll("materials"),
        palette: [
          data.get("palettePreset"),
          ...description.split(",").map((item) => item.trim()).filter(Boolean),
        ].filter(Boolean),
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
      updateStyleCards();
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
    updateStyleCards();
    const updateCount = () => { count.textContent = String(wishes.value.length); };
    const updateGenerationKind = () => {
      const kind = new FormData(form).get("generationKind") === "pro" ? "pro" : "standard";
      const buttonLabel = kind === "pro" ? "Запустить Pro-генерацию" : "Запустить генерацию";
      const chargeLabel = kind === "pro" ? "Pro-генерацию" : "обычную генерацию";
      const cost = kind === "pro" ? root.dataset.proCost : root.dataset.standardCost;
      const balance = Number(root.dataset.balance || 0);
      start.textContent = buttonLabel;
      costText.textContent = kind === "standard" && balance < Number(cost)
        ? "Подтверждаю запуск: сервис проверит право на первую бесплатную генерацию. При отказе ВФ-коин не списывается."
        : `Подтверждаю: с баланса будет списан ${vfCoinsLabel(cost)} за ${chargeLabel}. Проверка фото и скачивание бесплатны.`;
    };
    updateCount();
    updateGenerationKind();
    showWizardStep(wizardStep);
    window.vizhufasadTrack?.("settings_opened");
    wizardBack.addEventListener("click", () => showWizardStep(wizardStep - 1, true));
    wizardNext.addEventListener("click", () => showWizardStep(wizardStep + 1, true));
    form.addEventListener("input", () => { updateCount(); updateGenerationKind(); scheduleSave(); });
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
        const kind = new FormData(form).get("generationKind") === "pro" ? "pro" : "standard";
        window.vizhufasadTrack?.("generation_started", { generationKind: kind });
        const keyName = `vizhufasad:stage12:start:${kind}:${projectId}`;
        let idempotencyKey = localStorage.getItem(keyName);
        if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); localStorage.setItem(keyName, idempotencyKey); }
        const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${kind}`, {
          method: "POST", headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ sourceImageId: imageId, input: config }),
        });
        localStorage.removeItem(keyName);
        localStorage.removeItem(wizardStorageKey);
        location.assign(`/app/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(body.generation.id)}`);
      } catch (error) {
        start.disabled = false;
        message.className = "form-message error";
        if (["FREE_TRIAL_ALREADY_USED", "FREE_TRIAL_REVIEW_REQUIRED"].includes(error.code)) {
          message.replaceChildren(document.createTextNode(`${errors[error.code]} `));
          const pricing = document.createElement("a");
          pricing.href = "/app/balance";
          pricing.textContent = "Выбрать пакет";
          const support = document.createElement("a");
          support.href = "mailto:vizhufasad0058@bk.ru";
          support.textContent = "написать в поддержку";
          message.append(pricing, document.createTextNode(" или "), support, document.createTextNode("."));
        } else {
          message.textContent = errors[error.code] || "Не удалось запустить генерацию. ВФ-коин не списан или будет автоматически возвращён.";
        }
      }
    });
  }

  setupUpload();
  setupSettings();
})();
