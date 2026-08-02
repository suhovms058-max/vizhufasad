ALTER TABLE "generations" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "status" SET DEFAULT 'created'::text;--> statement-breakpoint
UPDATE "generations" SET "status" = CASE "status"
  WHEN 'queued' THEN 'queued'
  WHEN 'processing' THEN 'retrying'
  WHEN 'qa' THEN 'quality_check_pending'
  WHEN 'ready' THEN 'completed'
  WHEN 'failed' THEN 'failed_refunded'
  WHEN 'cancelled' THEN 'cancelled'
  ELSE 'failed_refunded'
END;--> statement-breakpoint
DROP TYPE "public"."generation_status";--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('created', 'queued', 'preprocessing', 'generating', 'quality_check_pending', 'completed', 'retrying', 'failed_refunded', 'cancelled');--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "status" SET DEFAULT 'created'::"public"."generation_status";--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "status" SET DATA TYPE "public"."generation_status" USING "status"::"public"."generation_status";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "queue_job_id" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "priority" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
UPDATE "generations"
SET "queue_job_id" = "id"::text,
    "queued_at" = CASE WHEN "status" IN ('queued', 'retrying') THEN "created_at" ELSE NULL END,
    "started_at" = CASE WHEN "status" IN ('quality_check_pending', 'completed') THEN "updated_at" ELSE NULL END,
    "heartbeat_at" = CASE WHEN "status" IN ('quality_check_pending', 'completed') THEN "updated_at" ELSE NULL END;--> statement-breakpoint
CREATE UNIQUE INDEX "generations_queue_job_uidx" ON "generations" USING btree ("queue_job_id");--> statement-breakpoint
CREATE INDEX "generations_watchdog_idx" ON "generations" USING btree ("status","heartbeat_at");--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_priority_positive_chk" CHECK ("generations"."priority" > 0);
