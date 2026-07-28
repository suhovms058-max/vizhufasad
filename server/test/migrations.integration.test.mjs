import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";

const enabled = Boolean(process.env.DATABASE_URL);
const expected = new Set([
  "users", "auth_sessions", "projects", "source_images", "generations",
  "generation_attempts", "wallets", "wallet_transactions", "tariff_plans",
  "payments", "subscriptions", "audit_logs",
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
