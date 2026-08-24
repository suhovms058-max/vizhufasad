UPDATE "tariff_plans"
SET "is_active" = false,
	"valid_until" = TIMESTAMPTZ '2026-08-23 00:00:00+00',
	"updated_at" = now()
WHERE "code" IN ('FREE', 'START', 'OPTIMUM', 'MAXIMUM')
	AND "valid_from" < TIMESTAMPTZ '2026-08-23 00:00:00+00'
	AND "is_active" = true
	AND ("valid_until" IS NULL OR "valid_until" > TIMESTAMPTZ '2026-08-23 00:00:00+00');--> statement-breakpoint

INSERT INTO "tariff_plans"
	("code", "name", "description", "price_minor", "currency", "credits", "is_active", "is_public", "valid_from")
VALUES
	('FREE', 'Бесплатный', 'Одна пробная визуализация с водяным знаком', 0, 'RUB', 1, true, true, TIMESTAMPTZ '2026-08-23 00:00:00+00'),
	('START', 'Старт', '4 визуализации', 79000, 'RUB', 4, true, true, TIMESTAMPTZ '2026-08-23 00:00:00+00'),
	('OPTIMUM', 'Оптимум', '8 визуализаций', 129000, 'RUB', 8, true, true, TIMESTAMPTZ '2026-08-23 00:00:00+00'),
	('MAXIMUM', 'Максимум', '25 визуализаций', 349000, 'RUB', 25, true, true, TIMESTAMPTZ '2026-08-23 00:00:00+00')
ON CONFLICT ("code", "valid_from") DO UPDATE SET
	"name" = EXCLUDED."name",
	"description" = EXCLUDED."description",
	"price_minor" = EXCLUDED."price_minor",
	"credits" = EXCLUDED."credits",
	"is_active" = EXCLUDED."is_active",
	"is_public" = EXCLUDED."is_public",
	"updated_at" = now();
