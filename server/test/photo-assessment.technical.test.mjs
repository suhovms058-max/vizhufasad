import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { analyzeTechnicalPhoto } from "../src/photo-assessment/technical.mjs";

test("Sharp technical assessment measures resolution, detail and lighting", async () => {
  const lowResolutionDark = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#050505" },
  }).jpeg().toBuffer();
  const result = await analyzeTechnicalPhoto(lowResolutionDark);
  assert.equal(result.width, 600);
  assert.equal(result.height, 400);
  assert.ok(result.blocking.includes("resolution_below_minimum"));
  assert.ok(result.blocking.includes("extreme_underexposure"));
  assert.ok(result.blocking.includes("extreme_blur_or_no_detail"));
});

test("recommended resolution does not create a resolution warning", async () => {
  const pixels = Buffer.alloc(1200 * 800 * 3);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = index % 251;
  const detailed = await sharp(pixels, { raw: { width: 1200, height: 800, channels: 3 } })
    .jpeg()
    .toBuffer();
  const result = await analyzeTechnicalPhoto(detailed);
  assert.equal(result.recommendedResolution, true);
  assert.equal(result.blocking.includes("resolution_below_minimum"), false);
  assert.equal(result.warnings.includes("resolution_below_recommended"), false);
});
