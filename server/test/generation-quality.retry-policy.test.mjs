import assert from "node:assert/strict";
import test from "node:test";
import { automaticQualityRetryPolicy } from "../src/generation-quality/retry-policy.mjs";

test("finish and artifact failures may use the single automatic retry", () => {
  assert.equal(automaticQualityRetryPolicy([
    "finish_below_threshold", "unfinished_facade_detected", "artifacts_below_threshold",
  ]).eligible, true);
});

test("entrance platform or other architectural failures stop before a second paid call", () => {
  const policy = automaticQualityRetryPolicy([
    "entrance_group_changed_detected", "spatial_layout_below_threshold",
  ]);
  assert.equal(policy.eligible, false);
  assert.deepEqual(policy.architecturalReasons, [
    "entrance_group_changed_detected", "spatial_layout_below_threshold",
  ]);
});
