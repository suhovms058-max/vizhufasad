import { getPool } from "../db/client.mjs";

export class AdminRepository {
  constructor(pool = getPool()) { this.pool = pool; }

  async dashboard({ limit = 50, offset = 0 } = {}) {
    const [stats, generations, partnerCodes] = await Promise.all([
      this.pool.query(
        `select
          count(*)::int as total,
          count(*) filter (where status = 'completed')::int as completed,
          count(*) filter (where status in ('created','queued','preprocessing','generating','quality_check_pending','retrying','qa_queued','qa_failed_retrying'))::int as active,
          count(*) filter (where status in ('failed_refunded','cancelled','failed_terminal'))::int as failed
         from generations`,
      ),
      this.pool.query(
        `select g.id, g.project_id, g.revision, g.kind, g.status, g.failure_code,
          g.result_key, g.requires_watermark, g.created_at, g.completed_at,
          p.title as project_title, left(p.user_id::text, 8) as user_reference,
          attempt.provider, attempt.model, attempt.actual_cost_minor, attempt.cost_currency
         from generations g
         join projects p on p.id = g.project_id
         left join lateral (
           select provider, model, actual_cost_minor, cost_currency
           from generation_attempts where generation_id = g.id
           order by attempt_number desc limit 1
         ) attempt on true
         where p.deleted_at is null
         order by g.created_at desc limit $1 offset $2`,
        [limit, offset],
      ),
      this.pool.query(
        `select id, code_suffix, credits, contract_reference, partner_name, recipient_email_masked,
          is_active, expires_at, redeemed_at, created_at,
          case when redeemed_by is null then null else left(redeemed_by::text, 8) end as redeemed_user_reference
         from partner_credit_codes order by created_at desc`,
      ),
    ]);
    return {
      stats: stats.rows[0],
      generations: generations.rows,
      partnerCodes: partnerCodes.rows,
    };
  }
}
