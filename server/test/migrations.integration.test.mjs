import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";

const enabled = Boolean(process.env.DATABASE_URL);
const expected = new Set([
  "users", "email_login_codes", "auth_sessions", "projects", "source_images", "generations",
  "generation_attempts", "generation_quality_assessments", "wallets", "wallet_transactions", "tariff_plans",
  "payments", "subscriptions", "audit_logs", "photo_assessments", "photo_assessment_attempts",
  "action_costs",
  "payment_webhook_events", "payment_receipts", "payment_refunds",
  "promo_codes", "promo_redemptions",
]);

test("applied migration exposes all required PostgreSQL tables", { skip: !enabled }, async () => {
  try {
    const result = await getPool().query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const actual = new Set(result.rows.map(({ table_name }) => table_name));
    for (const table of expected) assert.ok(actual.has(table), `missing migrated table ${table}`);
  } finally {
    await closeDatabase();
  }
});
