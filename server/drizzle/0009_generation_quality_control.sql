-- Mandatory automatic quality gate with at most two candidate assessments.
CREATE TYPE "public"."generation_quality_decision" AS ENUM('passed', 'retry_required', 'rejected_refund');--> statement-breakpoint
CREATE TYPE "public"."generation_quality_status" AS ENUM('processing', 'completed', 'provider_unavailable');--> statement-breakpoint
CREATE TABLE "generation_quality_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"generation_attempt_id" uuid NOT NULL,
	"assessment_number" integer NOT NULL,
	"status" "generation_quality_status" DEFAULT 'processing' NOT NULL,
	"decision" "generation_quality_decision",
	"schema_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"provider" text,
	"model" text,
	"provider_request_id" text,
	"vlm_result" jsonb,
	"structural_result" jsonb,
	"score_breakdown" jsonb,
	"overall_score" integer,
	"failure_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diagnostic_bucket" text,
	"diagnostic_key" text,
	"diagnostic_mime_type" text,
	"diagnostic_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_quality_assessments_number_chk" CHECK ("generation_quality_assessments"."assessment_number" BETWEEN 1 AND 2),
	CONSTRAINT "generation_quality_assessments_score_chk" CHECK ("generation_quality_assessments"."overall_score" IS NULL OR "generation_quality_assessments"."overall_score" BETWEEN 0 AND 10000),
	CONSTRAINT "generation_quality_assessments_completion_chk" CHECK (
    ("generation_quality_assessments"."status" = 'completed' AND "generation_quality_assessments"."decision" IS NOT NULL AND "generation_quality_assessments"."finished_at" IS NOT NULL)
    OR ("generation_quality_assessments"."status" <> 'completed' AND "generation_quality_assessments"."decision" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "candidate_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "result_bucket" text;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "result_key" text;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "result_mime_type" text;--> statement-breakpoint
ALTER TABLE "generation_quality_assessments" ADD CONSTRAINT "generation_quality_assessments_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_quality_assessments" ADD CONSTRAINT "generation_quality_assessments_generation_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("generation_attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_quality_assessments_number_uidx" ON "generation_quality_assessments" USING btree ("generation_id","assessment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_quality_assessments_attempt_uidx" ON "generation_quality_assessments" USING btree ("generation_attempt_id");--> statement-breakpoint
CREATE INDEX "generation_quality_assessments_decision_idx" ON "generation_quality_assessments" USING btree ("decision","created_at");--> statement-breakpoint
CREATE INDEX "generation_quality_assessments_expiry_idx" ON "generation_quality_assessments" USING btree ("diagnostic_expires_at");--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_candidate_number_chk" CHECK ("generation_attempts"."candidate_number" BETWEEN 1 AND 2);
