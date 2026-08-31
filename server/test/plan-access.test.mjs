import assert from "node:assert/strict";
import test from "node:test";
import { accessForPlan, PlanAccessService } from "../src/access/plans.mjs";

test("packages progressively unlock styles and tools", () => {
  const start = accessForPlan("START");
  const optimum = accessForPlan("OPTIMUM");
  const maximum = accessForPlan("MAXIMUM");
  assert.equal(start.styles.length - 1, 4);
  assert.equal(optimum.styles.length - 1, 7);
  assert.equal(maximum.styles.length - 1, 10);
  assert.equal(start.pro, false);
  assert.equal(optimum.pro, true);
  assert.equal(optimum.editor, false);
  assert.equal(maximum.editor, true);
  assert.equal(maximum.upscale, true);
});

test("topups do not unlock a package tier", () => {
  assert.equal(accessForPlan("TOPUP_3").code, "START");
});

test("generation access rejects unavailable style, material and kind", async () => {
  const service = new PlanAccessService({ highestPaidPackage: async () => "START" });
  assert.equal((await service.assertGeneration("u1", "standard", {
    style: "лофт", materials: ["металл"],
  })).code, "PLAN_STYLE_REQUIRED");
  assert.equal((await service.assertGeneration("u1", "standard", {
    style: "современный", materials: ["металл"],
  })).code, "PLAN_MATERIAL_REQUIRED");
  assert.equal((await service.assertGeneration("u1", "pro", {
    style: "современный", materials: ["дерево"],
  })).code, "PRO_PLAN_REQUIRED");
});
