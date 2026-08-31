import { expect, test } from "@playwright/test";

test("tariffs keep offer and promo controls readable", async ({ page }) => {
    await page.goto("/app/balance?plan=OPTIMUM#plan-OPTIMUM");
    await page.waitForLoadState("networkidle");

    await expect(page.locator(".tariff-grid").first().locator(".tariff-card")).toHaveCount(3);
    await expect(page.locator(".topup-grid .tariff-card")).toHaveCount(3);
    await expect(page.locator(".consent-confirm input[type=checkbox]")).toHaveCount(6);
    await expect(page.locator(".consent-confirm input[type=checkbox]:checked")).toHaveCount(0);

    const consentLayout = await page.locator(".consent-confirm").evaluateAll((labels) => labels.map((label) => {
      const input = label.querySelector("input").getBoundingClientRect();
      const text = label.querySelector("span").getBoundingClientRect();
      return {
        inputWidth: input.width,
        inputRight: input.right,
        textLeft: text.left,
        textHeight: text.height,
        labelWidth: label.getBoundingClientRect().width,
        scrollWidth: label.scrollWidth,
      };
    }));
    for (const item of consentLayout) {
      expect(item.inputWidth).toBeLessThanOrEqual(22);
      expect(item.textLeft).toBeGreaterThan(item.inputRight);
      expect(item.textHeight).toBeGreaterThan(20);
      expect(item.scrollWidth).toBeLessThanOrEqual(Math.ceil(item.labelWidth));
    }

    await expect(page.locator(".promo-disclosure input")).toHaveCount(6);
    await expect(page.locator(".promo-disclosure input:visible")).toHaveCount(0);
    await page.locator(".promo-disclosure summary").first().click();
    await expect(page.locator(".promo-disclosure input:visible")).toHaveCount(1);
    await expect(page.getByText("Промокоды предназначены для партнёров ресурса").first()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
});
