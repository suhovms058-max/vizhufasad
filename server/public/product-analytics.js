(() => {
  const key = "vizhufasad:analytics-session:v1";
  let sessionId = sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(key, sessionId);
  }
  const track = (eventName, properties = {}) => fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName, sessionId, path: location.pathname, properties }),
    keepalive: true,
  }).catch(() => {});
  window.vizhufasadTrack = track;
  track("page_view");
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-analytics-event]");
    if (!target) return;
    track(target.dataset.analyticsEvent, {
      placement: target.dataset.analyticsPlacement || "",
      plan: target.dataset.analyticsPlan || "",
    });
  });
})();
