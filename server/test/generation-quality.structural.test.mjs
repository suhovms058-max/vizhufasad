import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { analyzeStructuralSimilarity } from "../src/generation-quality/structural.mjs";

function facade({ shift = 0, roofHeight = 48, openingShift = 0, color = "#d8c7aa" } = {}) {
  const left = 48 + shift;
  const right = 208 + shift;
  const roofTop = roofHeight;
  const svg = `<svg width="256" height="192" xmlns="http://www.w3.org/2000/svg">
    <rect width="256" height="192" fill="#d7e3ea"/>
    <path d="M ${left} 88 L 128 ${roofTop} L ${right} 88" fill="none" stroke="#303030" stroke-width="5"/>
    <rect x="${left}" y="88" width="${right - left}" height="88" fill="${color}" stroke="#303030" stroke-width="5"/>
    <rect x="${75 + openingShift}" y="108" width="28" height="34" fill="#333"/>
    <rect x="153" y="108" width="28" height="34" fill="#333"/>
    <rect x="114" y="128" width="28" height="48" fill="#555"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

test("edge evidence ignores facade color while preserving geometry", async () => {
  const result = await analyzeStructuralSimilarity(
    await facade({ color: "#cab18d" }),
    await facade({ color: "#7a5137" }),
  );
  assert.ok(result.contours >= 9000, result);
  assert.ok(result.protectedZones >= 9000, result);
});

test("edge evidence detects shifted house and changed roof", async () => {
  const result = await analyzeStructuralSimilarity(
    await facade(),
    await facade({ shift: 18, roofHeight: 24 }),
  );
  assert.ok(result.contours < 8000, result);
  assert.ok(result.zones.roof < 8000, result);
  assert.ok(result.spatialLayout < 9000, result);
});

test("explicitly allowed roof changes remove the roof protected zone", async () => {
  const result = await analyzeStructuralSimilarity(
    await facade(),
    await facade({ roofHeight: 20 }),
    { allowedChanges: { roof: true } },
  );
  assert.equal(result.zones.roof, undefined);
});
