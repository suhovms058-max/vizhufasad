import assert from "node:assert/strict";
import test from "node:test";
import { AdminRepository } from "../src/admin/repository.mjs";

test("admin dashboard statistics use only valid generation_status values", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (String(sql).includes("count(*)::int as total")) {
        return { rows: [{ total: 0, completed: 0, active: 0, failed: 0 }] };
      }
      return { rows: [] };
    },
  };

  const dashboard = await new AdminRepository(pool).dashboard();
  const statisticsQuery = queries.find((sql) => String(sql).includes("count(*)::int as total"));

  assert.deepEqual(dashboard.stats, { total: 0, completed: 0, active: 0, failed: 0 });
  assert.doesNotMatch(statisticsQuery, /qa_queued|qa_failed_retrying|failed_terminal/u);
  assert.match(statisticsQuery, /quality_check_pending/u);
  assert.match(statisticsQuery, /failed_refunded/u);
});
