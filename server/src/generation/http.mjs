import { timingSafeEqual } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "../auth/http.mjs";
import { GenerationError } from "./contract.mjs";

function respondError(response, error) {
  if (error instanceof GenerationError || error?.status) {
    return response.status(error.status || 500).json({ error: error.code || "GENERATION_FAILED" });
  }
  throw error;
}

export function createGenerationRouter({ authService, generationService }) {
  const router = express.Router();
  router.use(createRequireSession(authService));
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  router.post("/:projectId/generations/standard", limiter, async (request, response, next) => {
    try {
      const idempotencyKey = request.get("idempotency-key") || request.body?.idempotencyKey;
      const generation = await generationService.create(
        request.auth.user_id,
        request.params.projectId,
        request.body?.sourceImageId,
        request.body?.input,
        idempotencyKey,
      );
      return response.status(generation.status === "ready" ? 201 : 202).json({ generation });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/generations/:generationId", async (request, response, next) => {
    try {
      return response.json({
        generation: await generationService.view(
          request.auth.user_id,
          request.params.projectId,
          request.params.generationId,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/generations/:generationId/result-url", async (request, response, next) => {
    try {
      return response.json({
        url: await generationService.resultUrl(
          request.auth.user_id,
          request.params.projectId,
          request.params.generationId,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  return router;
}

function tokenMatches(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function createGenerationStagingRouter({ generationService, config }) {
  const router = express.Router();
  router.use((request, response, next) => {
    if (!config.stagingEnabled) return response.status(404).json({ error: "NOT_FOUND" });
    if (!tokenMatches(request.get("x-staging-secret"), config.stagingSecret)) {
      return response.status(401).json({ error: "STAGING_AUTH_REQUIRED" });
    }
    return next();
  });
  router.post("/standard", async (request, response, next) => {
    try {
      const generation = await generationService.create(
        request.body?.userId,
        request.body?.projectId,
        request.body?.sourceImageId,
        request.body?.input,
        request.body?.idempotencyKey,
      );
      return response.status(201).json({ generation });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  return router;
}
