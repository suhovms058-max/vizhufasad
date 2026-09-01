import assert from "node:assert/strict";
import test from "node:test";
import { PlanAccessRepository } from "../src/access/repository.mjs";
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

test("owner grant returned by the repository unlocks maximum", async () => {
  const service = new PlanAccessService({ highestPaidPackage: async () => "MAXIMUM" });
  assert.equal((await service.forUser("owner")).code, "MAXIMUM");
});

test("partner redemption is a maximum-tier access source", async () => {
  let sql = "";
  const repository = new PlanAccessRepository({
    async query(statement) { sql = String(statement); return { rows: [{ code: "MAXIMUM" }] }; },
  });
  assert.equal(await repository.highestPaidPackage("partner-user"), "MAXIMUM");
  assert.match(sql, /from partner_credit_codes partner_code/u);
  assert.match(sql, /partner_code\.redeemed_by = \$1/u);
  assert.match(sql, /partner_code\.expires_at is null or partner_code\.expires_at > now\(\)/u);
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
