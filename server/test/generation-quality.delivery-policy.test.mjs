import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_MIN_OVERALL_SCORE, bestFallbackAssessment, fallbackDeliveryPolicy,
} from "../src/generation-quality/delivery-policy.mjs";

test("fallback policy accepts only high-enough soft misses", () => {
  const soft = fallbackDeliveryPolicy({
    failureReasons: ["position_below_threshold", "overall_below_threshold"],
    overallScore: FALLBACK_MIN_OVERALL_SCORE + 300,
  });
  assert.equal(soft.eligible, true);
  assert.deepEqual(soft.hardFailureReasons, []);

  const low = fallbackDeliveryPolicy({
    failureReasons: ["position_below_threshold"], overallScore: FALLBACK_MIN_OVERALL_SCORE - 1,
  });
  assert.equal(low.eligible, false);
});

test("fallback policy never rescues architecture, artifacts or unfinished facade failures", () => {
  for (const reason of [
    "roof_changed_detected", "windows_count_mismatch", "artifacts_below_threshold",
    "finish_below_threshold", "unfinished_facade_detected",
  ]) {
    const policy = fallbackDeliveryPolicy({ failure_reasons: [reason], overall_score: 9_900 });
    assert.equal(policy.eligible, false, reason);
    assert.deepEqual(policy.hardFailureReasons, [reason]);
  }
});

test("best fallback selects the highest-scoring eligible candidate", () => {
  const first = { id: "first", failure_reasons: ["position_changed_detected"], overall_score: 7_100 };
  const second = { id: "second", failure_reasons: ["perspective_below_threshold"], overall_score: 7_500 };
  const unsafe = { id: "unsafe", failure_reasons: ["roof_below_threshold"], overall_score: 9_900 };
  assert.equal(bestFallbackAssessment([first, unsafe, second]).id, "second");
});
