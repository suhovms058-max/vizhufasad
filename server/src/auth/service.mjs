import {
  createChallengeId, createLoginCode, createSessionToken, hashAuthValue,
  normalizeEmail, parseCookies,
} from "./crypto.mjs";
import { accountConsentsFromInput } from "../legal/documents.mjs";

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

  async requestCode(rawEmail, context = {}) {
    const email = normalizeEmail(rawEmail);
    const challengeId = createChallengeId();
    const code = createLoginCode();
    const expiresAt = new Date(this.clock().getTime() + this.config.codeTtlSeconds * 1000);
    await this.repository.createLoginCode({
      id: challengeId,
      email,
      codeHash: hashAuthValue(this.config.hashSecret, "login-code", `${challengeId}:${code}`),
      requestIpHash: this.requestHash(context.ip, "request-ip"),
      attemptsRemaining: this.config.codeMaxAttempts,
      expiresAt,
    });
    try {
      await this.mailer.sendLoginCode({ email, code, expiresInSeconds: this.config.codeTtlSeconds });
    } catch (error) {
      await this.repository.invalidateLoginCode(challengeId);
      throw error;
    }
    return { challengeId, expiresInSeconds: this.config.codeTtlSeconds };
  }

  async verifyCode(input, context = {}) {
    const { challengeId, code } = input || {};
    if (!/^[0-9]{6}$/u.test(String(code || ""))) return { ok: false, reason: "INVALID_CODE" };
    const consents = accountConsentsFromInput(input);
    if (!consents.every((consent) => consent.valid)) return { ok: false, reason: "LEGAL_CONSENT_REQUIRED" };
    const token = createSessionToken();
    const result = await this.repository.authenticateWithCode({
      challengeId,
      codeHash: hashAuthValue(this.config.hashSecret, "login-code", `${challengeId}:${code}`),
      tokenHash: hashAuthValue(this.config.hashSecret, "session", token),
      requestIpHash: this.requestHash(context.ip, "request-ip"),
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

  async sessionFromRequest(request) {
    const token = parseCookies(request.headers.cookie)[this.config.cookieName];
    if (!token) return null;
    return this.repository.findSession(hashAuthValue(this.config.hashSecret, "session", token));
  }
}
