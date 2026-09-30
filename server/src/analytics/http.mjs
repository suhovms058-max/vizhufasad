import express from "express";
import { tokenMatches } from "./service.mjs";

export function createProductAnalyticsRouter({ service }) {
  const router = express.Router();
  router.post("/events", async (request, response, next) => {
    try {
      const result = await service.record(request.body);
      return response.status(result.accepted ? 202 : 400).json(result);
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

export function createEconomicsMetricsRouter({ repository, token }) {
  const router = express.Router();
  router.get("/", async (request, response, next) => {
    try {
      if (!token || !tokenMatches(request.get("authorization")?.replace(/^Bearer\s+/iu, ""), token)) {
        return response.status(404).json({ error: "NOT_FOUND" });
      }
      return response.json(await repository.economicsSnapshot(request.query.days));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
