import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("mobile public controls keep usable touch targets and a scrollable carousel rail", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(css, /grid-template-columns:\s*44px minmax\(0,1fr\) 44px 44px/);
  assert.match(css, /\.carouselDot\s*\{[^}]*flex:\s*0 0 24px;[^}]*width:\s*24px;/s);
  assert.match(css, /\.footerGroup a,[^{]*\.footerPrivacyButton\s*\{[^}]*min-height:\s*44px;/s);
});

test("mobile cabinet navigation keeps full-size touch destinations", async () => {
  const css = await readFile(new URL("server/public/app-ui.css", root), "utf8");
  assert.match(css, /\.app-header nav a,[^{]*\.app-footer button\s*\{[^}]*min-height:44px;/s);
});
