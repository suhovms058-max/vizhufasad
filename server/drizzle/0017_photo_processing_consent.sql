ALTER TABLE "source_images" ADD COLUMN "consent_version" text;--> statement-breakpoint
ALTER TABLE "source_images" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
UPDATE "source_images"
SET "consent_version" = 'legacy-pre-2026-08-22',
    "consented_at" = "created_at"
WHERE "consent_version" IS NULL OR "consented_at" IS NULL;--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "consent_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_images" ALTER COLUMN "consented_at" SET NOT NULL;
