CREATE TABLE IF NOT EXISTS "owner_access_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "code_hash" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "activated_at" timestamp with time zone,
  "last_redeemed_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "owner_access_codes_user_uidx" ON "owner_access_codes" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "owner_access_codes_hash_uidx" ON "owner_access_codes" ("code_hash");

CREATE TABLE IF NOT EXISTS "owner_access_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_access_code_id" uuid NOT NULL REFERENCES "owner_access_codes"("id") ON DELETE RESTRICT,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "package_code" text NOT NULL,
  "credits" integer NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "owner_access_redemptions_package_chk" CHECK ("package_code" IN ('START', 'OPTIMUM', 'MAXIMUM')),
  CONSTRAINT "owner_access_redemptions_credits_chk" CHECK ("credits" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "owner_access_redemptions_user_key_uidx"
  ON "owner_access_redemptions" ("user_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "owner_access_redemptions_code_created_idx"
  ON "owner_access_redemptions" ("owner_access_code_id", "created_at");

CREATE TABLE IF NOT EXISTS "partner_credit_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "code_suffix" text NOT NULL,
  "credits" integer NOT NULL,
  "contract_reference" text NOT NULL,
  "partner_name" text,
  "recipient_email_hash" text NOT NULL,
  "recipient_email_masked" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "expires_at" timestamp with time zone,
  "redeemed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "redeemed_at" timestamp with time zone,
  "redemption_idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "partner_credit_codes_credits_chk" CHECK ("credits" > 0),
  CONSTRAINT "partner_credit_codes_suffix_chk" CHECK (length("code_suffix") = 4),
  CONSTRAINT "partner_credit_codes_redemption_chk" CHECK (
    ("redeemed_at" IS NULL AND "redeemed_by" IS NULL AND "redemption_idempotency_key" IS NULL)
    OR ("redeemed_at" IS NOT NULL AND "redeemed_by" IS NOT NULL AND "redemption_idempotency_key" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_credit_codes_hash_uidx" ON "partner_credit_codes" ("code_hash");
CREATE INDEX IF NOT EXISTS "partner_credit_codes_active_expiry_idx" ON "partner_credit_codes" ("is_active", "expires_at");
CREATE INDEX IF NOT EXISTS "partner_credit_codes_contract_idx" ON "partner_credit_codes" ("contract_reference");
CREATE INDEX IF NOT EXISTS "partner_credit_codes_recipient_email_hash_idx" ON "partner_credit_codes" ("recipient_email_hash");
