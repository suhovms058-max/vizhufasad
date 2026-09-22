CREATE TABLE "password_credentials" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "password_hash" text NOT NULL,
  "salt" text NOT NULL,
  "algorithm" text NOT NULL,
  "parameters" jsonb NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "password_credentials_failed_attempts_chk" CHECK ("failed_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "password_credentials_locked_until_idx" ON "password_credentials" USING btree ("locked_until");
