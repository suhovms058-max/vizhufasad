import {
  createChallengeId, createLoginCode, createSessionToken, hashAuthValue,
  normalizeEmail, parseCookies,
} from "./crypto.mjs";

export class AuthService {
  constructor({ repository, mailer, config, clock = () => new Date() }) {
    this.repository = repository;
    this.mailer = mailer;
    this.config = config;
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

  async verifyCode({ challengeId, code }, context = {}) {
    if (!/^[0-9]{6}$/u.test(String(code || ""))) return { ok: false, reason: "INVALID_CODE" };
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
    return result.ok ? { ...result, token } : result;
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
