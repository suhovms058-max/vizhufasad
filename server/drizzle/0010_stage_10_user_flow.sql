ALTER TABLE "generations" ADD COLUMN "requires_watermark" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "watermark_key" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "favorited_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "generations_project_favorite_idx" ON "generations" USING btree ("project_id","is_favorite","completed_at");