import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await request.post("/__reset");
  await page.goto("/auth/login");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
});

test("personal-data consent is required before the first email POST", async ({ page }) => {
  const emailPosts = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/auth/login") {
      emailPosts.push(request.postData());
    }
  });

  const consent = page.locator('input[name="personalDataAccepted"]');
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole("link", { name: "согласие", exact: true })).toHaveAttribute(
    "href", "/legal/personal-data-consent",
  );
  await expect(page.getByRole("link", { name: "Политикой обработки персональных данных" })).toHaveAttribute(
    "href", "/legal/privacy",
  );
  await page.getByRole("button", { name: "Только необходимые cookie" }).click();

  await page.locator('input[name="email"]').fill("e2e@example.test");
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect.poll(() => emailPosts.length).toBe(0);
  await expect(consent).toBeFocused();

  await consent.check();
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page).toHaveURL(/\/auth\/verify\?challenge=challenge-e2e/u);
  expect(emailPosts).toHaveLength(1);
  expect(emailPosts[0]).toContain("personalDataAccepted=yes");
  await expect(page.locator('input[name="personalDataAccepted"]')).toHaveCount(0);
  await expect(page.locator('input[name="agreementAccepted"]')).not.toBeChecked();
  await expect(page.locator('input[name="ageConfirmed"]')).not.toBeChecked();
});

test("analytics remains fail closed until explicit opt-in and stops after withdrawal", async ({ page, request }) => {
  const analyticsSessionKey = "vizhufasad:analytics-session:v1";
  const privacyKey = "vizhufasad:privacy:v1";

  await expect.poll(async () => (await request.get("/__analytics-events")).json())
    .toEqual({ events: [] });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), analyticsSessionKey)).toBeNull();

  await page.getByRole("button", { name: "Только необходимые cookie" }).click();
  await page.waitForTimeout(100);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), analyticsSessionKey)).toBeNull();
  expect((await (await request.get("/__analytics-events")).json()).events).toHaveLength(0);

  await page.getByRole("button", { name: "Настройки конфиденциальности" }).click();
  await page.getByRole("button", { name: "Разрешить аналитику" }).click();
  await expect.poll(async () => (await (await request.get("/__analytics-events")).json()).events.length).toBe(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), analyticsSessionKey)).not.toBeNull();

  await page.getByRole("button", { name: "Настройки конфиденциальности" }).click();
  await page.getByRole("button", { name: "Только необходимые cookie" }).click();
  await page.evaluate(() => window.vizhufasadTrack("after_withdrawal"));
  await page.waitForTimeout(100);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), analyticsSessionKey)).toBeNull();
  expect((await (await request.get("/__analytics-events")).json()).events).toHaveLength(1);

  const choice = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), privacyKey);
  expect(choice).toMatchObject({ version: "2026-08-28", analytics: false });
  expect(Number.isNaN(Date.parse(choice.decidedAt))).toBe(false);
});

test("photo upload explains document blocking without preselecting either consent", async ({ page }) => {
  await page.goto("/app/new");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#photo-processing-consent")).not.toBeChecked();
  await expect(page.locator("#photo-usage-rights")).not.toBeChecked();
  await expect(page.getByText("документоподобный снимок будет отклонён", { exact: false })).toBeVisible();
  await expect(page.getByText("с большим количеством текста будет отклонён", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Текст согласия и ограничения распознавания" }))
    .toHaveAttribute("href", "/legal/photo-processing-consent");
  await expect(page.locator("#upload-button")).toBeDisabled();

  const overflowsHorizontally = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsHorizontally).toBe(false);
});
