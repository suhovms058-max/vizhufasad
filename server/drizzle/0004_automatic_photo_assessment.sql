CREATE TYPE "public"."photo_assessment_decision" AS ENUM('accepted', 'accepted_with_warning', 'retake_required');--> statement-breakpoint
CREATE TYPE "public"."photo_assessment_status" AS ENUM('queued', 'processing', 'completed', 'provider_unavailable');--> statement-breakpoint
CREATE TABLE "photo_assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "attempt_status" DEFAULT 'started' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"provider_request_id" text,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "photo_assessment_attempts_number_chk" CHECK ("photo_assessment_attempts"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "photo_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_image_id" uuid NOT NULL,
	"status" "photo_assessment_status" DEFAULT 'queued' NOT NULL,
	"decision" "photo_assessment_decision",
	"technical_result" jsonb,
	"user_result" jsonb,
	"provider" text,
	"model" text,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"retry_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_assessments_attempt_count_chk" CHECK ("photo_assessments"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "photo_assessment_attempts" ADD CONSTRAINT "photo_assessment_attempts_assessment_id_photo_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."photo_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_assessments" ADD CONSTRAINT "photo_assessments_source_image_id_source_images_id_fk" FOREIGN KEY ("source_image_id") REFERENCES "public"."source_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_assessment_attempts_number_uidx" ON "photo_assessment_attempts" USING btree ("assessment_id","attempt_number");--> statement-breakpoint
CREATE INDEX "photo_assessment_attempts_provider_status_idx" ON "photo_assessment_attempts" USING btree ("provider","status");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_assessments_source_image_uidx" ON "photo_assessments" USING btree ("source_image_id");--> statement-breakpoint
CREATE INDEX "photo_assessments_status_retry_idx" ON "photo_assessments" USING btree ("status","retry_after");
