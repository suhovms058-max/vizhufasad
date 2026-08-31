function integer(value, fallback, name, minimum = 1) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function boolean(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

export function loadAuthConfig(environment = process.env) {
  const production = environment.NODE_ENV === "production";
  const mailMode = environment.AUTH_MAIL_MODE || (production ? "smtp" : "console");
  if (!["smtp", "console"].includes(mailMode)) throw new Error("AUTH_MAIL_MODE must be smtp or console");
  if (production && mailMode !== "smtp") {
    throw new Error("AUTH_MAIL_MODE=console is forbidden when NODE_ENV=production");
  }
  const cookieSecure = boolean(environment.AUTH_COOKIE_SECURE, production);
  if (production && !cookieSecure) {
    throw new Error("AUTH_COOKIE_SECURE=false is forbidden when NODE_ENV=production");
  }

  const hashSecret = environment.AUTH_HASH_SECRET || "";
  if (hashSecret.length < 32) throw new Error("AUTH_HASH_SECRET must contain at least 32 characters");

  const smtp = {
    host: environment.SMTP_HOST || "smtp.mail.ru",
    port: integer(environment.SMTP_PORT, 465, "SMTP_PORT"),
    secure: boolean(environment.SMTP_SECURE, true),
    user: environment.SMTP_USER || "",
    password: environment.SMTP_PASSWORD || "",
    from: environment.AUTH_EMAIL_FROM || environment.SMTP_USER || "",
  };
  if (mailMode === "smtp" && (!smtp.user || !smtp.password || !smtp.from)) {
    throw new Error("SMTP_USER, SMTP_PASSWORD and AUTH_EMAIL_FROM are required in SMTP auth mail mode");
  }

  return {
    production,
    mailMode,
    hashSecret,
    smtp,
    codeTtlSeconds: integer(environment.AUTH_CODE_TTL_SECONDS, 600, "AUTH_CODE_TTL_SECONDS"),
    codeMaxAttempts: integer(environment.AUTH_CODE_MAX_ATTEMPTS, 5, "AUTH_CODE_MAX_ATTEMPTS"),
    requestLimit: integer(environment.AUTH_CODE_REQUEST_LIMIT, 5, "AUTH_CODE_REQUEST_LIMIT"),
    verifyLimit: integer(environment.AUTH_CODE_VERIFY_LIMIT, 10, "AUTH_CODE_VERIFY_LIMIT"),
    rateWindowMs: integer(environment.AUTH_RATE_WINDOW_MS, 15 * 60 * 1000, "AUTH_RATE_WINDOW_MS"),
    sessionTtlSeconds: integer(environment.AUTH_SESSION_TTL_SECONDS, 30 * 24 * 60 * 60, "AUTH_SESSION_TTL_SECONDS"),
    cookieName: environment.AUTH_COOKIE_NAME || "vizhufasad_session",
    deviceCookieName: environment.FREE_TRIAL_DEVICE_COOKIE_NAME || "vizhufasad_device",
    deviceTtlSeconds: integer(environment.FREE_TRIAL_DEVICE_TTL_SECONDS, 180 * 24 * 60 * 60, "FREE_TRIAL_DEVICE_TTL_SECONDS"),
    cookieSecure,
  };
}
