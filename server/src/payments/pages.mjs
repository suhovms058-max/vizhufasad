import express from "express";
import { createRequireSession } from "../auth/http.mjs";
import { isCurrentLegalAcceptance, legalDocument } from "../legal/documents.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function sameOrigin(request, config) {
  const origin = request.get("origin");
  const fetchSite = String(request.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "same-origin") return true;
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(config.siteOrigin).origin; } catch { return false; }
}

export function createPaymentPagesRouter({ authService, paymentService, legalAcceptanceRepository, config }) {
  const router = express.Router();
  const requireHtmlSession = createRequireSession(authService, { html: true });
  router.post("/app/payments/checkout", express.urlencoded({ extended: false, limit: "8kb" }), requireHtmlSession, async (request, response, next) => {
    try {
      if (!sameOrigin(request, config)) return response.status(403).send("Недопустимый источник запроса");
      if (!isCurrentLegalAcceptance({
        accepted: request.body.offerAccepted === "yes",
        version: request.body.offerVersion,
        hash: request.body.offerHash,
      }, "offer")) return response.redirect(303, "/app/balance?payment_error=OFFER_ACCEPTANCE_REQUIRED");
      const result = await paymentService.createCheckout(request.auth, request.body, request.body.idempotencyKey);
      const offer = legalDocument("offer");
      await legalAcceptanceRepository.record({
        userId: request.auth.user_id,
        documentKey: offer.key,
        documentVersion: offer.revision,
        documentHash: offer.hash,
        context: "payment_checkout",
        paymentId: result.payment.id,
      });
      if (!result.checkout) return response.redirect(303, `/app/balance?payment=${result.payment.id}`);
      return response.redirect(303, result.checkout.url);
    } catch (error) {
      if (error?.code) return response.redirect(303, `/app/balance?payment_error=${encodeURIComponent(error.code)}`);
      return next(error);
    }
  });
  router.post("/app/payments/:id/refund", express.urlencoded({ extended: false, limit: "8kb" }), requireHtmlSession, async (request, response, next) => {
    try {
      if (!sameOrigin(request, config)) return response.status(403).send("Недопустимый источник запроса");
      await paymentService.refund(request.auth.user_id, request.params.id, { reason: "customer_request" }, request.body.idempotencyKey);
      return response.redirect(303, "/app/balance?refund=pending");
    } catch (error) {
      if (error?.code) return response.redirect(303, `/app/balance?payment_error=${encodeURIComponent(error.code)}`);
      return next(error);
    }
  });
  router.post("/app/payments/:id/cancel", express.urlencoded({ extended: false, limit: "8kb" }), requireHtmlSession, async (request, response, next) => {
    try {
      if (!sameOrigin(request, config)) return response.status(403).send("Недопустимый источник запроса");
      await paymentService.cancel(request.auth.user_id, request.params.id);
      return response.redirect(303, "/app/balance?payment_cancel=ok");
    } catch (error) {
      if (error?.code) return response.redirect(303, `/app/balance?payment_error=${encodeURIComponent(error.code)}`);
      return next(error);
    }
  });
  return router;
}
