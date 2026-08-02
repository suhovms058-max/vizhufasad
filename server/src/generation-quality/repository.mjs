import { getPool } from "../db/client.mjs";

export class GenerationQualityRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async startAssessment({
    generationId, generationAttemptId, assessmentNumber, allowedChanges,
    diagnosticBucket, diagnosticKey, diagnosticMimeType, diagnosticExpiresAt,
    schemaVersion, promptVersion, policyVersion,
  }) {
    const result = await this.pool.query(
      `insert into generation_quality_assessments (
        generation_id, generation_attempt_id, assessment_number, status,
        allowed_changes, diagnostic_bucket, diagnostic_key, diagnostic_mime_type,
        diagnostic_expires_at, schema_version, prompt_version, policy_version
      ) values ($1, $2, $3, 'processing', $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (generation_id, assessment_number) do update set
        generation_attempt_id = excluded.generation_attempt_id,
        status = 'processing', decision = null, provider = null, model = null,
        provider_request_id = null, vlm_result = null, structural_result = null,
        score_breakdown = null, overall_score = null, failure_reasons = '[]'::jsonb,
        allowed_changes = excluded.allowed_changes,
        diagnostic_bucket = excluded.diagnostic_bucket,
        diagnostic_key = excluded.diagnostic_key,
        diagnostic_mime_type = excluded.diagnostic_mime_type,
        diagnostic_expires_at = excluded.diagnostic_expires_at,
        schema_version = excluded.schema_version,
        prompt_version = excluded.prompt_version,
        policy_version = excluded.policy_version,
        started_at = now(), finished_at = null, updated_at = now()
      where generation_quality_assessments.status = 'provider_unavailable'
      returning *`,
      [
        generationId, generationAttemptId, assessmentNumber, allowedChanges,
        diagnosticBucket, diagnosticKey, diagnosticMimeType, diagnosticExpiresAt,
        schemaVersion, promptVersion, policyVersion,
      ],
    );
    if (result.rowCount) return result.rows[0];
    const existing = await this.pool.query(
      `select * from generation_quality_assessments
       where generation_id = $1 and assessment_number = $2`,
      [generationId, assessmentNumber],
    );
    return existing.rows[0] ?? null;
  }

  async completeAssessment(assessmentId, result) {
    const completed = await this.pool.query(
      `update generation_quality_assessments set
        status = 'completed', decision = $2, provider = $3, model = $4,
        provider_request_id = $5, vlm_result = $6, structural_result = $7,
        score_breakdown = $8, overall_score = $9, failure_reasons = $10::jsonb,
        schema_version = $11, prompt_version = $12, policy_version = $13,
        finished_at = now(), updated_at = now()
       where id = $1 and status = 'processing'
       returning *`,
      [
        assessmentId, result.decision, result.provider, result.model,
        result.providerRequestId, result.vlmResult, result.structuralResult,
        result.scoreBreakdown, result.overallScore, JSON.stringify(result.failureReasons),
        result.schemaVersion, result.promptVersion, result.policyVersion,
      ],
    );
    return completed.rows[0] ?? null;
  }

  async markProviderUnavailable(assessmentId) {
    const result = await this.pool.query(
      `update generation_quality_assessments set status = 'provider_unavailable',
        finished_at = now(), updated_at = now()
       where id = $1 and status = 'processing' returning *`,
      [assessmentId],
    );
    return result.rows[0] ?? null;
  }

  async listForGeneration(generationId) {
    const result = await this.pool.query(
      `select * from generation_quality_assessments
       where generation_id = $1 order by assessment_number`,
      [generationId],
    );
    return result.rows;
  }

  async diagnostics(generationId) {
    const result = await this.pool.query(
      `select q.*, a.provider as generation_provider, a.model as generation_model,
              a.prompt_version as generation_prompt_version, a.seed,
              a.duration_ms as generation_duration_ms
       from generation_quality_assessments q
       join generation_attempts a on a.id = q.generation_attempt_id
       where q.generation_id = $1 order by q.assessment_number`,
      [generationId],
    );
    return result.rows;
  }

  async qualityMetrics() {
    const result = await this.pool.query(
      `select
        count(*) filter (where assessment_number = 1 and decision = 'passed')::int as first_pass,
        count(*) filter (where assessment_number = 1 and decision = 'retry_required')::int as retry_required,
        count(*) filter (where assessment_number = 2 and decision = 'passed')::int as retry_passed,
        count(*) filter (where assessment_number = 2 and decision = 'rejected_refund')::int as rejected_refunded,
        (select count(*)::int from wallet_transactions transaction
          where transaction.type = 'generation_refund'
            and exists (
              select 1 from generation_quality_assessments rejected
              where rejected.generation_id = transaction.reference_id
                and rejected.decision = 'rejected_refund'
            )) as refunds,
        coalesce(avg(overall_score) filter (where status = 'completed'), 0)::int as average_score
       from generation_quality_assessments`,
    );
    return result.rows[0];
  }

  async findExpiredDiagnostics(now = new Date(), limit = 100) {
    const result = await this.pool.query(
      `select id, diagnostic_key from generation_quality_assessments
       where diagnostic_key is not null and diagnostic_expires_at <= $1
       order by diagnostic_expires_at limit $2`,
      [now, limit],
    );
    return result.rows;
  }

  async clearDiagnostic(assessmentId) {
    await this.pool.query(
      `update generation_quality_assessments set
        diagnostic_bucket = null, diagnostic_key = null, diagnostic_mime_type = null,
        vlm_result = null, structural_result = null, score_breakdown = null,
        updated_at = now()
       where id = $1`,
      [assessmentId],
    );
  }
}
