import { getPool } from "../db/client.mjs";

export class GenerationRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async createOwned({
    userId,
    projectId,
    sourceImageId,
    idempotencyKey,
    configSnapshot,
    geometryPolicySnapshot,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const duplicate = await client.query(
        `select g.* from generations g
         join projects p on p.id = g.project_id
         where g.idempotency_key = $1 and p.user_id = $2 and p.deleted_at is null`,
        [idempotencyKey, userId],
      );
      if (duplicate.rowCount) {
        await client.query("commit");
        return { generation: duplicate.rows[0], created: false };
      }
      const source = await client.query(
        `select i.*, p.geometry_policy, a.decision as assessment_decision
         from source_images i
         join projects p on p.id = i.project_id
         join photo_assessments a on a.source_image_id = i.id
         where p.id = $1 and p.user_id = $2 and p.deleted_at is null
           and i.id = $3 and i.status = 'ready'
           and a.status = 'completed'
           and a.decision in ('accepted', 'accepted_with_warning')
         for update of p`,
        [projectId, userId, sourceImageId],
      );
      if (!source.rowCount) {
        await client.query("rollback");
        return null;
      }
      const revision = await client.query(
        "select coalesce(max(revision), 0) + 1 as revision from generations where project_id = $1",
        [projectId],
      );
      const inserted = await client.query(
        `insert into generations (
          project_id, source_image_id, revision, status, idempotency_key,
          config_snapshot, geometry_policy_snapshot
        ) values ($1, $2, $3, 'queued', $4, $5, $6)
        returning *`,
        [
          projectId,
          sourceImageId,
          Number(revision.rows[0].revision),
          idempotencyKey,
          configSnapshot,
          geometryPolicySnapshot,
        ],
      );
      await client.query(
        "update projects set status = 'generation_queued', updated_at = now() where id = $1",
        [projectId],
      );
      await client.query("commit");
      return {
        generation: inserted.rows[0],
        source: source.rows[0],
        created: true,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async attachReservation(generationId, reservationId) {
    const result = await this.pool.query(
      `update generations set wallet_reservation_id = $2, status = 'processing', updated_at = now()
       where id = $1 and status = 'queued' returning *`,
      [generationId, reservationId],
    );
    return result.rows[0] ?? null;
  }

  async startAttempt({ generationId, attemptNumber, provider, model, promptVersion, seed, estimatedCostMinor, currency }) {
    const result = await this.pool.query(
      `insert into generation_attempts (
        generation_id, attempt_number, status, provider, model, prompt_version,
        seed, estimated_cost_minor, cost_currency
      ) values ($1, $2, 'started', $3, $4, $5, $6, $7, $8)
      returning *`,
      [generationId, attemptNumber, provider, model, promptVersion, seed, estimatedCostMinor, currency],
    );
    return result.rows[0];
  }

  async succeedAttempt(attemptId, result) {
    await this.pool.query(
      `update generation_attempts set status = 'succeeded',
        provider_request_id = $2, model = $3, seed = $4, duration_ms = $5,
        estimated_cost_minor = $6, actual_cost_minor = $7, cost_currency = $8,
        finished_at = now()
       where id = $1`,
      [
        attemptId, result.jobId, result.model, result.seed, result.durationMs,
        result.estimatedCostMinor, result.actualCostMinor, result.currency,
      ],
    );
  }

  async failAttempt(attemptId, error) {
    await this.pool.query(
      `update generation_attempts set status = $2, error_code = $3,
        error_details = $4, finished_at = now()
       where id = $1`,
      [
        attemptId,
        error.retryable ? "retryable_failed" : "terminal_failed",
        String(error.code || "GENERATION_PROVIDER_FAILED").slice(0, 120),
        error.details == null ? {} : { provider: String(error.details).slice(0, 500) },
      ],
    );
  }

  async markReady({ generationId, projectId, bucket, key, mimeType }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update generations set status = 'ready', result_bucket = $2, result_key = $3,
          result_mime_type = $4, failure_code = null, completed_at = now(), updated_at = now()
         where id = $1 and status = 'processing' returning *`,
        [generationId, bucket, key, mimeType],
      );
      if (!result.rowCount) throw new Error("GENERATION_STATE_CONFLICT");
      await client.query(
        "update projects set status = 'ready', updated_at = now() where id = $1",
        [projectId],
      );
      await client.query("commit");
      return result.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(generationId, projectId, failureCode) {
    await this.pool.query(
      `update generations set status = 'failed', failure_code = $2,
        completed_at = now(), updated_at = now()
       where id = $1 and status in ('queued', 'processing')`,
      [generationId, String(failureCode || "GENERATION_FAILED").slice(0, 120)],
    );
    await this.pool.query(
      `update projects set status = 'failed_terminal', updated_at = now()
       where id = $1 and deleted_at is null`,
      [projectId],
    );
  }

  async findOwned(userId, projectId, generationId) {
    const result = await this.pool.query(
      `select g.*,
        coalesce(json_agg(json_build_object(
          'id', a.id, 'attemptNumber', a.attempt_number, 'status', a.status,
          'provider', a.provider, 'model', a.model, 'jobId', a.provider_request_id,
          'promptVersion', a.prompt_version, 'seed', a.seed, 'durationMs', a.duration_ms,
          'estimatedCostMinor', a.estimated_cost_minor, 'actualCostMinor', a.actual_cost_minor,
          'costCurrency', a.cost_currency, 'errorCode', a.error_code
        ) order by a.attempt_number) filter (where a.id is not null), '[]'::json) as attempts
       from generations g
       join projects p on p.id = g.project_id
       left join generation_attempts a on a.generation_id = g.id
       where g.id = $1 and g.project_id = $2 and p.user_id = $3 and p.deleted_at is null
       group by g.id`,
      [generationId, projectId, userId],
    );
    return result.rows[0] ?? null;
  }
}
