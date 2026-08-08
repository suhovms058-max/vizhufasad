import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createFreeWatermark } from "../src/generation/watermark.mjs";

test("free facade watermark produces a decodable same-size image without metadata", async () => {
  const source = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#876543" },
  }).withMetadata({ exif: { IFD0: { Copyright: "private" } } }).jpeg().toBuffer();
  const watermarked = await createFreeWatermark(source);
  const metadata = await sharp(watermarked).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 600);
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.notDeepEqual(watermarked, source);
});
