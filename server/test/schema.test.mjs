import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../drizzle/", import.meta.url);
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migration = (
  await Promise.all(migrationFiles.map((name) => readFile(new URL(name, migrationsDirectory), "utf8")))
).join("\n");
const requiredTables = [
  "users", "email_login_codes", "auth_sessions", "projects", "source_images", "generations",
  "generation_attempts", "generation_quality_assessments", "wallets", "wallet_transactions", "tariff_plans",
  "payments", "subscriptions", "audit_logs", "photo_assessments", "photo_assessment_attempts",
  "action_costs",
  "generation_upscales", "generation_comparisons", "generation_comparison_items",
  "project_generation_selections",
  "product_events",
];

test("migrations create every required table", () => {
  for (const table of requiredTables) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`), `missing table ${table}`);
  }
});

test("migrations include foreign keys, indexes, invariants and timestamp defaults", () => {
  assert.match(migration, /FOREIGN KEY/);
  assert.match(migration, /CREATE (?:UNIQUE )?INDEX/);
  assert.match(migration, /timestamp with time zone DEFAULT now\(\) NOT NULL/);
  assert.match(migration, /projects_legacy_order_id_uidx/);
  assert.match(migration, /wallet_transactions_idempotency_uidx/);
  assert.match(migration, /source_images_byte_size_positive_chk/);
  assert.match(migration, /wallets_balance_nonnegative_chk/);
  assert.match(migration, /email_login_codes_attempts_chk/);
  assert.match(migration, /'uploading', 'uploaded', 'processing', 'ready', 'invalid', 'deleted'/);
  assert.match(migration, /"thumbnail_storage_key"/);
  assert.match(migration, /"upload_expires_at"/);
  assert.match(migration, /"consent_version"/);
  assert.match(migration, /"consented_at"/);
  assert.match(migration, /legacy-pre-2026-08-22/);
  assert.match(migration, /photo_assessment_decision.*accepted_with_warning/);
  assert.match(migration, /photo_assessments_source_image_uidx/);
  assert.match(migration, /wallet_transaction_type.*free_bonus.*generation_charge.*generation_refund/s);
  assert.match(migration, /wallet_transactions_refund_once_uidx/);
  assert.match(migration, /tariff_plans_code_valid_from_uidx/);
  assert.match(migration, /action_costs_code_valid_from_uidx/);
  assert.match(migration, /'created', 'queued', 'preprocessing', 'generating', 'quality_check_pending'/);
  assert.match(migration, /generations_queue_job_uidx/);
  assert.match(migration, /generations_watchdog_idx/);
  assert.match(migration, /generation_quality_assessments_number_chk/);
  assert.match(migration, /generation_quality_assessments_expiry_idx/);
  assert.match(migration, /generation_kind.*standard.*pro.*edit/s);
  assert.match(migration, /generations_parent_not_self_chk/);
  assert.match(migration, /generations_edit_shape_chk/);
  assert.match(migration, /generation_upscales_dimensions_chk/);
  assert.match(migration, /generation_comparison_items_position_chk/);
  assert.match(migration, /product_events_name_created_idx/);
  assert.match(migration, /product_events_path_length_chk/);
  assert.match(migration, /'START'.*79000.*25/s);
  assert.match(migration, /'OPTIMUM'.*129000.*60/s);
  assert.match(migration, /'MAXIMUM'.*349000.*240/s);
  assert.match(migration, /'photo_assessment'.*0/s);
  assert.match(migration, /lower\("email"\)/);
  assert.doesNotMatch(migration, /code_hash.*DEFAULT/);
  assert.doesNotMatch(migration, /manual_review|operator_pending/);
});
