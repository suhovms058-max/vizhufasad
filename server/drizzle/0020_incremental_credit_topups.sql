INSERT INTO "tariff_plans"
	("code", "name", "description", "price_minor", "currency", "credits", "is_active", "is_public", "valid_from")
VALUES
	('TOPUP_1', '1 кредит', 'Точечное пополнение баланса', 24900, 'RUB', 1, true, true, TIMESTAMPTZ '2026-08-25 00:00:00+00'),
	('TOPUP_2', '2 кредита', 'Точечное пополнение баланса', 49800, 'RUB', 2, true, true, TIMESTAMPTZ '2026-08-25 00:00:00+00'),
	('TOPUP_3', '3 кредита', 'Точечное пополнение баланса', 74700, 'RUB', 3, true, true, TIMESTAMPTZ '2026-08-25 00:00:00+00')
ON CONFLICT ("code", "valid_from") DO UPDATE SET
	"name" = EXCLUDED."name",
	"description" = EXCLUDED."description",
	"price_minor" = EXCLUDED."price_minor",
	"credits" = EXCLUDED."credits",
	"is_active" = EXCLUDED."is_active",
	"is_public" = EXCLUDED."is_public",
	"updated_at" = now();
