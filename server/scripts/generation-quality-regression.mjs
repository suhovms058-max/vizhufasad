import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { analyzeStructuralSimilarity } from "../src/generation-quality/structural.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(scriptDirectory, "../test/fixtures/generation-quality-cases.json");
const defaultReportPath = path.resolve(scriptDirectory, "../../docs/GENERATION_QUALITY_REGRESSION.md");

function facade({ shift = 0, roofHeight = 48, openingShift = 0, color = "#d8c7aa" } = {}) {
  const left = 48 + shift;
  const right = 208 + shift;
  const svg = `<svg width="256" height="192" xmlns="http://www.w3.org/2000/svg">
    <rect width="256" height="192" fill="#d7e3ea"/>
    <path d="M ${left} 88 L 128 ${roofHeight} L ${right} 88" fill="none" stroke="#303030" stroke-width="5"/>
    <rect x="${left}" y="88" width="${right - left}" height="88" fill="${color}" stroke="#303030" stroke-width="5"/>
    <rect x="${75 + openingShift}" y="108" width="28" height="34" fill="#333"/>
    <rect x="153" y="108" width="28" height="34" fill="#333"/>
    <rect x="114" y="128" width="28" height="48" fill="#555"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

function expectationPasses(result, expected) {
  const checks = [
    expected.contoursMin == null || result.contours >= expected.contoursMin,
    expected.contoursMax == null || result.contours <= expected.contoursMax,
    expected.protectedZonesMin == null || result.protectedZones >= expected.protectedZonesMin,
    expected.positionMax == null || result.zones.position <= expected.positionMax,
    expected.roofMax == null || result.zones.roof <= expected.roofMax,
    expected.windowsMax == null || result.zones.windows <= expected.windowsMax,
    expected.roofAbsent !== true || result.zones.roof == null,
  ];
  return checks.every(Boolean);
}

export async function runGenerationQualityRegression({ reportPath = defaultReportPath } = {}) {
  const cases = JSON.parse(await readFile(fixturePath, "utf8"));
  const results = [];
  for (const fixture of cases) {
    const result = await analyzeStructuralSimilarity(
      await facade(fixture.source),
      await facade(fixture.candidate),
      { allowedChanges: fixture.allowedChanges || {} },
    );
    results.push({ fixture, result, passed: expectationPasses(result, fixture.expect) });
  }
  const lines = [
    "# Generation Quality Golden Regression",
    "",
    "Deterministic structural evidence set. It intentionally changes geometry and finish independently; it does not call a paid VLM or generation provider.",
    "",
    `Generated with structural evidence version: \`${results[0]?.result.version || "n/a"}\`.`,
    "",
    "| Case | Expected | Contours | Layout | Protected zones | Result |",
    "|---|---|---:|---:|---:|---|",
    ...results.map(({ fixture, result, passed }) => (
      `| ${fixture.id} | ${fixture.description} | ${result.contours} | ${result.spatialLayout} | ${result.protectedZones} | ${passed ? "PASS" : "FAIL"} |`
    )),
    "",
    `Summary: ${results.filter((item) => item.passed).length}/${results.length} cases passed.`,
    "",
  ];
  await writeFile(reportPath, lines.join("\n"), "utf8");
  return results;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const results = await runGenerationQualityRegression();
  if (results.some((item) => !item.passed)) process.exitCode = 1;
  else console.log(`Generation quality regression passed: ${results.length}/${results.length}`);
}
