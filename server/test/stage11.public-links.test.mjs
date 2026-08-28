import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landingPage = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const heroCarousel = readFileSync(new URL("../../app/HeroFacadeCarousel.tsx", import.meta.url), "utf8");
const publicAnalytics = readFileSync(new URL("../../public/product-analytics.js", import.meta.url), "utf8");
const appAnalytics = readFileSync(new URL("../public/product-analytics.js", import.meta.url), "utf8");

test("public landing links stay on the currently deployed origin", () => {
  assert.doesNotMatch(landingPage, /89\.23\.97\.248|89-23-97-248/u);
  assert.match(landingPage, /APP_URL[^\n]+\|\| "\/app\/new"/u);
  assert.match(landingPage, /href="\/legal\/offer"/u);
  assert.match(landingPage, /href="\/legal\/privacy"/u);
  assert.match(landingPage, /href="\/legal\/refunds"/u);
});

test("homepage style carousel uses one second for every image", () => {
  assert.match(heroCarousel, /const slideDuration = 1000/u);
  assert.doesNotMatch(heroCarousel, /duration:\s*(?:400|900)/u);
  assert.match(heroCarousel, /setTimeout[\s\S]*slideDuration/u);
});

test("privacy notice explains optional analytics and links to a published legal page", () => {
  for (const source of [publicAnalytics, appAnalytics]) {
    assert.match(source, /Настройка cookie/u);
    assert.match(source, /Только необходимые cookie/u);
    assert.match(source, /Разрешите дополнительно включить обезличенную аналитику/u);
    assert.match(source, /\/legal\/privacy/u);
    assert.doesNotMatch(source, /\/legal\/cookies/u);
  }
});
