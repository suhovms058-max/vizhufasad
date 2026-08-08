import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("/__reset"); });

test("photo settings to checked Standard result survives navigation and fits viewport", async ({ page }) => {
  await page.goto("/app/new?project=project-e2e");
  await expect(page.getByRole("heading", { name: "Настройте фасад" })).toBeVisible();
  await expect(page.getByText("Фото подходит")).toBeVisible();
  await page.getByLabel("Архитектурное направление").selectOption("скандинавский");
  await page.getByLabel("дерево").check();
  await page.getByLabel("Описание цветов").fill("молочный, графит");
  await page.getByLabel("Что важно учесть").fill("Отделать карниз и существующие опоры");
  await page.getByLabel(/Подтверждаю списание 1 кредита/u).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Запустить Standard" }).click();
  await expect(page).toHaveURL(/\/generations\/generation-e2e/u);
  await expect(page.getByRole("heading", { name: "Фасад готов" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("скандинавский")).toBeVisible();
  await expect(page.getByText("ВИЖУФАСАД · КОНЦЕПЦИЯ", { exact: true })).toBeVisible();
  await page.getByLabel("Положение ползунка до и после").fill("35");
  await page.getByRole("button", { name: "В избранное" }).click();
  await expect(page.getByRole("button", { name: "Убрать из избранного" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((item) => ["critical", "serious"].includes(item.impact))).toEqual([]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Фасад готов" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Убрать из избранного" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
