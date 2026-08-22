ALTER TABLE "generation_upscales" ADD COLUMN "requires_watermark" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_upscales" ADD COLUMN "watermark_key" text;--> statement-breakpoint
ALTER TABLE "generation_upscales" ADD COLUMN "quality_result" jsonb;