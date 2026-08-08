import { getPool } from "../db/client.mjs";
import {
  assertGenerationTransition, CANCELLABLE_GENERATION_STATUSES,
} from "./contract.mjs";

const cancellableSql = CANCELLABLE_GENERATION_STATUSES.map((status) => `'${status}'`).join(", ");

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
        ) values ($1, $2, $3, 'created', $4, $5, $6)
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

  async hasPaidCredits(userId) {
    const result = await this.pool.query(
      `select exists(
         select 1
         from wallet_transactions transaction
         join wallets wallet on wallet.id = transaction.wallet_id
         where wallet.user_id = $1
           and transaction.status = 'committed'
           and transaction.type in ('purchase', 'subscription')
           and transaction.amount > 0
       ) as paid`,
      [userId],
    );
    return result.rows[0]?.paid === true;
  }

  async attachReservationAndQueue(generationId, reservationId, queueJobId, priority, requiresWatermark) {
    assertGenerationTransition("created", "queued");
    const result = await this.pool.query(
      `update generations
       set wallet_reservation_id = $2, queue_job_id = $3, priority = $4,
           requires_watermark = $5,
           status = 'queued', queued_at = coalesce(queued_at, now()), updated_at = now()
       where id = $1 and status = 'created'
       returning *`,
      [generationId, reservationId, queueJobId, priority, requiresWatermark],
    );
    return result.rows[0] ?? null;
  }

  async findById(generationId) {
    const result = await this.pool.query(
      `select g.*, p.user_id, i.working_storage_key, i.width as source_width,
              i.height as source_height
       from generations g
       join projects p on p.id = g.project_id
       join source_images i on i.id = g.source_image_id
       where g.id = $1 and p.deleted_at is null`,
      [generationId],
    );
    return result.rows[0] ?? null;
  }

  async claimForWorker(generationId) {
    const result = await this.pool.query(
      `update generations
       set status = 'preprocessing', started_at = coalesce(started_at, now()),
           heartbeat_at = now(), updated_at = now()
       where id = $1 and status in ('queued', 'retrying')
       returning *`,
      [generationId],
    );
    return result.rows[0] ?? null;
  }

  async heartbeat(generationId) {
    await this.pool.query(
      `update generations set heartbeat_at = now(), updated_at = now()
       where id = $1 and status in ('preprocessing', 'generating', 'quality_check_pending')`,
      [generationId],
    );
  }

  async transition(generationId, fromStatuses, toStatus, extra = {}) {
    for (const from of fromStatuses) assertGenerationTransition(from, toStatus);
    const values = [generationId, toStatus, fromStatuses];
    const sets = ["status = $2", "updated_at = now()", "heartbeat_at = now()"];
    if (extra.failureCode !== undefined) {
      values.push(String(extra.failureCode || "").slice(0, 120) || null);
      sets.push(`failure_code = $${values.length}`);
    }
    const result = await this.pool.query(
      `update generations set ${sets.join(", ")}
       where id = $1 and status = any($3::generation_status[])
       returning *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async nextAttemptNumber(generationId) {
    const result = await this.pool.query(
      "select coalesce(max(attempt_number), 0) + 1 as number from generation_attempts where generation_id = $1",
      [generationId],
    );
    return Number(result.rows[0].number);
  }

  async startAttempt({
    generationId, attemptNumber, provider, model, promptVersion, seed,
    estimatedCostMinor, currency, candidateNumber = 1,
  }) {
    const result = await this.pool.query(
      `insert into generation_attempts (
        generation_id, attempt_number, status, provider, model, prompt_version,
        seed, estimated_cost_minor, cost_currency, candidate_number
      ) values ($1, $2, 'started', $3, $4, $5, $6, $7, $8, $9)
      returning *`,
      [
        generationId, attemptNumber, provider, model, promptVersion, seed,
        estimatedCostMinor, currency, candidateNumber,
      ],
    );
    return result.rows[0];
  }

  async succeedAttempt(attemptId, result) {
    await this.pool.query(
      `update generation_attempts set status = 'succeeded',
        provider_request_id = $2, model = $3, seed = $4, duration_ms = $5,
        estimated_cost_minor = $6, actual_cost_minor = $7, cost_currency = $8,
        finished_at = now()
       where id = $1 and status = 'started'`,
      [
        attemptId, result.jobId, result.model, result.seed, result.durationMs,
        result.estimatedCostMinor, result.actualCostMinor, result.currency,
      ],
    );
  }

  async attachAttemptResult(attemptId, { bucket, key, mimeType }) {
    const result = await this.pool.query(
      `update generation_attempts set result_bucket = $2, result_key = $3,
        result_mime_type = $4
       where id = $1 and status = 'succeeded' returning *`,
      [attemptId, bucket, key, mimeType],
    );
    return result.rows[0] ?? null;
  }

  async findCandidateForAssessment(generationId, candidateNumber) {
    const result = await this.pool.query(
      `select a.* from generation_attempts a
       left join generation_quality_assessments q on q.generation_attempt_id = a.id
       where a.generation_id = $1 and a.candidate_number = $2
         and a.status = 'succeeded' and a.result_key is not null
         and (q.id is null or q.status = 'provider_unavailable')
       order by a.attempt_number desc limit 1`,
      [generationId, candidateNumber],
    );
    return result.rows[0] ?? null;
  }

  async failAttempt(attemptId, error) {
    await this.pool.query(
      `update generation_attempts set status = $2, error_code = $3,
        error_details = $4, finished_at = now()
       where id = $1 and status = 'started'`,
      [
        attemptId,
        error.retryable ? "retryable_failed" : "terminal_failed",
        String(error.code || "GENERATION_PROVIDER_FAILED").slice(0, 120),
        error.details == null ? {} : { provider: String(error.details).slice(0, 500) },
      ],
    );
  }

  async markRetrying(generationId, failureCode) {
    return this.transition(
      generationId,
      ["preprocessing", "generating", "quality_check_pending"],
      "retrying",
      { failureCode },
    );
  }

  async markCompleted({ generationId, projectId, bucket, key, mimeType }) {
    assertGenerationTransition("quality_check_pending", "completed");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update generations set status = 'completed', result_bucket = $2, result_key = $3,
          result_mime_type = $4, failure_code = null, heartbeat_at = now(),
          completed_at = now(), updated_at = now()
         where id = $1 and status = 'quality_check_pending' returning *`,
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

  async markFailedRefunded(generationId, projectId, failureCode) {
    const result = await this.pool.query(
      `update generations set status = 'failed_refunded', failure_code = $2,
        completed_at = now(), heartbeat_at = now(), updated_at = now()
       where id = $1
         and status in ('created', 'queued', 'preprocessing', 'generating',
                        'quality_check_pending', 'retrying')
       returning *`,
      [generationId, String(failureCode || "GENERATION_FAILED").slice(0, 120)],
    );
    if (result.rowCount) {
      await this.pool.query(
        `update projects set status = 'failed_terminal', updated_at = now()
         where id = $1 and deleted_at is null`,
        [projectId],
      );
    }
    return result.rows[0] ?? null;
  }

  async cancelOwned(userId, projectId, generationId) {
    const result = await this.pool.query(
      `update generations g
       set status = 'cancelled', cancel_requested_at = now(),
           completed_at = now(), updated_at = now()
       from projects p
       where g.id = $1 and g.project_id = $2 and p.id = g.project_id
         and p.user_id = $3 and p.deleted_at is null
         and g.status in (${cancellableSql})
       returning g.*`,
      [generationId, projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async markStalledRetrying(generationId, failureCode = "WORKER_STALLED") {
    const result = await this.pool.query(
      `update generations set status = 'retrying', failure_code = $2, updated_at = now()
       where id = $1 and status in ('preprocessing', 'generating', 'quality_check_pending')
       returning *`,
      [generationId, failureCode],
    );
    return result.rows[0] ?? null;
  }

  async findStaleActive(staleBefore, limit = 100) {
    const result = await this.pool.query(
      `select id, project_id, user_id, wallet_reservation_id, status, queue_job_id
       from (
         select g.*, p.user_id
         from generations g join projects p on p.id = g.project_id
       ) generation
       where status in ('preprocessing', 'generating', 'quality_check_pending')
         and coalesce(heartbeat_at, started_at, updated_at) < $1
       order by coalesce(heartbeat_at, started_at, updated_at)
       limit $2`,
      [staleBefore, limit],
    );
    return result.rows;
  }

  async findRecoverableQueued(limit = 100) {
    const result = await this.pool.query(
      `select g.id, g.queue_job_id, g.priority
       from generations g
       where g.status in ('queued', 'retrying') and g.wallet_reservation_id is not null
       order by g.queued_at nulls first, g.created_at
       limit $1`,
      [limit],
    );
    return result.rows;
  }

  async queueMetrics() {
    const result = await this.pool.query(
      `select
         (select count(*)::int from generations where status = 'completed') as completed,
         (select count(*)::int from generations where status = 'failed_refunded') as failed_refunded,
         (select count(*)::int from generations where status = 'retrying') as retrying,
         (select coalesce(avg(extract(epoch from (completed_at - created_at)) * 1000), 0)::bigint
            from generations where status = 'completed') as average_total_ms,
         (select coalesce(avg(duration_ms), 0)::bigint
            from generation_attempts where duration_ms is not null) as average_provider_latency_ms`,
    );
    return result.rows[0];
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

  async findLatestOwned(userId, projectId) {
    const result = await this.pool.query(
      `select g.id
       from generations g
       join projects p on p.id = g.project_id
       where g.project_id = $1 and p.user_id = $2 and p.deleted_at is null
       order by g.created_at desc
       limit 1`,
      [projectId, userId],
    );
    if (!result.rowCount) return null;
    return this.findOwned(userId, projectId, result.rows[0].id);
  }

  async listOwned(userId, projectId) {
    const result = await this.pool.query(
      `select g.id from generations g
       join projects p on p.id = g.project_id
       where g.project_id = $1 and p.user_id = $2 and p.deleted_at is null
       order by g.is_favorite desc, g.created_at desc`,
      [projectId, userId],
    );
    return Promise.all(result.rows.map((row) => this.findOwned(userId, projectId, row.id)));
  }

  async setFavoriteOwned(userId, projectId, generationId, favorite) {
    const result = await this.pool.query(
      `update generations g
       set is_favorite = $4, favorited_at = case when $4 then now() else null end,
           updated_at = now()
       from projects p
       where g.id = $1 and g.project_id = $2 and p.id = g.project_id
         and p.user_id = $3 and p.deleted_at is null and g.status = 'completed'
       returning g.*`,
      [generationId, projectId, userId, favorite],
    );
    return result.rows[0] ?? null;
  }

  async setWatermarkKey(generationId, key) {
    const result = await this.pool.query(
      `update generations set watermark_key = $2, updated_at = now()
       where id = $1 and status = 'completed' and requires_watermark = true
       returning watermark_key`,
      [generationId, key],
    );
    return result.rows[0]?.watermark_key ?? null;
  }
}
