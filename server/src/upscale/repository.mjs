import { getPool } from "../db/client.mjs";

export class UpscaleRepository {
  constructor(pool = getPool()) { this.pool = pool; }

  async createOwned({ userId, projectId, generationId, idempotencyKey }) {
    const result = await this.pool.query(
      `with source as (
         select g.id, g.project_id, g.result_bucket, g.result_key, g.requires_watermark
         from generations g join projects p on p.id = g.project_id
         where g.id = $1 and g.project_id = $2 and p.user_id = $3
           and p.deleted_at is null and g.status = 'completed' and g.result_key is not null
       ), inserted as (
         insert into generation_upscales (
           generation_id, status, idempotency_key, source_bucket, source_key, requires_watermark
         )
         select id, 'created', $4, result_bucket, result_key, requires_watermark from source
         on conflict (idempotency_key) do nothing returning *, true as was_created
       )
       select * from inserted
       union all
       select existing.*, false as was_created
       from generation_upscales existing
       join generations g on g.id = existing.generation_id
       join projects p on p.id = g.project_id
       where existing.idempotency_key = $4 and p.user_id = $3 and p.deleted_at is null
         and not exists (select 1 from inserted)
       limit 1`,
      [generationId, projectId, userId, idempotencyKey],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return { upscale: row, created: row.was_created === true };
  }

  async attachReservationAndQueue(id, reservationId) {
    const result = await this.pool.query(
      `update generation_upscales set wallet_reservation_id = $2, queue_job_id = $1,
         status = 'queued', queued_at = coalesce(queued_at, now()), updated_at = now()
       where id = $1 and status = 'created' returning *`,
      [id, reservationId],
    );
    return result.rows[0] ?? null;
  }

  async findById(id) {
    const result = await this.pool.query(
      `select u.*, p.user_id, g.project_id from generation_upscales u
       join generations g on g.id = u.generation_id
       join projects p on p.id = g.project_id
       where u.id = $1 and p.deleted_at is null`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findOwned(userId, projectId, id) {
    const result = await this.pool.query(
      `select u.* from generation_upscales u
       join generations g on g.id = u.generation_id
       join projects p on p.id = g.project_id
       where u.id = $1 and g.project_id = $2 and p.user_id = $3 and p.deleted_at is null`,
      [id, projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async claim(id) {
    const result = await this.pool.query(
      `update generation_upscales set status = 'processing', started_at = coalesce(started_at, now()),
         updated_at = now() where id = $1 and status = 'queued' returning *`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async markRetryable(id, code) {
    await this.pool.query(
      `update generation_upscales set status = 'queued', failure_code = $2, updated_at = now()
       where id = $1 and status = 'processing'`,
      [id, String(code || "UPSCALE_RETRY").slice(0, 120)],
    );
  }

  async markCompleted(id, result) {
    const updated = await this.pool.query(
      `update generation_upscales set status = 'completed', provider = $2, model = $3,
         provider_request_id = $4, result_bucket = $5, result_key = $6, result_mime_type = $7,
         output_width = $8, output_height = $9, quality_result = $10,
         estimated_cost_minor = $11, actual_cost_minor = $12, cost_currency = $13,
         failure_code = null, completed_at = now(), updated_at = now()
       where id = $1 and status = 'processing' returning *`,
      [
        id, result.provider, result.model, result.requestId, result.bucket, result.key,
        result.mimeType, result.width, result.height, result.qualityResult,
        result.estimatedCostMinor, result.actualCostMinor, result.currency,
      ],
    );
    return updated.rows[0] ?? null;
  }

  async markFailedRefunded(id, code) {
    await this.pool.query(
      `update generation_upscales set status = 'failed_refunded', failure_code = $2,
         completed_at = coalesce(completed_at, now()), updated_at = now()
       where id = $1 and status not in ('completed', 'failed_refunded', 'cancelled')`,
      [id, String(code || "UPSCALE_FAILED").slice(0, 120)],
    );
  }

  async setWatermarkKey(id, key) {
    const result = await this.pool.query(
      `update generation_upscales set watermark_key = $2, updated_at = now()
       where id = $1 and status = 'completed' and requires_watermark = true returning watermark_key`,
      [id, key],
    );
    return result.rows[0]?.watermark_key ?? null;
  }

  async cancelOwned(userId, projectId, id) {
    const result = await this.pool.query(
      `update generation_upscales u set status = 'cancelled', completed_at = now(), updated_at = now()
       from generations g, projects p
       where u.id = $1 and u.generation_id = g.id and g.project_id = $2
         and p.id = g.project_id and p.user_id = $3 and p.deleted_at is null
         and u.status in ('created', 'queued') returning u.*`,
      [id, projectId, userId],
    );
    return result.rows[0] ?? null;
  }
}
