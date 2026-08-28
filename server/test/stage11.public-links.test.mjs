import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landingPage = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const publicAnalytics = readFileSync(new URL("../../public/product-analytics.js", import.meta.url), "utf8");
const appAnalytics = readFileSync(new URL("../public/product-analytics.js", import.meta.url), "utf8");

test("public landing links stay on the currently deployed origin", () => {
  assert.doesNotMatch(landingPage, /89\.23\.97\.248|89-23-97-248/u);
  assert.match(landingPage, /APP_URL[^\n]+\|\| "\/app\/new"/u);
  assert.match(landingPage, /href="\/legal\/offer"/u);
  assert.match(landingPage, /href="\/legal\/privacy"/u);
  assert.match(landingPage, /href="\/legal\/refunds"/u);
});

test("privacy notice explains optional analytics and links to a published legal page", () => {
  for (const source of [publicAnalytics, appAnalytics]) {
    assert.match(source, /Необязательная аналитика/u);
    assert.match(source, /Оставить только необходимые/u);
    assert.match(source, /\/legal\/privacy/u);
    assert.doesNotMatch(source, /\/legal\/cookies/u);
  }
});
