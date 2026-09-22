import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.env.QA_PUBLIC_BASE_URL || "http://127.0.0.1:3011";
const outputDirectory = process.env.QA_SCREENSHOT_DIR || "D:/VIZHUFASAD/qa-auth-yield";
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.route("**/api/analytics/events", (route) => route.fulfill({ status: 202, body: "" }));
    await page.route("**/api/public/catalog", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tariffs: [], actions: [] }),
    }));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().includes("/api/analytics/events")) {
        errors.push(`${response.status()}:${response.url()}`);
      }
    });
    for (const route of ["/", "/vizualizaciya-fasada-doma", "/partners"]) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
      const cabinet = page.getByRole("link", { name: "Личный кабинет" }).first();
      if (!await cabinet.isVisible()) throw new Error(`CABINET_LINK_NOT_VISIBLE:${viewport.name}:${route}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error(`HORIZONTAL_OVERFLOW:${viewport.name}:${route}`);
      const slug = route === "/" ? "home" : route.slice(1);
      await page.screenshot({ path: `${outputDirectory}/${viewport.name}-${slug}.png`, fullPage: true });
    }
    if (errors.length) throw new Error(`BROWSER_CONSOLE_ERRORS:${viewport.name}:${errors.join(" | ")}`);
    await page.close();
  }
  process.stdout.write("public cabinet links: desktop/mobile passed\n");
} finally {
  await browser.close();
}
