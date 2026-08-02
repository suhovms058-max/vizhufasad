import { timingSafeEqual } from "node:crypto";
import express from "express";

function tokenMatches(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function publicDiagnostic(row, url) {
  return {
    id: row.id,
    generationId: row.generation_id,
    assessmentNumber: row.assessment_number,
    status: row.status,
    decision: row.decision,
    versions: {
      schema: row.schema_version,
      prompt: row.prompt_version,
      policy: row.policy_version,
      generationPrompt: row.generation_prompt_version,
    },
    provider: row.provider,
    model: row.model,
    generationProvider: row.generation_provider,
    generationModel: row.generation_model,
    scores: row.score_breakdown,
    overallScore: row.overall_score,
    failureReasons: row.failure_reasons,
    allowedChanges: row.allowed_changes,
    providerRequestId: row.provider_request_id,
    diagnosticExpiresAt: row.diagnostic_expires_at,
    diagnosticUrl: url,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function createGenerationQualityDiagnosticsRouter({ repository, storage, config }) {
  const router = express.Router();
  router.use((request, response, next) => {
    const token = request.get("authorization")?.replace(/^Bearer\s+/iu, "");
    if (!config.adminToken || !tokenMatches(token, config.adminToken)) {
      return response.status(404).json({ error: "NOT_FOUND" });
    }
    return next();
  });
  router.get("/:generationId", async (request, response, next) => {
    try {
      const rows = await repository.diagnostics(request.params.generationId);
      if (!rows.length) return response.status(404).json({ error: "QUALITY_DIAGNOSTICS_NOT_FOUND" });
      const now = Date.now();
      const assessments = await Promise.all(rows.map(async (row) => {
        const available = row.diagnostic_key
          && row.diagnostic_expires_at
          && new Date(row.diagnostic_expires_at).getTime() > now;
        const url = available
          ? await storage.createDownloadUrl(row.diagnostic_key, config.diagnosticUrlTtlSeconds)
          : null;
        return publicDiagnostic(row, url);
      }));
      return response.json({ assessments });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
