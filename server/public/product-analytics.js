(() => {
  const sessionKey = "vizhufasad:analytics-session:v1";
  const privacyKey = "vizhufasad:privacy:v1";
  const consentVersion = "2026-08-28";
  let choice = null;
  try { choice = JSON.parse(localStorage.getItem(privacyKey) || "null"); } catch { choice = null; }

  const analyticsAllowed = () => choice?.version === consentVersion && choice?.analytics === true;
  const sessionId = () => {
    if (!analyticsAllowed()) return null;
    let value = sessionStorage.getItem(sessionKey);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(sessionKey, value);
    }
    return value;
  };
  const track = (eventName, properties = {}) => {
    const currentSession = sessionId();
    if (!currentSession) return Promise.resolve();
    return fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName, sessionId: currentSession, path: location.pathname, properties, consent: { accepted: true, version: consentVersion } }),
    keepalive: true,
    }).catch(() => {});
  };

  const saveChoice = (analytics) => {
    choice = { version: consentVersion, analytics, decidedAt: new Date().toISOString() };
    localStorage.setItem(privacyKey, JSON.stringify(choice));
    if (!analytics) sessionStorage.removeItem(sessionKey);
    document.querySelector("[data-privacy-banner]")?.remove();
    if (analytics) track("page_view");
  };
  const showSettings = () => {
    document.querySelector("[data-privacy-banner]")?.remove();
    const banner = document.createElement("section");
    banner.className = "privacy-banner";
    banner.dataset.privacyBanner = "";
    banner.setAttribute("aria-label", "Необязательная аналитика");
    const detailsUrl = location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "https://vizhufasad.ru/legal/privacy"
      : "/legal/privacy";
    banner.innerHTML = `<div><strong>Необязательная аналитика</strong><p>Для входа и основных функций используются только необходимые cookie и браузерное хранилище. С вашего разрешения сервис может дополнительно собирать обезличенную статистику использования. Фото, email и тексты заданий в аналитику не передаются.</p><a href="${detailsUrl}">О данных и аналитике</a></div><div class="privacy-actions"><button type="button" class="secondary" data-privacy-essential>Оставить только необходимые</button><button type="button" data-privacy-analytics>Разрешить аналитику</button></div>`;
    document.body.append(banner);
    banner.querySelector("[data-privacy-essential]").addEventListener("click", () => saveChoice(false));
    banner.querySelector("[data-privacy-analytics]").addEventListener("click", () => saveChoice(true));
  };

  window.vizhufasadTrack = track;
  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-privacy-settings]")) showSettings();
  });
  if (!choice || choice.version !== consentVersion) showSettings();
  else if (analyticsAllowed()) track("page_view");
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-analytics-event]");
    if (!target) return;
    track(target.dataset.analyticsEvent, {
      placement: target.dataset.analyticsPlacement || "",
      plan: target.dataset.analyticsPlan || "",
    });
  });
})();
