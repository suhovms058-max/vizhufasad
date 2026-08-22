(() => {
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "REQUEST_FAILED");
      error.code = body.error || "REQUEST_FAILED";
      throw error;
    }
    return body;
  }

  function directUpload(upload, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", upload.url);
      Object.entries(upload.headers || {}).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("MASK_UPLOAD_FAILED"));
      xhr.onerror = () => reject(new Error("MASK_UPLOAD_FAILED"));
      xhr.send(file);
    });
  }

  function setupResult() {
    const root = document.querySelector("#result-app");
    if (!root || root.dataset.status !== "completed") return;
    const projectId = root.dataset.projectId;
    const generationId = root.dataset.generationId;
    const message = root.querySelector("#stage12-message");
    const show = (text, kind = "") => {
      if (!message) return;
      message.textContent = text;
      message.className = `form-message ${kind}`;
    };

    const beforeAfter = document.querySelector("#comparison");
    const range = document.querySelector("#compare-range");
    const favorite = document.querySelector("#favorite-button");
    range?.addEventListener("input", () => beforeAfter?.style.setProperty("--position", `${range.value}%`));
    favorite?.addEventListener("click", async () => {
      const next = favorite.dataset.favorite !== "true";
      favorite.disabled = true;
      try {
        await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/favorite`, {
          method: "PATCH", body: JSON.stringify({ favorite: next }),
        });
        favorite.dataset.favorite = String(next);
        favorite.textContent = next ? "Убрать из избранного" : "В избранное";
      } catch { favorite.textContent = "Не удалось изменить избранное"; }
      finally { favorite.disabled = false; }
    });

    root.querySelectorAll(".restore-version").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      show("Возвращаем выбранную версию…");
      try {
        const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generation-versions/${encodeURIComponent(button.dataset.generationId)}/restore`, {
          method: "POST", body: "{}",
        });
        location.assign(`/app/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(body.generation.id)}`);
      } catch { show("Не удалось вернуться к версии. Обновите страницу и повторите.", "error"); button.disabled = false; }
    }));

    const editForm = root.querySelector("#edit-form");
    if (editForm) {
      const scope = editForm.querySelector("#edit-scope");
      const maskRow = editForm.querySelector("#edit-mask-row");
      const maskInput = editForm.querySelector("#edit-mask");
      const submit = editForm.querySelector("#edit-start");
      const updateMask = () => maskRow.classList.toggle("hidden", scope.value !== "custom_mask");
      scope.addEventListener("change", updateMask);
      updateMask();
      editForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!editForm.reportValidity()) return;
        submit.disabled = true;
        show("Подготавливаем доработку…");
        try {
          let maskKey = null;
          if (scope.value === "custom_mask") {
            const file = maskInput.files[0];
            if (!file || file.type !== "image/png" || file.size > 5 * 1024 * 1024) {
              throw Object.assign(new Error("INVALID_EDIT_MASK"), { code: "INVALID_EDIT_MASK" });
            }
            const intent = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/edit-mask-upload`, {
              method: "POST", body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
            });
            await directUpload(intent.upload, file);
            maskKey = intent.upload.key;
          }
          const keyName = `vizhufasad:stage12:edit:${projectId}:${generationId}`;
          let key = localStorage.getItem(keyName);
          if (!key) { key = crypto.randomUUID(); localStorage.setItem(keyName, key); }
          const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/edits`, {
            method: "POST", headers: { "Idempotency-Key": key },
            body: JSON.stringify({ scope: scope.value, command: editForm.elements.command.value, maskKey }),
          });
          localStorage.removeItem(keyName);
          location.assign(`/app/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(body.generation.id)}`);
        } catch (error) {
          const text = error.code === "INVALID_EDIT_MASK"
            ? "Нужна PNG-маска до 5 МБ точно того же размера, что результат."
            : error.code === "INSUFFICIENT_BALANCE" ? "Недостаточно кредитов для доработки."
              : "Доработка не запущена. Кредит не списан или будет автоматически возвращён.";
          show(text, "error");
          submit.disabled = false;
        }
      });
    }

    const upscaleStart = root.querySelector("#upscale-start");
    const upscaleStatus = root.querySelector("#upscale-status");
    if (upscaleStart) {
      let pollTimer;
      const renderUpscale = async (upscale) => {
        const labels = {
          created: "Задача создана.", queued: "4K ожидает свободный worker.", processing: "Увеличиваем изображение и проверяем артефакты.",
          completed: "4K готов.", failed_refunded: "4K не создан. Кредит возвращён.", cancelled: "Задача отменена, кредит возвращён.",
        };
        upscaleStatus.textContent = labels[upscale.status] || upscale.status;
        if (upscale.status === "completed") {
          clearTimeout(pollTimer);
          const result = await request(`/api/projects/${encodeURIComponent(projectId)}/upscales/${encodeURIComponent(upscale.id)}/result-url`);
          const link = document.createElement("a");
          link.className = "button secondary";
          link.href = result.url;
          link.download = "";
          link.textContent = `Скачать 4K (${upscale.output_width}×${upscale.output_height})`;
          upscaleStatus.after(link);
        } else if (["failed_refunded", "cancelled"].includes(upscale.status)) {
          clearTimeout(pollTimer);
          upscaleStart.disabled = false;
        } else {
          pollTimer = setTimeout(async () => {
            try {
              const body = await request(`/api/projects/${encodeURIComponent(projectId)}/upscales/${encodeURIComponent(upscale.id)}`);
              await renderUpscale(body.upscale);
            } catch { upscaleStatus.textContent = "Связь прервана. Статус 4K сохранён; обновите страницу позже."; }
          }, 2500);
        }
      };
      upscaleStart.addEventListener("click", async () => {
        upscaleStart.disabled = true;
        upscaleStatus.textContent = "Ставим 4K в очередь…";
        const keyName = `vizhufasad:stage12:upscale:${projectId}:${generationId}`;
        let key = localStorage.getItem(keyName);
        if (!key) { key = crypto.randomUUID(); localStorage.setItem(keyName, key); }
        try {
          const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/upscales`, {
            method: "POST", headers: { "Idempotency-Key": key }, body: "{}",
          });
          localStorage.removeItem(keyName);
          await renderUpscale(body.upscale);
        } catch (error) {
          upscaleStatus.textContent = error.code === "INSUFFICIENT_BALANCE" ? "Недостаточно кредитов для 4K."
            : "4K не запущен. Кредит не списан или будет автоматически возвращён.";
          upscaleStart.disabled = false;
        }
      });
    }

    const compareForm = root.querySelector("#comparison-create");
    compareForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ids = new FormData(compareForm).getAll("generationId");
      if (ids.length < 2 || ids.length > 4) return show("Выберите от двух до четырёх вариантов.", "error");
      const submit = compareForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      show("Готовим сравнение…");
      try {
        const body = await request(`/api/projects/${encodeURIComponent(projectId)}/comparisons`, {
          method: "POST", body: JSON.stringify({ generationIds: ids }),
        });
        location.assign(`/app/projects/${encodeURIComponent(projectId)}/comparisons/${encodeURIComponent(body.comparison.id)}`);
      } catch { show("Не удалось создать сравнение. Проверьте тариф и выбранные результаты.", "error"); submit.disabled = false; }
    });
  }

  function setupComparison() {
    const root = document.querySelector("#comparison-app");
    if (!root) return;
    const projectId = root.dataset.projectId;
    const comparisonId = root.dataset.comparisonId;
    const grid = root.querySelector(".comparison-grid");
    const zoom = root.querySelector("#sync-zoom");
    const zoomValue = root.querySelector("#sync-zoom-value");
    const message = root.querySelector("#comparison-message");
    const endpoint = `/api/projects/${encodeURIComponent(projectId)}/comparisons/${encodeURIComponent(comparisonId)}`;
    zoom?.addEventListener("input", () => {
      grid.style.setProperty("--comparison-zoom", String(Number(zoom.value) / 100));
      zoomValue.textContent = `${zoom.value}%`;
    });
    root.querySelectorAll(".comparison-card").forEach((card) => {
      const generationId = card.dataset.generationId;
      card.querySelector(".comparison-fullscreen")?.addEventListener("click", () => card.requestFullscreen?.());
      card.querySelector(".comparison-winner")?.addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        try {
          await request(`${endpoint}/winner`, { method: "PATCH", body: JSON.stringify({ generationId }) });
          location.reload();
        } catch { message.textContent = "Не удалось выбрать победителя."; event.currentTarget.disabled = false; }
      });
      card.querySelector(".comparison-favorite")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const favoriteValue = button.dataset.favorite !== "true";
        button.disabled = true;
        try {
          await request(`${endpoint}/favorite`, { method: "PATCH", body: JSON.stringify({ generationId, favorite: favoriteValue }) });
          button.dataset.favorite = String(favoriteValue);
          button.textContent = favoriteValue ? "Убрать из избранного" : "В избранное";
        } catch { message.textContent = "Не удалось изменить избранное."; }
        finally { button.disabled = false; }
      });
    });
    root.querySelector("#comparison-collage")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      message.textContent = "Создаём коллаж в одинаковом масштабе…";
      try {
        const body = await request(`${endpoint}/collage`, { method: "POST", body: "{}" });
        const link = document.createElement("a");
        link.className = "button secondary";
        link.href = body.comparison.collageUrl;
        link.download = "";
        link.textContent = "Скачать коллаж";
        message.textContent = "Коллаж готов.";
        message.after(link);
      } catch { message.textContent = "Не удалось создать коллаж."; event.currentTarget.disabled = false; }
    });
  }

  setupResult();
  setupComparison();
})();
