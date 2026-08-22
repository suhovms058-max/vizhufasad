ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."project_status";--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM(
  'draft', 'photo_uploading', 'photo_processing', 'photo_ready',
  'photo_validation_queued', 'photo_retake_required', 'configuration_required',
  'generation_queued', 'generating', 'qa_queued', 'qa_failed_retrying',
  'ready', 'revision_queued', 'failed_terminal', 'archived', 'deleted'
);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DATA TYPE "public"."project_status"
  USING "status"::"public"."project_status";--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "status" SET DEFAULT 'uploading'::text;--> statement-breakpoint
UPDATE "source_images" SET "status" = 'ready' WHERE "status" = 'validated';--> statement-breakpoint
UPDATE "source_images" SET "status" = 'invalid' WHERE "status" = 'rejected';--> statement-breakpoint
DROP TYPE "public"."image_status";--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('uploading', 'uploaded', 'processing', 'ready', 'invalid', 'deleted');--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "status" SET DEFAULT 'uploading'::"public"."image_status";--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "status" SET DATA TYPE "public"."image_status" USING "status"::"public"."image_status";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "working_storage_key" text;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "thumbnail_storage_key" text;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "declared_mime_type" text;--> statement-breakpoint
UPDATE "source_images" SET "declared_mime_type" = "mime_type";--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "declared_mime_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "invalid_reason" text;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "recommended_size" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "upload_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "deleted_at" timestamp with time zone;
