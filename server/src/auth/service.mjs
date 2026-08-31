import {
  createChallengeId, createLoginCode, createSessionToken, hashAuthValue,
  normalizeEmail, parseCookies,
} from "./crypto.mjs";
import { personalDataConsentFromInput, verificationConsentsFromInput } from "../legal/documents.mjs";

export class AuthService {
  constructor({ repository, mailer, config, legalAcceptanceRepository, clock = () => new Date() }) {
    this.repository = repository;
    this.mailer = mailer;
    this.config = config;
    this.legalAcceptanceRepository = legalAcceptanceRepository;
    this.clock = clock;
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
