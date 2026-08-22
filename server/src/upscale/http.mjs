import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "../auth/http.mjs";
import { UpscaleError } from "./contract.mjs";

function respondError(response, error) {
  if (error instanceof UpscaleError || error?.status) {
    return response.status(error.status || 500).json({ error: error.code || "UPSCALE_FAILED" });
  }
  throw error;
}

export function createUpscaleRouter({ authService, upscaleService }) {
  const router = express.Router();
  router.use(createRequireSession(authService));
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });
  router.post("/:projectId/generations/:generationId/upscales", limiter, async (request, response, next) => {
    try {
      const key = request.get("idempotency-key") || request.body?.idempotencyKey;
      return response.status(202).json({
        upscale: await upscaleService.create(
          request.auth.user_id, request.params.projectId, request.params.generationId, key,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/upscales/:upscaleId", async (request, response, next) => {
    try {
      return response.json({
        upscale: await upscaleService.view(request.auth.user_id, request.params.projectId, request.params.upscaleId),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/upscales/:upscaleId/result-url", async (request, response, next) => {
    try {
      return response.json({
        url: await upscaleService.resultUrl(request.auth.user_id, request.params.projectId, request.params.upscaleId),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:projectId/upscales/:upscaleId/cancel", limiter, async (request, response, next) => {
    try {
      return response.json({
        upscale: await upscaleService.cancel(request.auth.user_id, request.params.projectId, request.params.upscaleId),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  return router;
}
