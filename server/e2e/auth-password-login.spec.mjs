import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("password and one-time-code login remain clear without text overlap", async ({ page }, testInfo) => {
  await page.goto("/auth/login?next=/app/settings");
  await expect(page.getByRole("heading", { name: "Войти в кабинет" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email и пароль" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Первый вход или восстановление" })).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByText(/Я даю.*согласие/u)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const loginBox = await page.locator("form[action='/auth/password/login']").boundingBox();
  const codeBox = await page.locator("form#code-login").boundingBox();
  expect(loginBox.y + loginBox.height).toBeLessThan(codeBox.y);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("auth-login.png"), fullPage: true });
});

test("cabinet settings explains password creation and validates confirmation", async ({ page }, testInfo) => {
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Создать пароль" })).toBeVisible();
  await expect(page.getByText(/Одноразовый код останется способом восстановления/u)).toBeVisible();
  await page.getByLabel("Новый пароль").fill("long-password-2026");
  await page.getByLabel("Повторите пароль").fill("another-password-2026");
  await page.getByRole("button", { name: "Создать пароль" }).click();
  await expect(page.getByRole("alert")).toContainText("Пароли не совпадают");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("password-settings.png"), fullPage: true });
});
