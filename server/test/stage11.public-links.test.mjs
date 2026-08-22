import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landingPage = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");

test("public landing links stay on the currently deployed origin", () => {
  assert.doesNotMatch(landingPage, /89\.23\.97\.248|89-23-97-248/u);
  assert.match(landingPage, /APP_URL[^\n]+\|\| "\/app\/new"/u);
  assert.match(landingPage, /href="\/legal\/offer"/u);
  assert.match(landingPage, /href="\/legal\/privacy"/u);
  assert.match(landingPage, /href="\/legal\/refunds"/u);
});
