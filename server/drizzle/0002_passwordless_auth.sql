ALTER TABLE "users" ADD COLUMN "account_deletion_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "request_ip_hash" text;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "user_agent" text;
--> statement-breakpoint
CREATE TABLE "email_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"request_ip_hash" text,
	"attempts_remaining" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_login_codes_attempts_chk" CHECK ("email_login_codes"."attempts_remaining" >= 0)
);
--> statement-breakpoint
DROP INDEX "users_email_lower_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" USING btree (lower("email"));
--> statement-breakpoint
CREATE INDEX "email_login_codes_email_created_idx" ON "email_login_codes" USING btree ("email","created_at");
--> statement-breakpoint
CREATE INDEX "email_login_codes_expires_idx" ON "email_login_codes" USING btree ("expires_at");
