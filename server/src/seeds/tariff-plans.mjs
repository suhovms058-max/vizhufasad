import "dotenv/config";
import { closeDatabase, getPool } from "../db/client.mjs";

const effectiveAt = new Date("2026-08-23T00:00:00.000Z");
const tariffPlans = [
  ["FREE", "Бесплатный", "Одна пробная визуализация с водяным знаком", 0, 1, true, true],
  ["START", "Старт", "4 визуализации", 79_000, 4, true, true],
  ["OPTIMUM", "Оптимум", "8 визуализаций", 129_000, 8, true, true],
  ["MAXIMUM", "Максимум", "25 визуализаций", 349_000, 25, true, true],
  ["PLUS", "Plus", "Подготовлен, но не активирован", null, null, false, false],
];
const actionCosts = [
  ["standard_generation", "Standard", 1],
  ["pro_generation", "Pro", 2],
  ["text_revision", "Текстовая доработка", 1],
  ["upscale_4k", "4K", 1],
  ["photo_assessment", "Проверка фото", 0],
  ["download", "Скачивание", 0],
];

const pool = getPool();
try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const plan of tariffPlans) {
      await client.query(
        `insert into tariff_plans (
          code, name, description, price_minor, currency, credits,
          is_active, is_public, valid_from
        ) values ($1, $2, $3, $4, 'RUB', $5, $6, $7, $8)
        on conflict (code, valid_from) do update set
          name = excluded.name, description = excluded.description,
          price_minor = excluded.price_minor, credits = excluded.credits,
          is_active = excluded.is_active, is_public = excluded.is_public,
          updated_at = now()`,
        [...plan, effectiveAt],
      );
    }
    for (const action of actionCosts) {
      await client.query(
        `insert into action_costs (code, name, credits, is_active, valid_from)
         values ($1, $2, $3, true, $4)
         on conflict (code, valid_from) do update set
           name = excluded.name, credits = excluded.credits,
           is_active = true, updated_at = now()`,
        [...action, effectiveAt],
      );
    }
    await client.query("commit");
    console.log(`Seeded ${tariffPlans.length} tariff plans and ${actionCosts.length} action costs`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await closeDatabase();
}
