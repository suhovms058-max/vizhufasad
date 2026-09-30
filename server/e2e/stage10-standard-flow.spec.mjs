import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ request }) => { await request.post("/__reset"); });

test("upload step is understandable, responsive and rejects a tiny image before network upload", async ({ page }) => {
  await page.goto("/app/new");
  await expect(page.getByRole("heading", { name: "Загрузите фотографию дома" })).toBeVisible();
  await expect(page.getByText("Как снять фасад")).toBeVisible();
  await expect(page.getByText("Кредит на этом шаге не списывается.")).toBeVisible();
  await page.locator("#photo-input").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText(/Разрешение фотографии меньше 640×420/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Загрузить и проверить фото" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((item) => ["critical", "serious"].includes(item.impact))).toEqual([]);
});

test("upload recovers when the proxy times out while automatic assessment continues", async ({ page }) => {
  await page.route("**/api/projects/project-e2e/images/upload-intent", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      image: { id: "image-timeout" },
      upload: { url: "http://127.0.0.1:4173/fixture/direct-upload", headers: {} },
    }),
  }));
  await page.route("**/fixture/direct-upload", (route) => route.fulfill({ status: 200 }));
  await page.route("**/api/projects/project-e2e/images/image-timeout/complete", (route) => route.fulfill({
    status: 504, contentType: "text/html", body: "Gateway Timeout",
  }));
  await page.route("**/api/projects/project-e2e/images/image-timeout/assessment", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assessment: { status: "completed", decision: "accepted" } }),
  }));

  await page.goto("/app/new?project=project-e2e&replace=1");
  await page.locator("#photo-input").setInputFiles(path.resolve("../public/process-house-before.webp"));
  await page.locator("#photo-processing-consent").check();
  await page.locator("#photo-usage-rights").check();
  await page.getByRole("button", { name: "Заменить и проверить фото" }).click();

  await expect(page).toHaveURL(/\/app\/new\?project=project-e2e$/u);
  await expect(page.getByRole("heading", { name: "Настройте фасад" })).toBeVisible();
});

test("photo settings to checked Standard result survives navigation and fits viewport", async ({ page }) => {
  await page.goto("/app/new?project=project-e2e");
  await expect(page.getByRole("heading", { name: "Настройте фасад" })).toBeVisible();
  await expect(page.getByText("Фото подходит")).toBeVisible();
  await page.getByLabel("Все направления").selectOption("скандинавский");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByLabel("дерево").check();
  await page.getByLabel("Описание цветов").fill("молочный, графит");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByLabel("Что важно учесть").fill("Отделать карниз и существующие опоры");
  await page.getByLabel(/Подтверждаю списание 1 кредита/u).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Запустить Standard" }).click();
  await expect(page).toHaveURL(/\/app\/projects\/project-e2e\/generations\/[0-9a-f-]{36}$/u);
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
