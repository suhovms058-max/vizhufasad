import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";
import {
  computePerceptualHash, ImageAnonymizationError, LocalImageAnonymizer,
} from "../src/projects/anonymization.mjs";

const fixture = fileURLToPath(new URL("../test-support/anonymizer-success.mjs", import.meta.url));

test("perceptual hash is stable for a re-encoded sanitized image", async () => {
  const source = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#234567" },
  }).composite([{ input: Buffer.from('<svg width="180" height="140"><rect width="180" height="140" fill="#f2d3a0"/></svg>'), left: 70, top: 90 }])
    .jpeg({ quality: 92 }).toBuffer();
  const reencoded = await sharp(source).jpeg({ quality: 80 }).toBuffer();
  const [first, second] = await Promise.all([
    computePerceptualHash(source), computePerceptualHash(reencoded),
  ]);
  assert.match(first, /^[0-9a-f]{16}$/u);
  assert.equal(second, first);
});

test("local anonymizer accepts output only with all mandatory detector reports", async () => {
  const input = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#d0c0a0" },
  }).jpeg().toBuffer();
  const anonymizer = new LocalImageAnonymizer({
    enabled: true,
    timeoutMs: 5_000,
    pythonBin: process.execPath,
    scriptPath: fixture,
    faceModelPath: fixture,
    textModelPath: fixture,
    plateModelPath: fixture,
    plateYoloModelPath: fixture,
  });
  const result = await anonymizer.anonymize(input);
  assert.deepEqual(result.image, input);
  assert.equal(result.report.detectors.face, "ok");
  assert.equal((await sharp(result.image).metadata()).exif, undefined);
});

test("local anonymizer fails closed when disabled or models are missing", async () => {
  const input = Buffer.alloc(32, 1);
  await assert.rejects(
    new LocalImageAnonymizer({ enabled: false }).anonymize(input),
    (error) => error instanceof ImageAnonymizationError
      && error.code === "PHOTO_ANONYMIZATION_UNAVAILABLE",
  );
  await assert.rejects(
    new LocalImageAnonymizer({
      enabled: true, timeoutMs: 5_000, pythonBin: process.execPath,
      scriptPath: fixture, faceModelPath: "missing", textModelPath: fixture, plateModelPath: fixture,
      plateYoloModelPath: fixture,
    }).anonymize(input),
    (error) => error instanceof ImageAnonymizationError
      && error.code === "PHOTO_ANONYMIZATION_MODELS_MISSING",
  );
  await assert.rejects(
    new LocalImageAnonymizer({
      enabled: true, timeoutMs: 5_000, pythonBin: process.execPath,
      scriptPath: fixture, faceModelPath: fixture, textModelPath: fixture, plateModelPath: fixture,
      plateYoloModelPath: "missing",
    }).anonymize(input),
    (error) => error instanceof ImageAnonymizationError
      && error.code === "PHOTO_ANONYMIZATION_MODELS_MISSING",
  );
});

test("local anonymizer rejects a suspected document even when all detectors completed", async () => {
  const input = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#d0c0a0" },
  }).jpeg().toBuffer();
  const previous = process.env.ANONYMIZER_DOCUMENT_SUSPECTED;
  process.env.ANONYMIZER_DOCUMENT_SUSPECTED = "true";
  const anonymizer = new LocalImageAnonymizer({
    enabled: true,
    timeoutMs: 5_000,
    pythonBin: process.execPath,
    scriptPath: fixture,
    faceModelPath: fixture,
    textModelPath: fixture,
    plateModelPath: fixture,
    plateYoloModelPath: fixture,
  });
  try {
    await assert.rejects(
      anonymizer.anonymize(input),
      (error) => error instanceof ImageAnonymizationError
        && error.code === "PHOTO_ANONYMIZATION_DOCUMENT_SUSPECTED",
    );
  } finally {
    if (previous === undefined) delete process.env.ANONYMIZER_DOCUMENT_SUSPECTED;
    else process.env.ANONYMIZER_DOCUMENT_SUSPECTED = previous;
  }
});
