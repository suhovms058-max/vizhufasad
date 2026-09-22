import {
  createChallengeId, createLoginCode, createSessionToken, hashAuthValue, hashPassword,
  normalizeEmail, parseCookies, validatePassword, verifyPassword,
} from "./crypto.mjs";
import { personalDataConsentFromInput, verificationConsentsFromInput } from "../legal/documents.mjs";

export class AuthService {
  constructor({ repository, mailer, config, legalAcceptanceRepository, clock = () => new Date() }) {
    this.repository = repository;
    this.mailer = mailer;
    this.config = config;
    this.legalAcceptanceRepository = legalAcceptanceRepository;
    this.clock = clock;
    this.dummyCredential = hashPassword("dummy-password-not-used", {
      minimum: this.config.passwordMinLength || 10,
      maximum: this.config.passwordMaxLength || 128,
    });
  }

  requestHash(value, namespace) {
    if (!value) return null;
    return hashAuthValue(this.config.hashSecret, namespace, String(value));
  }

  async requestCode(input, context = {}) {
    const consent = personalDataConsentFromInput(input);
    if (!consent.valid) return { ok: false, reason: "PERSONAL_DATA_CONSENT_REQUIRED" };
    const email = normalizeEmail(input?.email);
    const challengeId = createChallengeId();
    const code = createLoginCode();
    const expiresAt = new Date(this.clock().getTime() + this.config.codeTtlSeconds * 1000);
    await this.repository.createLoginCode({
      id: challengeId,
      email,
      codeHash: hashAuthValue(this.config.hashSecret, "login-code", `${challengeId}:${code}`),
      requestIpHash: this.requestHash(context.ip, "request-ip"),
      userAgent: String(context.userAgent || "").slice(0, 256) || null,
      attemptsRemaining: this.config.codeMaxAttempts,
      expiresAt,
      consent,
    });
    try {
      await this.mailer.sendLoginCode({ email, code, expiresInSeconds: this.config.codeTtlSeconds });
    } catch (error) {
      await this.repository.invalidateLoginCode(challengeId);
      throw error;
    }
    return { ok: true, challengeId, expiresInSeconds: this.config.codeTtlSeconds };
  }

  async verifyCode(input, context = {}) {
    const { challengeId, code } = input || {};
    if (!/^[0-9]{6}$/u.test(String(code || ""))) return { ok: false, reason: "INVALID_CODE" };
    const consents = verificationConsentsFromInput(input);
    if (!consents.every((consent) => consent.valid)) return { ok: false, reason: "LEGAL_CONSENT_REQUIRED" };
    const token = createSessionToken();
    const result = await this.repository.authenticateWithCode({
      challengeId,
      codeHash: hashAuthValue(this.config.hashSecret, "login-code", `${challengeId}:${code}`),
      tokenHash: hashAuthValue(this.config.hashSecret, "session", token),
      requestIpHash: this.requestHash(context.ip, "request-ip"),
      deviceHash: context.deviceHash || null,
      userAgent: String(context.userAgent || "").slice(0, 256) || null,
      expiresAt: new Date(this.clock().getTime() + this.config.sessionTtlSeconds * 1000),
      now: this.clock(),
    });
    if (!result.ok) return result;
    if (!this.legalAcceptanceRepository) throw new Error("LEGAL_ACCEPTANCE_REPOSITORY_REQUIRED");
    for (const consent of consents) {
      await this.legalAcceptanceRepository.record({
        userId: result.user.id,
        documentKey: consent.document.key,
        documentVersion: consent.document.revision,
        documentHash: consent.document.hash,
        context: "account_login",
      });
    }
    return { ...result, token };
  }

  async loginWithPassword(input, context = {}) {
    let email;
    try {
      email = normalizeEmail(input?.email);
    } catch {
      email = "invalid@example.invalid";
    }
    const rawPassword = String(input?.password ?? "");
    const passwordWithinBounds = rawPassword.length >= 1
      && rawPassword.length <= (this.config.passwordMaxLength || 128);
    const credential = await this.repository.findPasswordCredential(email);
    const checkedCredential = credential?.password_hash ? credential : await this.dummyCredential;
    const matches = await verifyPassword(passwordWithinBounds ? rawPassword : "invalid-password", checkedCredential);
    const now = this.clock();
    const unavailable = !credential || !credential.password_hash || credential.status !== "active"
      || credential.account_deletion_requested_at
      || (credential.locked_until && new Date(credential.locked_until) > now);
    if (!matches || unavailable) {
      if (credential?.password_hash && !unavailable) {
        await this.repository.recordPasswordFailure(credential.user_id, {
          maxAttempts: this.config.passwordMaxAttempts,
          lockedUntil: new Date(now.getTime() + this.config.passwordLockSeconds * 1000),
        });
      }
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }
    const token = createSessionToken();
    const result = await this.repository.authenticateWithPassword({
      userId: credential.user_id,
      tokenHash: hashAuthValue(this.config.hashSecret, "session", token),
      requestIpHash: this.requestHash(context.ip, "request-ip"),
      userAgent: String(context.userAgent || "").slice(0, 256) || null,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlSeconds * 1000),
      now,
    });
    return result.ok ? { ...result, token } : result;
  }

  async passwordStatus(userId) {
    const credential = await this.repository.findPasswordCredentialByUserId?.(userId);
    return { configured: Boolean(credential?.password_hash) };
  }

  async setPassword(input, session) {
    if (!session?.user_id) return { ok: false, reason: "AUTH_REQUIRED" };
    if (String(input?.password || "") !== String(input?.passwordConfirmation || "")) {
      return { ok: false, reason: "PASSWORD_CONFIRMATION_MISMATCH" };
    }
    let password;
    try {
      password = validatePassword(input?.password, {
        minimum: this.config.passwordMinLength,
        maximum: this.config.passwordMaxLength,
      });
    } catch {
      return { ok: false, reason: "INVALID_PASSWORD" };
    }
    const createdAt = new Date(session.created_at || 0);
    if (!Number.isFinite(createdAt.getTime()) || this.clock().getTime() - createdAt.getTime() > 30 * 60 * 1000) {
      return { ok: false, reason: "RECENT_LOGIN_REQUIRED" };
    }
    const credential = await hashPassword(password, {
      minimum: this.config.passwordMinLength,
      maximum: this.config.passwordMaxLength,
    });
    const result = await this.repository.setPasswordCredential(session.user_id, credential, {
      currentSessionId: session.id,
    });
    return { ok: true, ...result };
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: this.config.sessionTtlSeconds * 1000,
    };
  }

  clearCookieOptions() {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    return options;
  }

  deviceCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: (this.config.deviceTtlSeconds || 180 * 24 * 60 * 60) * 1000,
    };
  }

  deviceHashFromRequest(request) {
    const token = parseCookies(request.headers.cookie)[this.config.deviceCookieName || "vizhufasad_device"];
    return token ? hashAuthValue(this.config.hashSecret, "free-trial-device", token) : null;
  }

  ensureDeviceCookie(request, response) {
    const existing = this.deviceHashFromRequest(request);
    if (existing) return existing;
    const token = createSessionToken();
    response.cookie(this.config.deviceCookieName || "vizhufasad_device", token, this.deviceCookieOptions());
    return hashAuthValue(this.config.hashSecret, "free-trial-device", token);
  }

  riskContextFromRequest(request) {
    const rawIp = String(request.ip || "").trim();
    const ipv4 = rawIp.replace(/^::ffff:/u, "");
    const network = /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(ipv4)
      ? ipv4.split(".").slice(0, 3).join(".")
      : rawIp.split(":").slice(0, 4).join(":");
    return {
      deviceHash: request.auth?.device_hash || this.deviceHashFromRequest(request),
      ipHash: this.requestHash(rawIp, "free-trial-ip"),
      networkHash: this.requestHash(network, "free-trial-network"),
    };
  }

  async sessionFromRequest(request) {
    const token = parseCookies(request.headers.cookie)[this.config.cookieName];
    if (!token) return null;
    const session = await this.repository.findSession(hashAuthValue(this.config.hashSecret, "session", token));
    return session ? { ...session, device_hash: this.deviceHashFromRequest(request) } : null;
  }
}
