(() => {
  const root = document.querySelector("#generation-app");
  if (!root) return;
  const form = document.querySelector("#generation-form");
  const start = document.querySelector("#generation-start");
  const cancel = document.querySelector("#generation-cancel");
  const message = document.querySelector("#generation-message");
  const result = document.querySelector("#generation-result");
  const steps = [...document.querySelectorAll("[data-step]")];
  const projectId = root.dataset.projectId;
  const imageId = root.dataset.imageId;
  let generationId = root.dataset.generationId;
  let timer;

  const stages = {
    created: ["analysis", "Заявка создана"],
    queued: ["analysis", "Задача ожидает свободный worker"],
    retrying: ["analysis", "Временная ошибка. Автоматически повторяем"],
    preprocessing: ["preprocessing", "Подготавливаем исходную фотографию"],
    generating: ["generating", "Создаём вариант фасада"],
    quality_check_pending: ["quality_check_pending", "Проверяем техническое качество результата"],
    completed: ["completed", "Результат готов"],
    failed_refunded: ["analysis", "Генерация не выполнена. Кредит возвращён"],
    cancelled: ["analysis", "Задача отменена. Кредит возвращён"],
  };
  const cancellable = new Set(["created", "queued", "retrying"]);

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "REQUEST_FAILED");
    return body;
  }

  function render(generation) {
    const [active, text] = stages[generation.status] || ["analysis", generation.status];
    const activeIndex = steps.findIndex((step) => step.dataset.step === active);
    steps.forEach((step, index) => step.classList.toggle("active", index <= activeIndex));
    message.textContent = text;
    message.className = generation.status === "failed_refunded" ? "error"
      : generation.status === "completed" ? "success" : "";
    start.disabled = !["failed_refunded", "cancelled"].includes(generation.status);
    cancel.classList.toggle("hidden", !cancellable.has(generation.status));
    if (generation.resultAvailable) {
      result.classList.remove("hidden");
      result.onclick = async (event) => {
        event.preventDefault();
        const body = await request(
          `/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generation.id)}/result-url`,
        );
        location.assign(body.url);
      };
    }
    if (["completed", "failed_refunded", "cancelled"].includes(generation.status)) {
      clearTimeout(timer);
    }
  }

  async function poll() {
    if (!generationId) return;
    try {
      const body = await request(
        `/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`,
      );
      render(body.generation);
      if (!["completed", "failed_refunded", "cancelled"].includes(body.generation.status)) {
        timer = setTimeout(poll, 2_000);
      }
    } catch {
      message.textContent = "Не удалось обновить статус. Повторяем…";
      timer = setTimeout(poll, 4_000);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    start.disabled = true;
    message.textContent = "Ставим задачу в очередь…";
    const values = new FormData(form);
    const split = (name) => String(values.get(name) || "").split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const body = await request(
        `/api/projects/${encodeURIComponent(projectId)}/generations/standard`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            sourceImageId: imageId,
            input: {
              style: values.get("style"),
              materials: split("materials"),
              palette: split("palette"),
              wishes: values.get("wishes"),
              transformationLevel: "gentle",
            },
          }),
        },
      );
      generationId = body.generation.id;
      root.dataset.generationId = generationId;
      render(body.generation);
      poll();
    } catch (error) {
      start.disabled = false;
      message.className = "error";
      message.textContent = error.message === "INSUFFICIENT_BALANCE"
        ? "Недостаточно кредитов."
        : "Не удалось поставить задачу в очередь.";
    }
  });

  cancel.addEventListener("click", async () => {
    if (!generationId) return;
    cancel.disabled = true;
    try {
      const body = await request(
        `/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/cancel`,
        { method: "POST", body: "{}" },
      );
      render(body.generation);
    } catch {
      message.textContent = "Задача уже выполняется и не может быть отменена.";
    } finally {
      cancel.disabled = false;
    }
  });

  if (generationId) poll();
})();
