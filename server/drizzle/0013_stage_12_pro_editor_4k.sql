CREATE TYPE "public"."generation_edit_scope" AS ENUM('full_facade', 'walls', 'plinth', 'roof', 'entrance', 'custom_mask');--> statement-breakpoint
CREATE TYPE "public"."generation_kind" AS ENUM('standard', 'pro', 'edit');--> statement-breakpoint
CREATE TYPE "public"."upscale_status" AS ENUM('created', 'queued', 'processing', 'completed', 'failed_refunded', 'cancelled');--> statement-breakpoint
CREATE TABLE "generation_comparison_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comparison_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_comparison_items_position_chk" CHECK ("generation_comparison_items"."position" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "generation_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"winner_generation_id" uuid,
	"collage_bucket" text,
	"collage_key" text,
	"collage_mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_upscales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"status" "upscale_status" DEFAULT 'created' NOT NULL,
	"idempotency_key" text NOT NULL,
	"queue_job_id" text,
	"wallet_reservation_id" uuid,
	"provider" text,
	"model" text,
	"provider_request_id" text,
	"source_bucket" text NOT NULL,
	"source_key" text NOT NULL,
	"result_bucket" text,
	"result_key" text,
	"result_mime_type" text,
	"output_width" integer,
	"output_height" integer,
	"estimated_cost_minor" integer,
	"actual_cost_minor" integer,
	"cost_currency" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "generation_upscales_dimensions_chk" CHECK (
    ("generation_upscales"."status" <> 'completed') OR (
      "generation_upscales"."output_width" IS NOT NULL AND "generation_upscales"."output_height" IS NOT NULL
      AND (("generation_upscales"."output_width" >= 3840 AND "generation_upscales"."output_height" >= 2160)
        OR ("generation_upscales"."output_width" >= 2160 AND "generation_upscales"."output_height" >= 3840))
    )
  ),
	CONSTRAINT "generation_upscales_cost_chk" CHECK (
    ("generation_upscales"."estimated_cost_minor" IS NULL OR "generation_upscales"."estimated_cost_minor" >= 0)
    AND ("generation_upscales"."actual_cost_minor" IS NULL OR "generation_upscales"."actual_cost_minor" >= 0)
  )
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "kind" "generation_kind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "parent_generation_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "edit_scope" "generation_edit_scope";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "edit_prompt" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "edit_mask_bucket" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "edit_mask_key" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "edit_mask_mime_type" text;--> statement-breakpoint
ALTER TABLE "generation_comparison_items" ADD CONSTRAINT "generation_comparison_items_comparison_id_generation_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."generation_comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_comparison_items" ADD CONSTRAINT "generation_comparison_items_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_comparisons" ADD CONSTRAINT "generation_comparisons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_comparisons" ADD CONSTRAINT "generation_comparisons_winner_generation_id_generations_id_fk" FOREIGN KEY ("winner_generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_upscales" ADD CONSTRAINT "generation_upscales_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_upscales" ADD CONSTRAINT "generation_upscales_wallet_reservation_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_reservation_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_comparison_items_generation_uidx" ON "generation_comparison_items" USING btree ("comparison_id","generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_comparison_items_position_uidx" ON "generation_comparison_items" USING btree ("comparison_id","position");--> statement-breakpoint
CREATE INDEX "generation_comparisons_project_idx" ON "generation_comparisons" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_upscales_idempotency_uidx" ON "generation_upscales" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_upscales_queue_job_uidx" ON "generation_upscales" USING btree ("queue_job_id");--> statement-breakpoint
CREATE INDEX "generation_upscales_generation_idx" ON "generation_upscales" USING btree ("generation_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_upscales_status_idx" ON "generation_upscales" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_parent_generation_id_generations_id_fk" FOREIGN KEY ("parent_generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_parent_idx" ON "generations" USING btree ("parent_generation_id","created_at");--> statement-breakpoint
CREATE INDEX "generations_project_kind_idx" ON "generations" USING btree ("project_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_parent_not_self_chk" CHECK ("generations"."parent_generation_id" IS NULL OR "generations"."parent_generation_id" <> "generations"."id");--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_edit_shape_chk" CHECK (
    ("generations"."kind" <> 'edit' AND "generations"."parent_generation_id" IS NULL AND "generations"."edit_scope" IS NULL AND "generations"."edit_prompt" IS NULL)
    OR ("generations"."kind" = 'edit' AND "generations"."parent_generation_id" IS NOT NULL AND "generations"."edit_scope" IS NOT NULL
      AND length(btrim("generations"."edit_prompt")) BETWEEN 1 AND 700)
  );--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_custom_mask_chk" CHECK (
    "generations"."edit_scope" <> 'custom_mask' OR ("generations"."edit_mask_bucket" IS NOT NULL AND "generations"."edit_mask_key" IS NOT NULL
      AND "generations"."edit_mask_mime_type" = 'image/png')
  );