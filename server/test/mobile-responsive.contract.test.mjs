import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_ASSET_VERSION, versionedAppAsset } from "../src/ui/assets.mjs";

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

test("dynamic application pages use one versioned stylesheet URL", async () => {
  assert.equal(versionedAppAsset("/assets/app-ui.css"), `/assets/app-ui.css?v=${APP_ASSET_VERSION}`);
  for (const file of [
    "server/src/projects/pages.mjs",
    "server/src/wallet/pages.mjs",
    "server/src/auth/pages.mjs",
    "server/src/legal/pages.mjs",
    "server/src/admin/pages.mjs",
  ]) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.match(source, /APP_ASSET_VERSION|versionedAppAsset/);
  }
});
