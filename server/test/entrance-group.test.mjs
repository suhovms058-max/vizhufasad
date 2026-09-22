import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  createEntranceControlReference, entranceGroupObservation, entranceGroupPromptInstruction,
} from "../src/entrance-group.mjs";

const assessment = {
  observation: {
    entranceGroupPresent: true,
    entranceGroupVisibility: "clear",
    entranceGroupType: "terrace_platform",
    entranceGroupBounds: { left: 0.1, top: 0.55, right: 0.78, bottom: 0.94 },
    entranceGroupSpanRatio: 0.68,
    entranceGroupConfidence: 0.94,
    entranceGroupDescription: "Широкая площадка занимает большую часть фасада.",
  },
};

test("entrance observation becomes a geometry lock and design brief", () => {
  const entrance = entranceGroupObservation(assessment);
  const instruction = entranceGroupPromptInstruction(entrance);
  assert.equal(entrance.spanRatio, 0.68);
  assert.match(instruction, /exact footprint, span, depth, height/u);
  assert.match(instruction, /Redesign and fully finish/u);
  assert.match(instruction, /never shorten, enlarge, remove/u);
});

test("clear entrance bounds produce a second spatial reference without changing dimensions", async () => {
  const source = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#c8b89f" },
  }).jpeg().toBuffer();
  const result = await createEntranceControlReference(source, entranceGroupObservation(assessment));
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 600);
  assert.notDeepEqual(result, source);
});

test("unclear entrance observations never create a misleading control reference", () => {
  assert.equal(entranceGroupObservation({
    observation: { ...assessment.observation, entranceGroupVisibility: "partial" },
  }), null);
});
