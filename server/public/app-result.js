(() => {
  const root = document.querySelector("#result-app");
  if (!root || root.dataset.status !== "completed") return;
  const comparison = document.querySelector("#comparison");
  const range = document.querySelector("#compare-range");
  const favorite = document.querySelector("#favorite-button");
  range?.addEventListener("input", () => comparison?.style.setProperty("--position", `${range.value}%`));
  favorite?.addEventListener("click", async () => {
    const next = favorite.dataset.favorite !== "true";
    favorite.disabled = true;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(root.dataset.projectId)}/generations/${encodeURIComponent(root.dataset.generationId)}/favorite`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorite: next }),
      });
      if (!response.ok) throw new Error("FAVORITE_FAILED");
      favorite.dataset.favorite = String(next);
      favorite.textContent = next ? "Убрать из избранного" : "В избранное";
    } catch { favorite.textContent = "Не удалось изменить избранное"; }
    finally { favorite.disabled = false; }
  });
})();
