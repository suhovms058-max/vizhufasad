CREATE TYPE "public"."attempt_status" AS ENUM('started', 'succeeded', 'retryable_failed', 'terminal_failed');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('queued', 'processing', 'qa', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('uploaded', 'validated', 'rejected', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'authorized', 'succeeded', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('photo_validation_queued', 'photo_retake_required', 'configuration_required', 'generation_queued', 'generating', 'qa_queued', 'qa_failed_retrying', 'ready', 'revision_queued', 'failed_terminal', 'archived');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."wallet_transaction_type" AS ENUM('credit', 'debit', 'hold', 'release', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'blocked', 'deleted');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"request_id" text,
	"ip_hash" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "attempt_status" DEFAULT 'started' NOT NULL,
	"provider" text,
	"provider_request_id" text,
	"error_code" text,
	"error_details" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_image_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"geometry_policy_snapshot" jsonb NOT NULL,
	"result_bucket" text,
	"result_key" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tariff_plan_id" uuid,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"legacy_order_id" text,
	"title" text NOT NULL,
	"status" "project_status" DEFAULT 'photo_validation_queued' NOT NULL,
	"facade_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"geometry_policy" jsonb DEFAULT '{"preserveGeometry":true,"preserveFloors":true,"preserveWindows":true,"preserveDoors":true,"preserveRoof":true}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"status" "image_status" DEFAULT 'uploaded' NOT NULL,
	"quality_assessment" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tariff_plan_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subscription_id" text,
	"status" "subscription_status" DEFAULT 'pending' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tariff_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"credits" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" "wallet_transaction_type" NOT NULL,
	"amount" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"currency" text DEFAULT 'CREDIT' NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_source_image_id_source_images_id_fk" FOREIGN KEY ("source_image_id") REFERENCES "public"."source_images"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tariff_plan_id_tariff_plans_id_fk" FOREIGN KEY ("tariff_plan_id") REFERENCES "public"."tariff_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_images" ADD CONSTRAINT "source_images_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tariff_plan_id_tariff_plans_id_fk" FOREIGN KEY ("tariff_plan_id") REFERENCES "public"."tariff_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_created_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_request_idx" ON "audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_uidx" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_expires_idx" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_number_uidx" ON "generation_attempts" USING btree ("generation_id","attempt_number");--> statement-breakpoint
CREATE INDEX "generation_attempts_status_idx" ON "generation_attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "generations_project_revision_uidx" ON "generations" USING btree ("project_id","revision");--> statement-breakpoint
CREATE INDEX "generations_status_created_idx" ON "generations" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_uidx" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_id_uidx" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_user_created_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_legacy_order_id_uidx" ON "projects" USING btree ("legacy_order_id");--> statement-breakpoint
CREATE INDEX "projects_user_created_idx" ON "projects" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "source_images_storage_object_uidx" ON "source_images" USING btree ("storage_bucket","storage_key");--> statement-breakpoint
CREATE INDEX "source_images_project_created_idx" ON "source_images" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "source_images_sha256_idx" ON "source_images" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_id_uidx" ON "subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_plans_code_uidx" ON "tariff_plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tariff_plans_active_idx" ON "tariff_plans" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_idempotency_uidx" ON "wallet_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "wallet_transactions_wallet_created_idx" ON "wallet_transactions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_currency_uidx" ON "wallets" USING btree ("user_id","currency");