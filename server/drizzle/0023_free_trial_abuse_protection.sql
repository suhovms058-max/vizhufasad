ALTER TABLE "source_images" ADD COLUMN IF NOT EXISTS "perceptual_hash" text;
CREATE INDEX IF NOT EXISTS "source_images_perceptual_hash_idx"
  ON "source_images" ("perceptual_hash") WHERE "perceptual_hash" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "free_trial_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "reason_code" text,
  "device_hash" text,
  "ip_hash" text,
  "network_hash" text,
  "photo_perceptual_hash" text,
  "generation_id" uuid REFERENCES "generations"("id") ON DELETE SET NULL,
  "policy_version" text DEFAULT 'free-trial-v1' NOT NULL,
  "granted_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "free_trial_entitlements_status_chk"
    CHECK ("status" IN ('pending', 'granted', 'consumed', 'denied', 'review_required'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "free_trial_entitlements_user_uidx"
  ON "free_trial_entitlements" ("user_id") WHERE "user_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "free_trial_entitlements_device_idx"
  ON "free_trial_entitlements" ("device_hash", "created_at") WHERE "device_hash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "free_trial_entitlements_photo_idx"
  ON "free_trial_entitlements" ("photo_perceptual_hash", "created_at")
  WHERE "photo_perceptual_hash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "free_trial_entitlements_expiry_idx"
  ON "free_trial_entitlements" ("expires_at");

CREATE TABLE IF NOT EXISTS "free_trial_risk_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "decision" text NOT NULL,
  "reason_code" text,
  "device_hash" text,
  "ip_hash" text,
  "network_hash" text,
  "photo_perceptual_hash" text,
  "policy_version" text DEFAULT 'free-trial-v1' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "free_trial_risk_events_decision_chk"
    CHECK ("decision" IN ('allowed', 'denied', 'review_required'))
);
CREATE INDEX IF NOT EXISTS "free_trial_risk_events_device_created_idx"
  ON "free_trial_risk_events" ("device_hash", "created_at") WHERE "device_hash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "free_trial_risk_events_network_created_idx"
  ON "free_trial_risk_events" ("network_hash", "created_at") WHERE "network_hash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "free_trial_risk_events_photo_created_idx"
  ON "free_trial_risk_events" ("photo_perceptual_hash", "created_at")
  WHERE "photo_perceptual_hash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "free_trial_risk_events_expiry_idx"
  ON "free_trial_risk_events" ("expires_at");
