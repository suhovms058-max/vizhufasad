import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "../auth/http.mjs";
import { ComparisonError } from "./contract.mjs";

function respondError(response, error) {
  if (error instanceof ComparisonError || error?.status) {
    return response.status(error.status || 500).json({ error: error.code || "COMPARISON_FAILED" });
  }
  throw error;
}

export function createComparisonRouter({ authService, comparisonService }) {
  const router = express.Router();
  router.use(createRequireSession(authService));
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  router.get("/comparison-access", async (request, response, next) => {
    try { return response.json(await comparisonService.access(request.auth.user_id)); }
    catch (error) { try { return respondError(response, error); } catch (unexpected) { return next(unexpected); } }
  });
  router.post("/:projectId/comparisons", limiter, async (request, response, next) => {
    try {
      return response.status(201).json({
        comparison: await comparisonService.create(request.auth.user_id, request.params.projectId, request.body),
      });
    } catch (error) { try { return respondError(response, error); } catch (unexpected) { return next(unexpected); } }
  });
  router.get("/:projectId/comparisons/:comparisonId", async (request, response, next) => {
    try {
      return response.json({
        comparison: await comparisonService.view(
          request.auth.user_id, request.params.projectId, request.params.comparisonId,
        ),
      });
    } catch (error) { try { return respondError(response, error); } catch (unexpected) { return next(unexpected); } }
  });
  router.patch("/:projectId/comparisons/:comparisonId/winner", limiter, async (request, response, next) => {
    try {
      return response.json({
        comparison: await comparisonService.selectWinner(
          request.auth.user_id, request.params.projectId, request.params.comparisonId,
          request.body?.generationId,
        ),
      });
    } catch (error) { try { return respondError(response, error); } catch (unexpected) { return next(unexpected); } }
  });
  router.patch("/:projectId/comparisons/:comparisonId/favorite", limiter, async (request, response, next) => {
    try {
      return response.json({
        comparison: await comparisonService.favorite(
          request.auth.user_id, request.params.projectId, request.params.comparisonId,
          request.body?.generationId, request.body?.favorite,
        ),
      });
    } catch (error) { try { return respondError(response, error); } catch (unexpected) { return next(unexpected); } }
  });
  router.post("/:projectId/comparisons/:comparisonId/collage", limiter, async (request, response, next) => {
    try {
      return response.status(201).json({
        comparison: await comparisonService.createCollage(
          request.auth.user_id, request.params.projectId, request.params.comparisonId,
        ),
      });
    } catch (error) { try { return respondError(response, error); } catch (unexpected) { return next(unexpected); } }
  });
  return router;
}
