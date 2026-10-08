import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createFacadeControlReference, materialZonePromptInstruction } from "../src/generation/material-zones.mjs";

test("material zone control reference keeps source dimensions and adds visible annotation", async () => {
  const source = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#d8d2c7" },
  }).jpeg().toBuffer();
  const zones = [{
    material: "камень",
    color: "#FF6B35",
    brushSize: 0.045,
    strokes: [[{ x: 0.12, y: 0.75 }, { x: 0.72, y: 0.76 }]],
  }];
  const control = await createFacadeControlReference(source, zones, null);
  const metadata = await sharp(control).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 600);
  assert.notDeepEqual(control, source);
});

test("material zone control reference can combine zones with entrance protection", async () => {
  const source = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#b8b4aa" },
  }).jpeg().toBuffer();
  const control = await createFacadeControlReference(source, [{
    material: "дерево", color: "#00B8D9", brushSize: 0.03,
    strokes: [[{ x: 0.55, y: 0.25 }]],
  }], {
    bounds: { left: 0.2, top: 0.55, right: 0.8, bottom: 0.9 },
  });
  assert.equal((await sharp(control).metadata()).format, "jpeg");
});

test("material zone prompt explains snapping and forbids copying annotations", () => {
  const prompt = materialZonePromptInstruction([{
    material: "клинкер", color: "#FF6B35", brushSize: 0.04, strokes: [[{ x: 0.4, y: 0.4 }]],
  }]);
  assert.match(prompt, /binding spatial instruction/u);
  assert.match(prompt, /nearest existing facade edge/u);
  assert.match(prompt, /Do not reproduce the colored contours/u);
  assert.match(prompt, /клинкер/u);
});
