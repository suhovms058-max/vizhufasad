import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "../auth/http.mjs";

function sameOrigin(request, siteOrigin) {
  const origin = request.get("origin");
  const fetchSite = String(request.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "same-origin" || !origin) return true;
  try { return new URL(origin).origin === new URL(siteOrigin).origin; } catch { return false; }
}

export function createOwnerAccessPagesRouter({ authService, ownerAccessService, siteOrigin }) {
  const router = express.Router();
  const requireHtmlSession = createRequireSession(authService, { html: true });
  const redeemLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  router.post(
    "/app/owner-access/redeem",
    redeemLimiter,
    express.urlencoded({ extended: false, limit: "4kb" }),
    requireHtmlSession,
    async (request, response, next) => {
      try {
        if (!sameOrigin(request, siteOrigin)) return response.status(403).send("Недопустимый источник запроса");
        const result = await ownerAccessService.redeem(request.auth.user_id, request.body);
        return response.redirect(303, `/app/balance?owner_access=${result.idempotent ? "existing" : "credited"}`);
      } catch (error) {
        if (error?.code) {
          return response.redirect(303, `/app/balance?owner_access_error=${encodeURIComponent(error.code)}`);
        }
        return next(error);
      }
    },
  );
  return router;
}
