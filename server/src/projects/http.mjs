import express from "express";
import rateLimit from "express-rate-limit";
import { createRequireSession } from "../auth/http.mjs";
import { ProjectError } from "./service.mjs";

function respondError(response, error) {
  if (error instanceof ProjectError) return response.status(error.status).json({ error: error.code });
  throw error;
}

export function createProjectsRouter({ authService, projectService }) {
  const router = express.Router();
  const requireSession = createRequireSession(authService);
  const mutationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  router.use(requireSession);

  router.get("/", async (request, response, next) => {
    try {
      return response.json({ projects: await projectService.list(request.auth.user_id) });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/", mutationLimiter, async (request, response, next) => {
    try {
      const project = await projectService.create(request.auth.user_id, request.body?.title);
      return response.status(201).json({ project });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId", async (request, response, next) => {
    try {
      return response.json({
        project: await projectService.open(request.auth.user_id, request.params.projectId),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.patch("/:projectId", mutationLimiter, async (request, response, next) => {
    try {
      return response.json({
        project: await projectService.rename(
          request.auth.user_id, request.params.projectId, request.body?.title,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.delete("/:projectId", mutationLimiter, async (request, response, next) => {
    try {
      await projectService.remove(request.auth.user_id, request.params.projectId);
      return response.status(204).end();
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:projectId/images/upload-intent", mutationLimiter, async (request, response, next) => {
    try {
      const result = await projectService.createUploadIntent(
        request.auth.user_id, request.params.projectId, request.body || {},
      );
      return response.status(201).json(result);
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post("/:projectId/images/:imageId/complete", mutationLimiter, async (request, response, next) => {
    try {
      const image = await projectService.completeUpload(
        request.auth.user_id, request.params.projectId, request.params.imageId,
      );
      return response.json({ image });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/images/:imageId/url", async (request, response, next) => {
    try {
      const variant = String(request.query.variant || "source");
      if (!["source", "working", "thumbnail"].includes(variant)) {
        return response.status(400).json({ error: "INVALID_IMAGE_VARIANT" });
      }
      return response.json({
        url: await projectService.imageUrl(
          request.auth.user_id, request.params.projectId, request.params.imageId, variant,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/:projectId/images/:imageId/assessment", async (request, response, next) => {
    try {
      return response.json({
        assessment: await projectService.getAssessment(
          request.auth.user_id, request.params.projectId, request.params.imageId,
        ),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.post(
    "/:projectId/images/:imageId/assessment/retry",
    mutationLimiter,
    async (request, response, next) => {
      try {
        return response.json({
          assessment: await projectService.retryAssessment(
            request.auth.user_id, request.params.projectId, request.params.imageId,
          ),
        });
      } catch (error) {
        try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
      }
    },
  );
  return router;
}
