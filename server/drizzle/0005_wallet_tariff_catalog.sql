CREATE TYPE "public"."wallet_transaction_status" AS ENUM('reserved', 'committed', 'refunded');--> statement-breakpoint
CREATE TABLE "action_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"credits" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_costs_credits_nonnegative_chk" CHECK ("action_costs"."credits" >= 0),
	CONSTRAINT "action_costs_validity_chk" CHECK ("action_costs"."valid_until" IS NULL OR "action_costs"."valid_until" > "action_costs"."valid_from")
);--> statement-breakpoint

ALTER TABLE "wallet_transactions" ADD COLUMN "status" "wallet_transaction_status" DEFAULT 'committed' NOT NULL;
ALTER TABLE "wallet_transactions" ADD COLUMN "balance_after" bigint;
ALTER TABLE "wallet_transactions" ADD COLUMN "action_code" text;
ALTER TABLE "wallet_transactions" ADD COLUMN "related_transaction_id" uuid;
ALTER TABLE "wallet_transactions" ADD COLUMN "committed_at" timestamp with time zone;
ALTER TABLE "wallet_transactions" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint

UPDATE "wallet_transactions" SET "status" = 'reserved' WHERE "type" = 'hold';
ALTER TABLE "wallet_transactions" ALTER COLUMN "type" SET DATA TYPE text;
UPDATE "wallet_transactions" SET "type" = CASE "type"
	WHEN 'credit' THEN 'promo'
	WHEN 'debit' THEN 'generation_charge'
	WHEN 'hold' THEN 'generation_charge'
	WHEN 'release' THEN 'generation_refund'
	WHEN 'refund' THEN 'generation_refund'
	WHEN 'adjustment' THEN 'admin_adjustment'
	ELSE "type"
END;
UPDATE "wallet_transactions"
SET "amount" = CASE
	WHEN "type" = 'generation_charge' THEN -ABS("amount")
	WHEN "type" IN ('promo', 'generation_refund') THEN ABS("amount")
	ELSE "amount"
END;
DROP TYPE "public"."wallet_transaction_type";
CREATE TYPE "public"."wallet_transaction_type" AS ENUM(
	'free_bonus', 'purchase', 'generation_charge', 'generation_refund',
	'promo', 'subscription', 'admin_adjustment'
);
ALTER TABLE "wallet_transactions" ALTER COLUMN "type"
	SET DATA TYPE "public"."wallet_transaction_type"
	USING "type"::"public"."wallet_transaction_type";--> statement-breakpoint

UPDATE "wallet_transactions" transaction
SET "balance_after" = wallet."balance"
FROM "wallets" wallet
WHERE wallet."id" = transaction."wallet_id";
ALTER TABLE "wallet_transactions" ALTER COLUMN "balance_after" SET NOT NULL;--> statement-breakpoint

DROP INDEX "tariff_plans_code_uidx";
DROP INDEX "tariff_plans_active_idx";
ALTER TABLE "tariff_plans" ALTER COLUMN "price_minor" DROP NOT NULL;
ALTER TABLE "tariff_plans" ALTER COLUMN "credits" DROP NOT NULL;
ALTER TABLE "tariff_plans" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;
ALTER TABLE "tariff_plans" ADD COLUMN "valid_from" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "tariff_plans" ADD COLUMN "valid_until" timestamp with time zone;
UPDATE "tariff_plans"
SET "is_active" = false,
	"valid_from" = LEAST("created_at", TIMESTAMPTZ '2026-07-28 20:59:59+00'),
	"valid_until" = TIMESTAMPTZ '2026-07-28 21:00:00+00',
	"updated_at" = now();--> statement-breakpoint

CREATE UNIQUE INDEX "action_costs_code_valid_from_uidx" ON "action_costs" USING btree ("code","valid_from");
CREATE INDEX "action_costs_active_idx" ON "action_costs" USING btree ("is_active","valid_from","valid_until");
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_related_transaction_fk" FOREIGN KEY ("related_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "tariff_plans_code_valid_from_uidx" ON "tariff_plans" USING btree ("code","valid_from");
CREATE UNIQUE INDEX "wallet_transactions_refund_once_uidx" ON "wallet_transactions" USING btree ("related_transaction_id") WHERE "wallet_transactions"."type" = 'generation_refund';
CREATE INDEX "tariff_plans_active_idx" ON "tariff_plans" USING btree ("is_active","valid_from","valid_until");
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_active_values_chk" CHECK (NOT "tariff_plans"."is_active" OR ("tariff_plans"."price_minor" IS NOT NULL AND "tariff_plans"."credits" IS NOT NULL));
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_validity_chk" CHECK ("tariff_plans"."valid_until" IS NULL OR "tariff_plans"."valid_until" > "tariff_plans"."valid_from");
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_balance_after_chk" CHECK ("wallet_transactions"."balance_after" >= 0);
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_direction_chk" CHECK ((
	"wallet_transactions"."type" = 'generation_charge' AND "wallet_transactions"."amount" < 0
) OR (
	"wallet_transactions"."type" IN ('free_bonus', 'purchase', 'generation_refund', 'promo', 'subscription')
	AND "wallet_transactions"."amount" > 0
) OR "wallet_transactions"."type" = 'admin_adjustment');
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_status_type_chk" CHECK (("wallet_transactions"."type" = 'generation_charge') OR "wallet_transactions"."status" = 'committed');--> statement-breakpoint

INSERT INTO "tariff_plans"
	("code", "name", "description", "price_minor", "currency", "credits", "is_active", "is_public", "valid_from")
VALUES
	('FREE', 'Бесплатный', 'Два бонусных кредита один раз', 0, 'RUB', 2, true, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('START', 'Старт', '25 кредитов', 79000, 'RUB', 25, true, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('OPTIMUM', 'Оптимум', '60 кредитов', 129000, 'RUB', 60, true, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('MAXIMUM', 'Максимум', '240 кредитов', 349000, 'RUB', 240, true, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('PLUS', 'Plus', 'Подготовлен, но не активирован', NULL, 'RUB', NULL, false, false, TIMESTAMPTZ '2026-07-28 21:00:00+00');--> statement-breakpoint

INSERT INTO "action_costs" ("code", "name", "credits", "is_active", "valid_from")
VALUES
	('standard_generation', 'Standard', 1, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('pro_generation', 'Pro', 2, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('text_revision', 'Текстовая доработка', 1, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('upscale_4k', '4K', 1, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('photo_assessment', 'Проверка фото', 0, true, TIMESTAMPTZ '2026-07-28 21:00:00+00'),
	('download', 'Скачивание', 0, true, TIMESTAMPTZ '2026-07-28 21:00:00+00');--> statement-breakpoint

WITH credited AS (
	UPDATE "wallets" wallet
	SET "balance" = wallet."balance" + 2, "updated_at" = now()
	WHERE NOT EXISTS (
		SELECT 1 FROM "wallet_transactions" transaction
		WHERE transaction."wallet_id" = wallet."id" AND transaction."type" = 'free_bonus'
	)
	RETURNING wallet."id", wallet."user_id", wallet."balance"
)
INSERT INTO "wallet_transactions"
	("wallet_id", "type", "status", "amount", "balance_after", "idempotency_key", "reference_type", "reference_id", "metadata", "committed_at")
SELECT "id", 'free_bonus', 'committed', 2, "balance", 'free_bonus:' || "user_id"::text,
	'user', "user_id", '{"source":"stage_6_backfill"}'::jsonb, now()
FROM credited;
