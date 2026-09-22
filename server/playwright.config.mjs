import { defineConfig } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT || 4173);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: e2eBaseUrl,
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
    url: `${e2eBaseUrl}/__health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
