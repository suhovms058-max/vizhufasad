import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-360", use: { viewport: { width: 360, height: 780 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: "node e2e/fixture-server.mjs",
    url: "http://127.0.0.1:4173/__health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
