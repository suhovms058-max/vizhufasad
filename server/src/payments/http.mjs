import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "../auth/http.mjs";
import { PaymentError } from "./contract.mjs";

function sendError(response, error) {
  if (error instanceof PaymentError || (error?.code && Number.isInteger(error?.status))) {
    return response.status(error.status || 400).json({ error: error.code || error.message });
  }
  throw error;
}

export function createPaymentRouter({ authService, paymentService }) {
  const router = express.Router();
  router.use(createRequireSession(authService));
  router.get("/", async (request, response, next) => {
    try {
      return response.json({ payments: await paymentService.history(request.auth.user_id, request.query.limit) });
    } catch (error) {
      try { return sendError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:id", async (request, response, next) => {
    try {
      return response.json({ payment: await paymentService.view(request.auth.user_id, request.params.id) });
    } catch (error) {
      try { return sendError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/checkout", rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true }), async (request, response, next) => {
    try {
      const result = await paymentService.createCheckout(
        request.auth,
        request.body,
        request.get("idempotency-key"),
      );
      return response.status(result.idempotent ? 200 : 201).json(result);
    } catch (error) {
      try { return sendError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:id/refund", rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: true }), async (request, response, next) => {
    try {
      const refund = await paymentService.refund(
        request.auth.user_id,
        request.params.id,
        request.body,
        request.get("idempotency-key"),
      );
      return response.status(202).json({ refund });
    } catch (error) {
      try { return sendError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:id/cancel", async (request, response, next) => {
    try {
      return response.json(await paymentService.cancel(request.auth.user_id, request.params.id));
    } catch (error) {
      try { return sendError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/subscriptions", (_request, response) => response.status(404).json({ error: "SUBSCRIPTIONS_DISABLED" }));
  return router;
}

export function createPaymentWebhookRouter({ paymentService }) {
  const router = express.Router();
  router.post(
    "/robokassa/result",
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (request, response, next) => {
      try {
        const result = await paymentService.handleResult(request.body || {});
        return response.status(200).type("text/plain").send(result.acknowledgment);
      } catch (error) {
        try { return sendError(response, error); } catch (unexpected) { return next(unexpected); }
      }
    },
  );
  router.post(
    "/robokassa/result2",
    express.text({ type: () => true, limit: "32kb" }),
    async (request, response, next) => {
      try {
        await paymentService.handleResult2(request.body);
        return response.status(200).type("text/plain").send("OK");
      } catch (error) {
        try { return sendError(response, error); } catch (unexpected) { return next(unexpected); }
      }
    },
  );
  return router;
}
