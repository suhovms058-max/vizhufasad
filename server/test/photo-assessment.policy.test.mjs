import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import { decidePhotoAssessment } from "../src/photo-assessment/policy.mjs";
import {
  allowedAssessmentDecisions, providerObservationSchema,
} from "../src/photo-assessment/schema.mjs";

const cases = JSON.parse(await readFile(
  new URL("./fixtures/photo-assessment-cases.json", import.meta.url),
  "utf8",
));

const baseTechnical = {
  width: 1600,
  height: 1000,
  format: "jpeg",
  entropy: 6.2,
  sharpness: 3.1,
  luminance: 128,
  recommendedResolution: true,
  warnings: [],
  blocking: [],
};

const baseObservation = {
  scene: "facade",
  houseVisible: true,
  facadeVisible: true,
  frameCompleteness: "complete",
  geometry: "good",
  obstruction: "none",
  perspective: "good",
  sharpness: "good",
  lighting: "good",
  roofCrop: "none",
  confidence: 0.94,
  issueCodes: [],
};

for (const fixture of cases) {
  test(`assessment policy: ${fixture.category}`, () => {
    const result = decidePhotoAssessment(
      { ...baseTechnical, ...(fixture.technical || {}) },
      { ...baseObservation, ...(fixture.observation || {}) },
    );
    assert.equal(result.decision, fixture.expected);
    assert.ok(allowedAssessmentDecisions.has(result.decision));
    if (fixture.reason) {
      const reasons = [
        ...result.technicalResult.policy.blockingReasons,
        ...result.technicalResult.policy.warningReasons,
      ];
      assert.ok(reasons.includes(fixture.reason), `${fixture.reason} missing in ${reasons}`);
      assert.ok(result.userResult.recommendations.length > 0);
    }
    if (result.decision === "accepted_with_warning") {
      assert.equal(result.technicalResult.policy.blockingReasons.length, 0);
    }
  });
}

test("provider observation schema is strict", () => {
  const validate = new Ajv({ allErrors: true, strict: true }).compile(providerObservationSchema);
  assert.equal(validate(baseObservation), true);
  assert.equal(validate({ ...baseObservation, unexpected: "manual route" }), false);
  assert.equal(validate({ ...baseObservation, scene: "interior", houseVisible: "yes" }), false);
});
