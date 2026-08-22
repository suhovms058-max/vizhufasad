CREATE TYPE "public"."payment_receipt_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_receipt_type" AS ENUM('payment', 'refund');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_status" AS ENUM('created', 'pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_webhook_status" AS ENUM('received', 'processed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."promo_kind" AS ENUM('discount', 'credits');--> statement-breakpoint
CREATE SEQUENCE "public"."payment_provider_invoice_seq" AS bigint START WITH 100000;--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"type" "payment_receipt_type" NOT NULL,
	"status" "payment_receipt_status" DEFAULT 'pending' NOT NULL,
	"provider_receipt_id" text,
	"amount_minor" bigint NOT NULL,
	"receipt_url" text,
	"fiscal_document_number" text,
	"fiscal_sign" text,
	"issued_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_receipts_amount_positive_chk" CHECK ("payment_receipts"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"status" "payment_refund_status" DEFAULT 'created' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payment_refunds_amount_positive_chk" CHECK ("payment_refunds"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"status" "payment_webhook_status" DEFAULT 'received' NOT NULL,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "promo_kind" NOT NULL,
	"discount_percent" integer,
	"bonus_credits" integer,
	"max_redemptions" integer,
	"max_per_user" integer DEFAULT 1 NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_discount_chk" CHECK (("promo_codes"."kind" = 'discount' AND "promo_codes"."discount_percent" BETWEEN 1 AND 99 AND "promo_codes"."bonus_credits" IS NULL) OR ("promo_codes"."kind" = 'credits' AND "promo_codes"."bonus_credits" > 0 AND "promo_codes"."discount_percent" IS NULL)),
	CONSTRAINT "promo_codes_limits_chk" CHECK ("promo_codes"."max_per_user" = 1 AND ("promo_codes"."max_redemptions" IS NULL OR "promo_codes"."max_redemptions" > 0) AND "promo_codes"."redemption_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'created'::text;--> statement-breakpoint
UPDATE "payments" SET "status" = CASE "status"
	WHEN 'pending' THEN 'created'
	WHEN 'authorized' THEN 'pending'
	WHEN 'succeeded' THEN 'paid'
	ELSE "status"
END;--> statement-breakpoint
DROP TYPE "public"."payment_status";--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'pending', 'paid', 'cancelled', 'failed', 'refunded');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'created'::"public"."payment_status";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE "public"."payment_status" USING "status"::"public"."payment_status";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "original_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "credits" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "promo_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkout_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
SELECT setval(
	'public.payment_provider_invoice_seq',
	GREATEST(100000, COALESCE((SELECT max("provider_payment_id"::bigint) FROM "payments" WHERE "provider_payment_id" ~ '^[0-9]+$'), 0) + 1),
	false
);--> statement-breakpoint
UPDATE "payments" payment SET
	"original_amount_minor" = payment."amount_minor",
	"credits" = COALESCE((SELECT tariff."credits" FROM "tariff_plans" tariff WHERE tariff."id" = payment."tariff_plan_id"), 1),
	"description" = 'Покупка кредитов ВИЖУФАСАД',
	"checkout_expires_at" = COALESCE(payment."updated_at", payment."created_at") + interval '1 day';--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "original_amount_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "credits" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "checkout_expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipts_provider_id_uidx" ON "payment_receipts" USING btree ("provider_receipt_id");--> statement-breakpoint
CREATE INDEX "payment_receipts_payment_created_idx" ON "payment_receipts" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_idempotency_uidx" ON "payment_refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_provider_id_uidx" ON "payment_refunds" USING btree ("provider_refund_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_payment_created_idx" ON "payment_refunds" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_key_uidx" ON "payment_webhook_events" USING btree ("provider","event_key");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_payment_created_idx" ON "payment_webhook_events" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_upper_uidx" ON "promo_codes" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "promo_codes_active_window_idx" ON "promo_codes" USING btree ("is_active","starts_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_payment_uidx" ON "promo_redemptions" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_code_user_uidx" ON "promo_redemptions" USING btree ("promo_code_id","user_id");--> statement-breakpoint
CREATE INDEX "promo_redemptions_user_created_idx" ON "promo_redemptions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_original_amount_positive_chk" CHECK ("payments"."original_amount_minor" > 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_credits_positive_chk" CHECK ("payments"."credits" > 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_promo_credits_nonnegative_chk" CHECK ("payments"."promo_credits" >= 0);
