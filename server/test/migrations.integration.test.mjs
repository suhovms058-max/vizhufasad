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
  "legal_acceptances", "free_trial_entitlements", "free_trial_risk_events",
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

test("pre-auth legal proof columns are migrated", { skip: !enabled }, async () => {
  try {
    const result = await getPool().query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'legal_acceptances'`,
    );
    const columns = new Set(result.rows.map(({ column_name }) => column_name));
    for (const column of ["challenge_id", "request_ip_hash", "user_agent"]) {
      assert.ok(columns.has(column), `missing legal_acceptances.${column}`);
    }
  } finally {
    await closeDatabase();
  }
});
