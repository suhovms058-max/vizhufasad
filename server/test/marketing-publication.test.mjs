import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public gallery is a curated static catalog and has no user-photo publication path", async () => {
  const gallery = await readFile(new URL("../../app/GalleryCases.tsx", import.meta.url), "utf8");
  assert.match(gallery, /const sourceImage = "\/facade-before-bright\.webp"/u);
  assert.match(gallery, /facadeStyles/u);
  assert.doesNotMatch(gallery, /\/api\/projects|source_images|generationId|user_id/u);
});

test("database and server routes contain no marketing mailing or user portfolio feature", async () => {
  const schema = await readFile(new URL("../src/db/schema.mjs", import.meta.url), "utf8");
  const index = await readFile(new URL("../index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(schema, /newsletter|marketing_consent|mailing|portfolio_publication/iu);
  assert.doesNotMatch(index, /newsletter|marketing-mail|publish.*portfolio/iu);
});
