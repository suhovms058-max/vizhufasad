import { getPool } from "../db/client.mjs";

export class ComparisonRepository {
  constructor(pool = getPool()) { this.pool = pool; }

  async hasAccess(userId) {
    const result = await this.pool.query(
      `select exists(
         select 1 from payments payment
         join tariff_plans tariff on tariff.id = payment.tariff_plan_id
         where payment.user_id = $1 and payment.status = 'paid'
           and tariff.code in ('OPTIMUM', 'MAXIMUM')
         union all
         select 1 from subscriptions subscription
         join tariff_plans tariff on tariff.id = subscription.tariff_plan_id
         where subscription.user_id = $1 and subscription.status = 'active'
           and tariff.code in ('OPTIMUM', 'MAXIMUM', 'PLUS')
         union all
         select 1 from partner_credit_codes partner_code
         where partner_code.redeemed_by = $1 and partner_code.redeemed_at is not null
           and (partner_code.expires_at is null or partner_code.expires_at > now())
       ) as allowed`,
      [userId],
    );
    return result.rows[0]?.allowed === true;
  }

  async createOwned(userId, projectId, generationIds) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const project = await client.query(
        "select id from projects where id = $1 and user_id = $2 and deleted_at is null for update",
        [projectId, userId],
      );
      if (!project.rowCount) { await client.query("rollback"); return null; }
      const generations = await client.query(
        `select id from generations where project_id = $1 and id = any($2::uuid[])
           and status = 'completed' and result_key is not null`,
        [projectId, generationIds],
      );
      if (generations.rowCount !== generationIds.length) {
        await client.query("rollback");
        return null;
      }
      const comparison = await client.query(
        "insert into generation_comparisons (project_id) values ($1) returning *",
        [projectId],
      );
      await client.query(
        `insert into generation_comparison_items (comparison_id, generation_id, position)
         select $1, value::uuid, ordinality::int
         from unnest($2::text[]) with ordinality as selected(value, ordinality)`,
        [comparison.rows[0].id, generationIds],
      );
      await client.query("commit");
      return comparison.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }

  async findOwned(userId, projectId, comparisonId) {
    const result = await this.pool.query(
      `select comparison.*,
        coalesce(json_agg(json_build_object(
          'generationId', item.generation_id, 'position', item.position,
          'kind', generation.kind, 'revision', generation.revision,
          'style', generation.config_snapshot ->> 'style',
          'materials', generation.config_snapshot -> 'materials',
          'palette', generation.config_snapshot -> 'palette',
          'transformationLevel', generation.config_snapshot ->> 'transformationLevel',
          'resultKey', generation.result_key, 'isFavorite', generation.is_favorite,
          'completedAt', generation.completed_at
        ) order by item.position) filter (where item.id is not null), '[]'::json) as items
       from generation_comparisons comparison
       join projects project on project.id = comparison.project_id
       left join generation_comparison_items item on item.comparison_id = comparison.id
       left join generations generation on generation.id = item.generation_id
       where comparison.id = $1 and comparison.project_id = $2
         and project.user_id = $3 and project.deleted_at is null
       group by comparison.id`,
      [comparisonId, projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async selectWinnerOwned(userId, projectId, comparisonId, generationId) {
    const result = await this.pool.query(
      `update generation_comparisons comparison set winner_generation_id = $4, updated_at = now()
       from projects project
       where comparison.id = $1 and comparison.project_id = $2
         and project.id = comparison.project_id and project.user_id = $3 and project.deleted_at is null
         and exists (select 1 from generation_comparison_items item
           where item.comparison_id = comparison.id and item.generation_id = $4)
       returning comparison.*`,
      [comparisonId, projectId, userId, generationId],
    );
    return result.rows[0] ?? null;
  }

  async setFavoriteOwned(userId, projectId, comparisonId, generationId, favorite) {
    const result = await this.pool.query(
      `update generations generation set is_favorite = $5,
         favorited_at = case when $5 then now() else null end, updated_at = now()
       from projects project
       where generation.id = $4 and generation.project_id = $2
         and project.id = generation.project_id and project.user_id = $3 and project.deleted_at is null
         and generation.status = 'completed'
         and exists (select 1 from generation_comparison_items item
           where item.comparison_id = $1 and item.generation_id = generation.id)
       returning generation.id`,
      [comparisonId, projectId, userId, generationId, favorite],
    );
    return result.rowCount > 0;
  }

  async setCollageOwned(userId, projectId, comparisonId, bucket, key, mimeType) {
    const result = await this.pool.query(
      `update generation_comparisons comparison set collage_bucket = $4, collage_key = $5,
         collage_mime_type = $6, updated_at = now()
       from projects project where comparison.id = $1 and comparison.project_id = $2
         and project.id = comparison.project_id and project.user_id = $3 and project.deleted_at is null
       returning comparison.*`,
      [comparisonId, projectId, userId, bucket, key, mimeType],
    );
    return result.rows[0] ?? null;
  }
}
