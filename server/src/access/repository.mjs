import { getPool } from "../db/client.mjs";

export class PlanAccessRepository {
  constructor(pool = getPool()) { this.pool = pool; }

  async highestPaidPackage(userId) {
    const result = await this.pool.query(
      `select code from (
         select tariff.code,
           case tariff.code when 'MAXIMUM' then 3 when 'OPTIMUM' then 2
             when 'PLUS' then 2 when 'START' then 1 else 0 end as rank
         from payments payment
         join tariff_plans tariff on tariff.id = payment.tariff_plan_id
         where payment.user_id = $1 and payment.status = 'paid'
           and tariff.code in ('START', 'OPTIMUM', 'MAXIMUM', 'PLUS')
         union all
         select tariff.code,
           case tariff.code when 'MAXIMUM' then 3 when 'OPTIMUM' then 2
             when 'PLUS' then 2 when 'START' then 1 else 0 end as rank
         from subscriptions subscription
         join tariff_plans tariff on tariff.id = subscription.tariff_plan_id
         where subscription.user_id = $1 and subscription.status = 'active'
           and tariff.code in ('START', 'OPTIMUM', 'MAXIMUM', 'PLUS')
         union all
         select 'MAXIMUM' as code, 3 as rank
         from owner_access_codes owner_code
         where owner_code.user_id = $1 and owner_code.is_active = true
           and owner_code.activated_at is not null
           and (owner_code.expires_at is null or owner_code.expires_at > now())
       ) access order by rank desc limit 1`,
      [userId],
    );
    return result.rows[0]?.code || "START";
  }
}
