import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runGenerationQualityRegression } from "../scripts/generation-quality-regression.mjs";

test("golden structural regression passes every protected-change case", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vizhufasad-quality-"));
  const reportPath = path.join(directory, "report.md");
  const results = await runGenerationQualityRegression({ reportPath });
  assert.equal(results.length, 5);
  assert.equal(results.every((item) => item.passed), true, results);
  assert.match(await readFile(reportPath, "utf8"), /Summary: 5\/5 cases passed/);
});
