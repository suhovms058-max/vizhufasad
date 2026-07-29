ALTER TABLE "generation_attempts" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "seed" bigint;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "estimated_cost_minor" integer;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "actual_cost_minor" integer;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "cost_currency" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "wallet_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "result_mime_type" text;--> statement-breakpoint
CREATE UNIQUE INDEX "generations_idempotency_uidx" ON "generations" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_duration_nonnegative_chk" CHECK ("generation_attempts"."duration_ms" IS NULL OR "generation_attempts"."duration_ms" >= 0);--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_cost_nonnegative_chk" CHECK (
    ("generation_attempts"."estimated_cost_minor" IS NULL OR "generation_attempts"."estimated_cost_minor" >= 0)
    AND ("generation_attempts"."actual_cost_minor" IS NULL OR "generation_attempts"."actual_cost_minor" >= 0)
  );