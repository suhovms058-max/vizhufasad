CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"session_hash" text NOT NULL,
	"path" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_events_path_length_chk" CHECK (length("product_events"."path") BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE INDEX "product_events_name_created_idx" ON "product_events" USING btree ("event_name","created_at");--> statement-breakpoint
CREATE INDEX "product_events_session_created_idx" ON "product_events" USING btree ("session_hash","created_at");