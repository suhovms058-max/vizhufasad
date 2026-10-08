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
    PHOTO_PROCESSING_CONSENT_STALE: "Условия согласия обновились. Нажмите «Обновить страницу», затем снова выберите фото и подтвердите обе отметки.",
    PHOTO_USAGE_RIGHTS_REQUIRED: "Подтвердите, что вправе использовать выбранную фотографию.",
    FREE_TRIAL_ALREADY_USED: "Пробный запуск уже использован на этом устройстве или для этого объекта.",
    FREE_TRIAL_REVIEW_REQUIRED: "Не удалось подтвердить право на пробный запуск. ВФ-коин не списан.",
    GENERATION_RATE_LIMITED: "Слишком много запусков за короткое время. Подождите несколько минут и повторите.",
    GENERATION_SOURCE_NOT_ELIGIBLE: "Фотография проекта изменилась или больше недоступна. Обновите страницу и повторите запуск.",
    NETWORK_ERROR: "Не удалось связаться с сервером. Проверьте интернет-соединение и повторите запуск.",
  };

  const safeStorage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
  };

  const createIdempotencyKey = () => {
    if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
    if (typeof window.crypto?.getRandomValues === "function") {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
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
      const fallbackCode = response.status === 429 ? "GENERATION_RATE_LIMITED" : "REQUEST_FAILED";
      const error = new Error(body.error || fallbackCode);
      error.code = body.error || fallbackCode;
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
      if (button.dataset.reloadRequired === "true") {
        location.reload();
        return;
      }
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
        if (error.code === "PHOTO_PROCESSING_CONSENT_STALE") {
          button.dataset.reloadRequired = "true";
          button.textContent = "Обновить страницу";
        }
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
    const phomiToggle = form.querySelector('input[name="materials"][value="гибкая керамика PHOMI"]');
    const phomiSubsystem = form.querySelector("#phomi-material-subsystem");
    const phomiChoices = [...form.querySelectorAll('#phomi-material-subsystem input[name="materials"]')];
    const phomiAutoChoice = form.querySelector('input[name="materials"][value="PHOMI — автоподбор фактуры ИИ"]');
    const genericAutoChoice = form.querySelector('input[name="materials"][value="автоподбор"]');
    const storageKey = `vizhufasad:stage10:draft:${projectId}`;
    const wizardStorageKey = `${storageKey}:step`;
    const wizardSteps = [...form.querySelectorAll("[data-wizard-step]")];
    const wizardProgress = [...form.querySelectorAll(".settings-progress li")];
    const wizardBack = form.querySelector("#settings-back");
    const wizardNext = form.querySelector("#settings-next");
    const summaryStyle = root.querySelector("#creator-summary-style");
    const summaryMaterials = root.querySelector("#creator-summary-materials");
    const summaryPalette = root.querySelector("#creator-summary-palette");
    const summaryPreserve = root.querySelector("#creator-summary-preserve");
    const zoneEditorEnabled = root.dataset.materialZonesEnabled === "true";
    const zoneOpen = form.querySelector("#material-zone-open");
    const zoneEditor = form.querySelector("#material-zone-editor");
    const zoneCanvas = form.querySelector("#material-zone-canvas");
    const zoneImage = form.querySelector("#material-zone-image");
    const zoneMaterialBar = form.querySelector("#material-zone-materials");
    const zoneList = form.querySelector("#material-zone-list");
    const zoneClose = form.querySelector("#material-zone-close");
    const zoneUndo = form.querySelector("#material-zone-undo");
    const zoneDelete = form.querySelector("#material-zone-delete");
    const zoneClear = form.querySelector("#material-zone-clear");
    const zoneDone = form.querySelector("#material-zone-done");
    const zoneStatus = form.querySelector("#material-zone-status");
    const zoneColors = ["#FF6B35", "#00B8D9", "#8B5CF6", "#22C55E"];
    let materialZones = [];
    let activeZoneMaterial = "";
    let activeZoneIndex = -1;
    let draftPolygon = [];
    let previewPoint = null;
    let zoneHistory = [];
    let saveTimer;
    let wizardStep = Math.min(3, Math.max(1, Number(safeStorage.get(wizardStorageKey)) || 1));

    const showWizardStep = (nextStep, focusHeading = false) => {
      const previousStep = wizardStep;
      wizardStep = Math.min(3, Math.max(1, nextStep));
      form.dataset.wizardCurrent = String(wizardStep);
      wizardSteps.forEach((step) => {
        const active = Number(step.dataset.wizardStep) === wizardStep;
        step.classList.toggle("hidden", !active);
        step.classList.remove("is-entering");
        if (active && focusHeading && previousStep !== wizardStep) {
          step.style.setProperty("--creator-step-direction", wizardStep > previousStep ? "24px" : "-24px");
          requestAnimationFrame(() => step.classList.add("is-entering"));
        }
      });
      wizardProgress.forEach((item, index) => {
        const active = index + 1 === wizardStep;
        item.toggleAttribute("aria-current", active);
        item.classList.toggle("completed", index + 1 < wizardStep);
      });
      wizardBack.classList.toggle("hidden", wizardStep === 1);
      wizardNext.classList.toggle("hidden", wizardStep === 3);
      start.classList.toggle("hidden", wizardStep !== 3);
      safeStorage.set(wizardStorageKey, String(wizardStep));
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

    const eligibleZoneMaterials = () => [...form.querySelectorAll('input[name="materials"]:checked')]
      .map((input) => input.value)
      .filter((material) => !/^(автоподбор|комбинированная|гибкая керамика PHOMI)$/iu.test(material));
    const zoneForMaterial = (material) => {
      let zone = materialZones.find((item) => item.material === material);
      if (!zone) {
        zone = { material, polygons: [] };
        materialZones.push(zone);
      }
      return zone;
    };
    const snapshotZones = () => JSON.parse(JSON.stringify(materialZones));
    const pushZoneHistory = () => {
      zoneHistory.push(snapshotZones());
      if (zoneHistory.length > 30) zoneHistory.shift();
      if (zoneUndo) zoneUndo.disabled = zoneHistory.length === 0 && draftPolygon.length === 0;
    };
    const materialMeta = (material) => {
      const input = [...form.querySelectorAll('input[name="materials"]')].find((item) => item.value === material);
      const image = input?.closest("label")?.querySelector(".material-photo");
      return { image: image?.currentSrc || image?.src || "", label: material };
    };
    const drawPolygon = (context, polygon, width, height, color, { draft = false } = {}) => {
      if (!polygon.length) return;
      context.beginPath();
      context.moveTo(polygon[0].x * width, polygon[0].y * height);
      polygon.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
      if (!draft) context.closePath();
      context.fillStyle = `${color}${draft ? "24" : "38"}`;
      context.strokeStyle = color;
      context.lineWidth = draft ? 2 : 2.5;
      context.lineJoin = "miter";
      context.setLineDash(draft ? [7, 5] : []);
      if (!draft) context.fill();
      context.stroke();
      context.setLineDash([]);
      polygon.forEach((point, pointIndex) => {
        context.beginPath();
        context.arc(point.x * width, point.y * height, pointIndex === 0 ? 6 : 4, 0, Math.PI * 2);
        context.fillStyle = pointIndex === 0 ? "#fff" : color;
        context.fill();
        context.strokeStyle = "#101410";
        context.lineWidth = 1.5;
        context.stroke();
      });
    };
    const renderZoneCanvas = () => {
      if (!zoneCanvas) return;
      const context = zoneCanvas.getContext("2d");
      const width = zoneCanvas.clientWidth;
      const height = zoneCanvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      if (zoneCanvas.width !== Math.round(width * ratio) || zoneCanvas.height !== Math.round(height * ratio)) {
        zoneCanvas.width = Math.max(1, Math.round(width * ratio));
        zoneCanvas.height = Math.max(1, Math.round(height * ratio));
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      materialZones.forEach((zone, index) => {
        zone.polygons.forEach((polygon) => drawPolygon(context, polygon, width, height, zoneColors[index % zoneColors.length]));
      });
      if (draftPolygon.length) {
        const zoneIndex = Math.max(0, materialZones.findIndex((zone) => zone.material === activeZoneMaterial));
        const draft = previewPoint ? [...draftPolygon, previewPoint] : draftPolygon;
        drawPolygon(context, draft, width, height, zoneColors[zoneIndex % zoneColors.length], { draft: true });
      }
    };
    const updateZoneStatus = (text) => {
      if (!zoneStatus) return;
      const completed = materialZones.reduce((total, zone) => total + zone.polygons.length, 0);
      zoneStatus.textContent = text || (draftPolygon.length
        ? `Точек: ${draftPolygon.length}. Добавьте минимум три и замкните контур.`
        : completed ? `Готово зон: ${completed}. Можно добавить ещё или сохранить раскладку.`
          : "Выберите материал и поставьте точки по углам нужной поверхности.");
      if (zoneClose) zoneClose.disabled = draftPolygon.length < 3;
      if (zoneDelete) zoneDelete.disabled = activeZoneIndex < 0;
      if (zoneUndo) zoneUndo.disabled = !draftPolygon.length && !zoneHistory.length;
    };
    const renderZoneList = () => {
      if (!zoneList) return;
      zoneList.replaceChildren();
      let serial = 0;
      materialZones.forEach((zone, zoneIndex) => zone.polygons.forEach((_polygon, polygonIndex) => {
        serial += 1;
        const itemSerial = serial;
        const meta = materialMeta(zone.material);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "material-zone-list-item";
        button.setAttribute("aria-pressed", String(activeZoneIndex === itemSerial - 1));
        button.innerHTML = `<img src="${meta.image}" alt=""><span><small>Зона ${String(itemSerial).padStart(2, "0")}</small><b>${meta.label}</b></span><i style="--zone-color:${zoneColors[zoneIndex % zoneColors.length]}" aria-hidden="true"></i>`;
        button.addEventListener("click", () => {
          activeZoneIndex = itemSerial - 1;
          activeZoneMaterial = zone.material;
          renderZoneMaterials();
          updateZoneStatus(`Выбрана зона ${itemSerial}: ${zone.material}.`);
        });
        button.dataset.zoneIndex = String(zoneIndex);
        button.dataset.polygonIndex = String(polygonIndex);
        zoneList.append(button);
      }));
      if (!serial) {
        const empty = document.createElement("p");
        empty.className = "material-zone-empty";
        empty.textContent = "Пока нет зон";
        zoneList.append(empty);
      }
    };
    const renderZoneMaterials = () => {
      if (!zoneMaterialBar) return;
      const selectedEligible = eligibleZoneMaterials();
      const eligible = selectedEligible.slice(0, zoneColors.length);
      materialZones = materialZones.filter((zone) => eligible.includes(zone.material));
      if (!eligible.includes(activeZoneMaterial)) activeZoneMaterial = eligible[0] || "";
      zoneMaterialBar.replaceChildren();
      eligible.forEach((material, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "material-zone-chip";
        button.dataset.material = material;
        button.setAttribute("aria-label", material);
        button.setAttribute("aria-pressed", String(material === activeZoneMaterial));
        const meta = materialMeta(material);
        const image = document.createElement("img");
        image.src = meta.image;
        image.alt = "";
        const copy = document.createElement("span");
        copy.innerHTML = `<b>${material}</b><small>Выбрать для контура</small>`;
        const marker = document.createElement("i");
        marker.style.setProperty("--zone-color", zoneColors[index]);
        marker.setAttribute("aria-hidden", "true");
        button.append(image, copy, marker);
        button.addEventListener("click", () => {
          if (draftPolygon.length) return updateZoneStatus("Сначала замкните или отмените текущий контур.");
          activeZoneMaterial = material;
          renderZoneMaterials();
          updateZoneStatus(`Материал: ${material}. Поставьте первую точку на углу поверхности.`);
        });
        zoneMaterialBar.append(button);
      });
      if (!eligible.length) updateZoneStatus("Выберите выше хотя бы один конкретный материал, затем откройте разметку.");
      else if (selectedEligible.length > zoneColors.length) updateZoneStatus("Для точной разметки используются первые четыре выбранных материала. Уберите лишние материалы, если хотите разметить другой вариант.");
      renderZoneList();
      renderZoneCanvas();
      updateZoneStatus();
    };
    const resizeZoneCanvas = () => requestAnimationFrame(renderZoneCanvas);
    const normalizedPointer = (event) => {
      const bounds = zoneCanvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      };
    };
    const snapPoint = (point, previous) => {
      if (!previous) return point;
      const dx = Math.abs(point.x - previous.x);
      const dy = Math.abs(point.y - previous.y);
      if (dx < 0.035) return { x: previous.x, y: point.y };
      if (dy < 0.035) return { x: point.x, y: previous.y };
      return point;
    };
    const closeDraftPolygon = () => {
      if (draftPolygon.length < 3 || !activeZoneMaterial) return;
      pushZoneHistory();
      const zone = zoneForMaterial(activeZoneMaterial);
      zone.polygons.push(draftPolygon.map((point) => ({ ...point })));
      draftPolygon = [];
      previewPoint = null;
      activeZoneIndex = materialZones.reduce((total, item) => total + item.polygons.length, 0) - 1;
      renderZoneMaterials();
      updateZoneStatus("Контур замкнут. Можно выбрать другой материал или добавить ещё одну зону.");
      scheduleSave();
    };
    const activeZoneLocation = () => {
      if (activeZoneIndex < 0) return null;
      let cursor = 0;
      for (let zoneIndex = 0; zoneIndex < materialZones.length; zoneIndex += 1) {
        for (let polygonIndex = 0; polygonIndex < materialZones[zoneIndex].polygons.length; polygonIndex += 1) {
          if (cursor === activeZoneIndex) return { zoneIndex, polygonIndex };
          cursor += 1;
        }
      }
      return null;
    };
    if (zoneEditorEnabled && zoneCanvas) {
      zoneOpen?.addEventListener("click", () => {
        const opening = zoneEditor.classList.contains("hidden");
        zoneEditor.classList.toggle("hidden", !opening);
        zoneOpen.setAttribute("aria-expanded", String(opening));
        zoneOpen.textContent = opening ? "Скрыть редактор" : "Открыть редактор зон";
        if (opening) { renderZoneMaterials(); resizeZoneCanvas(); }
      });
      zoneImage?.addEventListener("load", resizeZoneCanvas);
      new ResizeObserver(resizeZoneCanvas).observe(zoneCanvas.parentElement);
      zoneCanvas.addEventListener("pointerdown", (event) => {
        if (!activeZoneMaterial) return updateZoneStatus("Сначала выберите конкретный материал.");
        event.preventDefault();
        const point = snapPoint(normalizedPointer(event), draftPolygon.at(-1));
        const first = draftPolygon[0];
        const bounds = zoneCanvas.getBoundingClientRect();
        const closeDistance = 14 / Math.min(bounds.width, bounds.height);
        if (draftPolygon.length >= 3 && first && Math.hypot(first.x - point.x, first.y - point.y) <= closeDistance) return closeDraftPolygon();
        draftPolygon.push(point);
        activeZoneIndex = -1;
        previewPoint = null;
        renderZoneCanvas();
        updateZoneStatus();
      });
      zoneCanvas.addEventListener("pointermove", (event) => {
        if (!draftPolygon.length || event.pointerType === "touch") return;
        previewPoint = snapPoint(normalizedPointer(event), draftPolygon.at(-1));
        renderZoneCanvas();
      });
      zoneCanvas.addEventListener("dblclick", (event) => { event.preventDefault(); closeDraftPolygon(); });
      zoneClose?.addEventListener("click", closeDraftPolygon);
      zoneUndo?.addEventListener("click", () => {
        if (draftPolygon.length) {
          draftPolygon.pop();
          previewPoint = null;
          renderZoneCanvas();
          updateZoneStatus("Последняя точка удалена.");
          return;
        }
        const previous = zoneHistory.pop();
        if (previous) materialZones = previous;
        activeZoneIndex = -1;
        renderZoneMaterials();
        scheduleSave();
      });
      zoneDelete?.addEventListener("click", () => {
        const location = activeZoneLocation();
        if (!location) return;
        pushZoneHistory();
        materialZones[location.zoneIndex].polygons.splice(location.polygonIndex, 1);
        materialZones = materialZones.filter((zone) => zone.polygons.length);
        activeZoneIndex = -1;
        renderZoneMaterials();
        updateZoneStatus("Выбранная зона удалена.");
        scheduleSave();
      });
      zoneClear?.addEventListener("click", () => {
        if (!draftPolygon.length && !materialZones.some((zone) => zone.polygons.length)) return;
        pushZoneHistory();
        materialZones = [];
        draftPolygon = [];
        activeZoneIndex = -1;
        renderZoneMaterials();
        updateZoneStatus("Все зоны очищены.");
        scheduleSave();
      });
      zoneDone?.addEventListener("click", () => {
        zoneEditor.classList.add("hidden");
        zoneOpen.setAttribute("aria-expanded", "false");
        if (draftPolygon.length >= 3) closeDraftPolygon();
        else draftPolygon = [];
        zoneOpen.textContent = materialZones.some((zone) => zone.polygons.length) ? "Изменить раскладку" : "Открыть редактор зон";
        zoneOpen.focus();
        scheduleSave();
      });
    }

    const updatePhomiSubsystem = ({ clear = false } = {}) => {
      if (!phomiToggle || !phomiSubsystem) return;
      if (clear && !phomiToggle.checked) phomiChoices.forEach((input) => { input.checked = false; });
      phomiSubsystem.classList.toggle("hidden", !phomiToggle.checked);
      phomiToggle.setAttribute("aria-expanded", String(phomiToggle.checked));
    };
    phomiToggle?.addEventListener("change", () => {
      if (phomiToggle.checked && genericAutoChoice) genericAutoChoice.checked = false;
      updatePhomiSubsystem({ clear: true });
    });
    phomiChoices.forEach((input) => input.addEventListener("change", () => {
      if (input.checked && phomiToggle) {
        phomiToggle.checked = true;
        if (genericAutoChoice) genericAutoChoice.checked = false;
        if (input === phomiAutoChoice) phomiChoices.forEach((choice) => { if (choice !== input) choice.checked = false; });
        else if (phomiAutoChoice) phomiAutoChoice.checked = false;
      }
      updatePhomiSubsystem();
    }));
    genericAutoChoice?.addEventListener("change", () => {
      if (!genericAutoChoice.checked || !phomiToggle) return;
      phomiToggle.checked = false;
      phomiChoices.forEach((input) => { input.checked = false; });
      updatePhomiSubsystem();
    });

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
        materialZones: zoneEditorEnabled
          ? materialZones.filter((zone) => zone.polygons.length).map((zone) => ({
            material: zone.material,
            polygons: zone.polygons,
          }))
          : [],
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
    const flashSummary = (element) => {
      element?.classList.remove("creator-summary-flash");
      requestAnimationFrame(() => element?.classList.add("creator-summary-flash"));
    };
    const updateSummary = () => {
      const config = configuration();
      const materials = config.materials.length ? config.materials.join(", ") : "Автоподбор";
      const palette = config.palette.filter(Boolean).join(" · ") || "Автоподбор";
      if (summaryStyle && summaryStyle.textContent !== config.style) { summaryStyle.textContent = config.style; flashSummary(summaryStyle); }
      if (summaryMaterials && summaryMaterials.textContent !== materials) { summaryMaterials.textContent = materials; flashSummary(summaryMaterials); }
      if (summaryPalette && summaryPalette.textContent !== palette) { summaryPalette.textContent = palette; flashSummary(summaryPalette); }
      if (summaryPreserve) {
        const preserveText = "Архитектура, проёмы, кровля и входная группа защищены";
        if (summaryPreserve.textContent !== preserveText) { summaryPreserve.textContent = preserveText; flashSummary(summaryPreserve); }
      }
    };
    const applyDraft = (config) => {
      if (!config || typeof config !== "object") return;
      if (config.style) form.elements.style.value = config.style;
      [...form.querySelectorAll('input[name="materials"]')].forEach((input) => { input.checked = (config.materials || []).includes(input.value); });
      if (phomiChoices.some((input) => input.checked) && phomiToggle) phomiToggle.checked = true;
      if (config.palette?.[0]) form.elements.palettePreset.value = config.palette[0];
      form.elements.paletteDescription.value = config.palette?.slice(1).join(", ") || "";
      if (config.transformationLevel) form.elements.transformationLevel.value = config.transformationLevel;
      form.elements.wishes.value = config.wishes || "";
      materialZones = Array.isArray(config.materialZones)
        ? JSON.parse(JSON.stringify(config.materialZones)).map((zone) => ({ material: zone.material, polygons: Array.isArray(zone.polygons) ? zone.polygons : [] })).filter((zone) => zone.polygons.length)
        : [];
      updateStyleCards();
      renderZoneMaterials();
    };
    const save = async () => {
      const config = configuration();
      safeStorage.set(storageKey, JSON.stringify(config));
      draftStatus.textContent = "Сохраняем настройки…";
      await request(`/api/projects/${encodeURIComponent(projectId)}/configuration`, {
        method: "PATCH", body: JSON.stringify(config),
      });
      draftStatus.textContent = "Настройки сохранены";
      return config;
    };
    const scheduleSave = () => {
      safeStorage.set(storageKey, JSON.stringify(configuration()));
      draftStatus.textContent = "Есть несохранённые изменения";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save().catch(() => { draftStatus.textContent = "Черновик сохранён в этом браузере"; }), 700);
    };
    try { applyDraft(JSON.parse(safeStorage.get(storageKey) || "null")); } catch {}
    updateStyleCards();
    updatePhomiSubsystem();
    const updateCount = () => { count.textContent = String(wishes.value.length); };
    const updateGenerationKind = () => {
      const kind = new FormData(form).get("generationKind") === "pro" ? "pro" : "standard";
      const buttonLabel = kind === "pro" ? "Запустить Pro-генерацию" : "Запустить генерацию";
      const chargeLabel = kind === "pro" ? "Pro-генерацию" : "обычную генерацию";
      const cost = kind === "pro" ? root.dataset.proCost : root.dataset.standardCost;
      const balance = Number(root.dataset.balance || 0);
      const debitLabel = Number(cost) === 1 ? `списан ${vfCoinsLabel(cost)}` : `списано ${vfCoinsLabel(cost)}`;
      start.textContent = buttonLabel;
      costText.textContent = kind === "standard" && balance < Number(cost)
        ? "Подтверждаю запуск: сервис проверит право на первую бесплатную генерацию. При отказе ВФ-коин не списывается."
        : `Подтверждаю: с баланса будет ${debitLabel} за ${chargeLabel}. Проверка фото и скачивание бесплатны.`;
    };
    updateCount();
    updateGenerationKind();
    updateSummary();
    showWizardStep(wizardStep);
    window.vizhufasadTrack?.("settings_opened");
    wizardBack.addEventListener("click", () => showWizardStep(wizardStep - 1, true));
    wizardNext.addEventListener("click", () => showWizardStep(wizardStep + 1, true));
    form.addEventListener("input", () => { updateCount(); updateGenerationKind(); updateSummary(); scheduleSave(); });
    form.addEventListener("change", (event) => {
      if (event.target?.name === "materials") renderZoneMaterials();
      updateSummary(); scheduleSave();
    });
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
        const legacyKeyName = `vizhufasad:stage12:start:${kind}:${projectId}`;
        const keyName = `${legacyKeyName}:${imageId}`;
        safeStorage.remove(legacyKeyName);
        let idempotencyKey = safeStorage.get(keyName);
        if (!idempotencyKey) { idempotencyKey = createIdempotencyKey(); safeStorage.set(keyName, idempotencyKey); }
        const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${kind}`, {
          method: "POST", headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ sourceImageId: imageId, input: config }),
        });
        safeStorage.remove(keyName);
        safeStorage.remove(wizardStorageKey);
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
          const publicCode = /^[A-Z0-9_]{3,80}$/u.test(String(error.code || "")) ? ` Код: ${error.code}.` : "";
          message.textContent = errors[error.code] || `Не удалось запустить генерацию. ВФ-коин не списан.${publicCode}`;
        }
      }
    });
  }

  setupUpload();
  setupSettings();
})();
