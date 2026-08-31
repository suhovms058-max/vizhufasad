import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("local anonymizer limits concurrent detector processes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "vizhufasad-anonymizer-"));
  const tracePath = path.join(directory, "trace.log");
  const previousTrace = process.env.ANONYMIZER_TRACE_PATH;
  const previousDelay = process.env.ANONYMIZER_DELAY_MS;
  process.env.ANONYMIZER_TRACE_PATH = tracePath;
  process.env.ANONYMIZER_DELAY_MS = "150";
  const input = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#d0c0a0" },
  }).jpeg().toBuffer();
  const anonymizer = new LocalImageAnonymizer({
    enabled: true,
    timeoutMs: 5_000,
    concurrency: 1,
    pythonBin: process.execPath,
    scriptPath: fixture,
    faceModelPath: fixture,
    textModelPath: fixture,
    plateModelPath: fixture,
    plateYoloModelPath: fixture,
  });
  try {
    await Promise.all([anonymizer.anonymize(input), anonymizer.anonymize(input)]);
    const events = (await readFile(tracePath, "utf8")).trim().split(/\r?\n/u);
    assert.equal(events.length, 4);
    assert.match(events[0], /^start:/u);
    assert.match(events[1], /^end:/u);
    assert.match(events[2], /^start:/u);
    assert.match(events[3], /^end:/u);
    assert.equal(events[0].slice(6), events[1].slice(4));
    assert.equal(events[2].slice(6), events[3].slice(4));
  } finally {
    if (previousTrace === undefined) delete process.env.ANONYMIZER_TRACE_PATH;
    else process.env.ANONYMIZER_TRACE_PATH = previousTrace;
    if (previousDelay === undefined) delete process.env.ANONYMIZER_DELAY_MS;
    else process.env.ANONYMIZER_DELAY_MS = previousDelay;
    await rm(directory, { recursive: true, force: true });
  }
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
