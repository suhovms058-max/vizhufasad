import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await request.post("/__reset");
  await page.addInitScript(() => localStorage.setItem("vizhufasad:privacy:v1", JSON.stringify({
    version: "2026-08-28", analytics: false, decidedAt: "2026-08-30T00:00:00.000Z",
  })));
});

test("Pro, edit, 4K and comparison remain usable without horizontal overflow", async ({ page }) => {
  await page.goto("/app/new?project=project-e2e");
  await expect(page.getByText("Pro · 2 ВФ-коина")).toBeVisible();
  await page.getByLabel(/Pro · 2 ВФ-коина/u).check();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("button", { name: "Запустить Pro" })).toBeVisible();
  await expect(page.getByText(/будет списано 2 ВФ-коина/u)).toBeVisible();

  await page.goto("/app/projects/project-e2e/generations/22222222-2222-4222-8222-222222222222");
  await expect(page.getByRole("heading", { name: "Доработать результат" })).toBeVisible();
  await page.getByLabel("Область").selectOption("walls");
  await page.getByLabel("Что изменить").fill("Заменить только отделку стен на светлый клинкер");
  await page.locator("#edit-form .confirm input").check();
  await page.getByRole("button", { name: "Создать доработку" }).click();
  await expect(page).toHaveURL(/33333333-3333-4333-8333-333333333333/u);

  await page.goto("/app/projects/project-e2e/generations/22222222-2222-4222-8222-222222222222");
  await page.getByRole("button", { name: "Создать 4K" }).click();
  await expect(page.getByRole("link", { name: /Скачать 4K \(4096×2732\)/u })).toBeVisible();
  await page.locator('#comparison-create input[value="11111111-1111-4111-8111-111111111111"]').check();
  await page.getByRole("button", { name: "Открыть сравнение" }).click();
  await expect(page.getByRole("heading", { name: "Сравнение фасадов" })).toBeVisible();
  await page.getByLabel("Общий масштаб").fill("140");
  await expect(page.locator("#sync-zoom-value")).toHaveText("140%");
  await expect(page.getByRole("button", { name: "На весь экран" })).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((item) => ["critical", "serious"].includes(item.impact))).toEqual([]);
});
