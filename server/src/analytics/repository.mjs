import { getPool } from "../db/client.mjs";

export class ProductAnalyticsRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async record({ eventName, sessionHash, path, properties }) {
    await this.pool.query(
      `insert into product_events (event_name, session_hash, path, properties)
       values ($1, $2, $3, $4)`,
      [eventName, sessionHash, path, properties],
    );
  }

  async economicsSnapshot(days = 30) {
    const periodDays = Math.min(365, Math.max(1, Number(days) || 30));
    const result = await this.pool.query(
      `with bounds as (select now() - ($1::int * interval '1 day') as started_at),
       payment_summary as (
         select coalesce(sum(case when status = 'paid' then amount_minor else 0 end), 0)::bigint as paid_revenue_minor,
                coalesce(sum(case when status = 'refunded' then amount_minor else 0 end), 0)::bigint as refunded_revenue_minor,
                count(*) filter (where status = 'paid')::int as paid_payments
           from payments, bounds where created_at >= bounds.started_at
       ), generation_summary as (
         select count(*) filter (where status = 'completed')::int as completed_generations,
                count(*) filter (where status = 'failed_refunded')::int as failed_refunded_generations
           from generations, bounds where created_at >= bounds.started_at
       ), cost_summary as (
         select coalesce(sum(actual_cost_minor) filter (where cost_currency = 'RUB'), 0)::bigint as provider_cost_minor,
                count(*) filter (where actual_cost_minor is not null)::int as measured_attempts,
                count(*) filter (where actual_cost_minor is not null and cost_currency is distinct from 'RUB')::int as unconverted_cost_attempts,
                count(*) filter (where provider_request_id is not null and actual_cost_minor is null)::int as unresolved_provider_requests
           from generation_attempts, bounds where started_at >= bounds.started_at
       ), funnel as (
         select coalesce(jsonb_object_agg(event_name, event_count), '{}'::jsonb) as events
           from (select event_name, count(*)::int as event_count
                   from product_events, bounds where created_at >= bounds.started_at group by event_name) counts
       )
       select payment_summary.*, generation_summary.*, cost_summary.*, funnel.events
         from payment_summary, generation_summary, cost_summary, funnel`,
      [periodDays],
    );
    const row = result.rows[0];
    const paidRevenueMinor = Number(row.paid_revenue_minor);
    const refundedRevenueMinor = Number(row.refunded_revenue_minor);
    const providerCostMinor = Number(row.provider_cost_minor);
    const netRevenueMinor = paidRevenueMinor - refundedRevenueMinor;
    return {
      periodDays,
      paidRevenueMinor,
      refundedRevenueMinor,
      netRevenueMinor,
      providerCostMinor,
      grossContributionMinor: netRevenueMinor - providerCostMinor,
      paidPayments: Number(row.paid_payments),
      completedGenerations: Number(row.completed_generations),
      failedRefundedGenerations: Number(row.failed_refunded_generations),
      measuredAttempts: Number(row.measured_attempts),
      unconvertedCostAttempts: Number(row.unconverted_cost_attempts),
      unresolvedProviderRequests: Number(row.unresolved_provider_requests),
      averageProviderCostPerCompletedMinor: Number(row.completed_generations) > 0
        ? Math.round(providerCostMinor / Number(row.completed_generations))
        : null,
      events: row.events || {},
      caveat: "Provider cost includes only measured RUB attempts and excludes unconverted currencies, hosting, storage, taxes, acquiring and support overhead.",
      measuredAt: new Date().toISOString(),
    };
  }
}
