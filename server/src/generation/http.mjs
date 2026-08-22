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
      return response.status(202).json({ generation });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:projectId/generations/pro", limiter, async (request, response, next) => {
    try {
      const idempotencyKey = request.get("idempotency-key") || request.body?.idempotencyKey;
      const generation = await generationService.createPro(
        request.auth.user_id,
        request.params.projectId,
        request.body?.sourceImageId,
        request.body?.input,
        idempotencyKey,
      );
      return response.status(202).json({ generation });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:projectId/generations/:generationId/edit-mask-upload", limiter, async (request, response, next) => {
    try {
      return response.status(201).json({
        upload: await generationService.createEditMaskUpload(
          request.auth.user_id,
          request.params.projectId,
          request.params.generationId,
          request.body,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:projectId/generations/:generationId/edits", limiter, async (request, response, next) => {
    try {
      const idempotencyKey = request.get("idempotency-key") || request.body?.idempotencyKey;
      return response.status(202).json({
        generation: await generationService.createEdit(
          request.auth.user_id,
          request.params.projectId,
          request.params.generationId,
          request.body,
          idempotencyKey,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/generations", async (request, response, next) => {
    try {
      return response.json({
        generations: await generationService.list(request.auth.user_id, request.params.projectId),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/generation-versions", async (request, response, next) => {
    try {
      return response.json({
        tree: await generationService.versionTree(request.auth.user_id, request.params.projectId),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:projectId/generation-versions/:generationId/restore", limiter, async (request, response, next) => {
    try {
      return response.json({
        generation: await generationService.restoreVersion(
          request.auth.user_id,
          request.params.projectId,
          request.params.generationId,
        ),
      });
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
  router.post("/:projectId/generations/:generationId/cancel", limiter, async (request, response, next) => {
    try {
      return response.json({
        generation: await generationService.cancel(
          request.auth.user_id,
          request.params.projectId,
          request.params.generationId,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.patch("/:projectId/generations/:generationId/favorite", limiter, async (request, response, next) => {
    try {
      return response.json({
        generation: await generationService.favorite(
          request.auth.user_id,
          request.params.projectId,
          request.params.generationId,
          request.body?.favorite,
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
      return response.status(202).json({ generation });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  return router;
}

export function createGenerationMetricsRouter({ metrics, config }) {
  const router = express.Router();
  router.get("/", async (request, response, next) => {
    try {
      if (!config.metricsToken || !tokenMatches(
        request.get("authorization")?.replace(/^Bearer\s+/iu, ""),
        config.metricsToken,
      )) {
        return response.status(404).json({ error: "NOT_FOUND" });
      }
      return response.json(await metrics.snapshot());
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
