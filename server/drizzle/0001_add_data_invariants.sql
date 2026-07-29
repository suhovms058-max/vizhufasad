ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_number_positive_chk" CHECK ("generation_attempts"."attempt_number" > 0);--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_revision_positive_chk" CHECK ("generations"."revision" > 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive_chk" CHECK ("payments"."amount_minor" > 0);--> statement-breakpoint
ALTER TABLE "source_images" ADD CONSTRAINT "source_images_byte_size_positive_chk" CHECK ("source_images"."byte_size" > 0);--> statement-breakpoint
ALTER TABLE "source_images" ADD CONSTRAINT "source_images_dimensions_positive_chk" CHECK (("source_images"."width" IS NULL OR "source_images"."width" > 0) AND ("source_images"."height" IS NULL OR "source_images"."height" > 0));--> statement-breakpoint
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_price_nonnegative_chk" CHECK ("tariff_plans"."price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_credits_positive_chk" CHECK ("tariff_plans"."credits" > 0);--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_nonzero_chk" CHECK ("wallet_transactions"."amount" <> 0);--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_nonnegative_chk" CHECK ("wallets"."balance" >= 0);