CREATE TABLE IF NOT EXISTS "legal_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "document_key" text NOT NULL,
  "document_version" text NOT NULL,
  "document_hash" text NOT NULL,
  "action" text DEFAULT 'accepted' NOT NULL,
  "context" text NOT NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "payment_id" uuid REFERENCES "payments"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "legal_acceptances_action_chk" CHECK ("action" IN ('accepted', 'revoked'))
);
CREATE INDEX IF NOT EXISTS "legal_acceptances_user_document_idx" ON "legal_acceptances" ("user_id", "document_key", "created_at");
CREATE INDEX IF NOT EXISTS "legal_acceptances_payment_idx" ON "legal_acceptances" ("payment_id");
CREATE INDEX IF NOT EXISTS "legal_acceptances_project_idx" ON "legal_acceptances" ("project_id");

ALTER TABLE "source_images" ADD COLUMN IF NOT EXISTS "consent_hash" text;
ALTER TABLE "source_images" ADD COLUMN IF NOT EXISTS "rights_version" text;
ALTER TABLE "source_images" ADD COLUMN IF NOT EXISTS "rights_hash" text;
ALTER TABLE "source_images" ADD COLUMN IF NOT EXISTS "rights_confirmed_at" timestamptz;

CREATE TABLE IF NOT EXISTS "data_cleanup_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" text NOT NULL,
  "deleted_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" text,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "data_cleanup_runs_status_chk" CHECK ("status" IN ('succeeded', 'failed'))
);
CREATE INDEX IF NOT EXISTS "data_cleanup_runs_completed_idx" ON "data_cleanup_runs" ("completed_at");
