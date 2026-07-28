import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  detectImageMime, ImageValidationError, processSourceImage,
} from "../src/projects/image-processing.mjs";

test("image processing auto-orients, converts to sRGB and strips EXIF", async () => {
  const input = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#b6c2aa" },
  })
    .withExif({ IFD0: { Artist: "must-not-survive" } })
    .jpeg()
    .toBuffer();

  const result = await processSourceImage(input);
  const [sourceMetadata, workingMetadata, thumbnailMetadata] = await Promise.all([
    sharp(result.source).metadata(),
    sharp(result.working).metadata(),
    sharp(result.thumbnail).metadata(),
  ]);

  assert.equal(result.detectedMimeType, "image/jpeg");
  assert.equal(result.recommendedSize, true);
  assert.equal(sourceMetadata.width, 1200);
  assert.equal(sourceMetadata.height, 800);
  assert.equal(sourceMetadata.space, "srgb");
  assert.equal(sourceMetadata.exif, undefined);
  assert.equal(workingMetadata.exif, undefined);
  assert.equal(thumbnailMetadata.format, "webp");
  assert.ok(thumbnailMetadata.width <= 480);
  assert.ok(thumbnailMetadata.height <= 360);
});

test("image processing rejects bad magic, tiny images and MIME-like garbage", async () => {
  assert.throws(
    () => detectImageMime(Buffer.from("not an image at all")),
    (error) => error instanceof ImageValidationError
      && error.code === "UNSUPPORTED_OR_MISMATCHED_IMAGE",
  );
  const tiny = await sharp({
    create: { width: 639, height: 419, channels: 3, background: "white" },
  }).jpeg().toBuffer();
  await assert.rejects(
    processSourceImage(tiny),
    (error) => error instanceof ImageValidationError && error.code === "IMAGE_TOO_SMALL",
  );
  const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)]);
  await assert.rejects(
    processSourceImage(fakeJpeg),
    (error) => error instanceof ImageValidationError && error.code === "IMAGE_DECODE_FAILED",
  );
});
