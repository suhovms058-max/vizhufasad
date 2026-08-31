ALTER TABLE "legal_acceptances" ADD COLUMN IF NOT EXISTS "challenge_id" uuid REFERENCES "email_login_codes"("id") ON DELETE SET NULL;
ALTER TABLE "legal_acceptances" ADD COLUMN IF NOT EXISTS "request_ip_hash" text;
ALTER TABLE "legal_acceptances" ADD COLUMN IF NOT EXISTS "user_agent" text;
CREATE INDEX IF NOT EXISTS "legal_acceptances_challenge_idx" ON "legal_acceptances" ("challenge_id");
