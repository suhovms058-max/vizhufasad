(() => {
  const root = document.querySelector("#result-app");
  if (!root || root.dataset.status === "completed") return;
  const message = root.querySelector("#generation-message");
  const cancel = root.querySelector("#generation-cancel");
  const steps = [...root.querySelectorAll("[data-step]")];
  const projectId = root.dataset.projectId;
  const generationId = root.dataset.generationId;
  let timer;
  const states = {
    created: ["analysis", "Задача создана. Резервируем кредит без окончательного списания."],
    queued: ["analysis", "Задача ожидает свободный worker."],
    retrying: ["analysis", "Технический сбой. Выполняется ограниченная автоматическая попытка."],
    preprocessing: ["preprocessing", "Подготавливаем исходную фотографию."],
    generating: ["generating", "Генератор создаёт вариант фасада."],
    quality_check_pending: ["quality_check_pending", "Автоматически проверяем дом, геометрию и артефакты."],
    completed: ["completed", "Проверенный результат готов."],
    failed_refunded: ["analysis", "Результат не прошёл автоматическую проверку. Кредит возвращён на баланс."],
    cancelled: ["analysis", "Задача отменена. Зарезервированный кредит возвращён."],
  };
  const cancellable = new Set(["created", "queued", "retrying"]);
  const terminal = new Set(["completed", "failed_refunded", "cancelled"]);
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "REQUEST_FAILED");
    return body;
  }
  function render(generation) {
    const [active, text] = states[generation.status] || ["analysis", generation.status];
    const activeIndex = steps.findIndex((step) => step.dataset.step === active);
    steps.forEach((step, index) => {
      step.classList.toggle("active", index <= activeIndex);
      step.classList.toggle("current", index === activeIndex && !terminal.has(generation.status));
    });
    message.textContent = text;
    message.className = generation.status === "failed_refunded" ? "form-message error"
      : generation.status === "completed" ? "form-message success" : "form-message";
    cancel?.classList.toggle("hidden", !cancellable.has(generation.status));
    if (generation.status === "completed") { clearTimeout(timer); location.reload(); }
    else if (terminal.has(generation.status)) clearTimeout(timer);
  }
  async function poll() {
    try {
      const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`);
      render(body.generation);
      if (!terminal.has(body.generation.status)) timer = setTimeout(poll, 2000);
    } catch {
      message.textContent = "Не удалось обновить статус. Подключение будет проверено снова.";
      timer = setTimeout(poll, 4000);
    }
  }
  cancel?.addEventListener("click", async () => {
    cancel.disabled = true;
    try {
      const body = await request(`/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/cancel`, { method: "POST", body: "{}" });
      render(body.generation);
    } catch { message.textContent = "Задача уже выполняется и больше не может быть отменена."; }
    finally { cancel.disabled = false; }
  });
  poll();
})();
