import express from "express";
import rateLimit from "express-rate-limit";
import { hashAuthValue, normalizeEmail } from "./crypto.mjs";

function context(request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

function authError(response, status, code) {
  return response.status(status).json({ error: code });
}

export function createRequireSession(service, { html = false } = {}) {
  return async (request, response, next) => {
    try {
      const session = await service.sessionFromRequest(request);
      if (!session) {
        if (html) {
          const destination = String(request.originalUrl || "/app");
          const nextPath = destination.startsWith("/app") && !destination.startsWith("//") ? destination : "/app";
          return response.redirect(303, `/auth/login?next=${encodeURIComponent(nextPath)}`);
        }
        return authError(response, 401, "AUTH_REQUIRED");
      }
      request.auth = session;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function createAuthRouter({ service, config }) {
  const router = express.Router();
  const limiterDefaults = {
    windowMs: config.rateWindowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => authError(response, 429, "RATE_LIMITED"),
  };
  const requestIpLimiter = rateLimit({ ...limiterDefaults, limit: config.requestLimit });
  const requestEmailLimiter = rateLimit({
    ...limiterDefaults,
    limit: config.requestLimit,
    keyGenerator: (request) => {
      try {
        return hashAuthValue(config.hashSecret, "rate-email", normalizeEmail(request.body?.email));
      } catch {
        return hashAuthValue(config.hashSecret, "rate-email", "invalid");
      }
    },
  });
  const verifyLimiter = rateLimit({
    ...limiterDefaults,
    limit: config.verifyLimit,
    keyGenerator: (request) => hashAuthValue(
      config.hashSecret,
      "rate-challenge",
      String(request.body?.challengeId || "invalid"),
    ),
  });
  const requireSession = createRequireSession(service);

  router.post("/code/request", requestIpLimiter, requestEmailLimiter, async (request, response, next) => {
    try {
      const result = await service.requestCode(request.body?.email, context(request));
      return response.status(202).json(result);
    } catch (error) {
      if (error.message === "INVALID_EMAIL") return authError(response, 400, "INVALID_EMAIL");
      return next(error);
    }
  });

  router.post("/code/confirm", verifyLimiter, async (request, response, next) => {
    try {
      const result = await service.verifyCode(request.body || {}, context(request));
      if (!result.ok) {
        const status = result.reason === "ATTEMPTS_EXHAUSTED"
          ? 429
          : result.reason === "ACCOUNT_UNAVAILABLE" ? 403
            : result.reason === "LEGAL_CONSENT_REQUIRED" ? 400 : 401;
        return authError(response, status, result.reason);
      }
      response.cookie(config.cookieName, result.token, service.cookieOptions());
      return response.json({
        user: { id: result.user.id, email: result.user.email },
        session: { id: result.session.id, expiresAt: result.session.expires_at },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me", requireSession, (request, response) => response.json({
    user: { id: request.auth.user_id, email: request.auth.email },
    session: { id: request.auth.id, expiresAt: request.auth.expires_at },
  }));

  router.post("/logout", requireSession, async (request, response, next) => {
    try {
      await service.repository.revokeSession(request.auth.user_id, request.auth.id, "auth.logout");
      response.clearCookie(config.cookieName, service.clearCookieOptions());
      return response.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.get("/sessions", requireSession, async (request, response, next) => {
    try {
      const sessions = await service.repository.listSessions(request.auth.user_id);
      return response.json({
        sessions: sessions.map((session) => ({
          id: session.id,
          userAgent: session.user_agent,
          createdAt: session.created_at,
          lastSeenAt: session.last_seen_at,
          expiresAt: session.expires_at,
          current: session.id === request.auth.id,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/sessions/:id", requireSession, async (request, response, next) => {
    try {
      const revoked = await service.repository.revokeSession(request.auth.user_id, request.params.id);
      if (!revoked) return authError(response, 404, "SESSION_NOT_FOUND");
      if (request.params.id === request.auth.id) {
        response.clearCookie(config.cookieName, service.clearCookieOptions());
      }
      return response.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.post("/sessions/revoke-all", requireSession, async (request, response, next) => {
    try {
      await service.repository.revokeAllSessions(request.auth.user_id);
      response.clearCookie(config.cookieName, service.clearCookieOptions());
      return response.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.post("/account/deletion-request", requireSession, async (request, response, next) => {
    try {
      await service.repository.requestAccountDeletion(request.auth.user_id);
      response.clearCookie(config.cookieName, service.clearCookieOptions());
      return response.status(202).json({ status: "scheduled" });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
