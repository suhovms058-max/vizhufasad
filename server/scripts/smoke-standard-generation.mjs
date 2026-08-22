import "dotenv/config";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { normalizeGenerationInput } from "../src/generation/contract.mjs";
import { composeGenerationPrompt } from "../src/generation/prompt.mjs";
import { GenApiGenerationProvider } from "../src/generation/providers/genapi.mjs";

if (process.env.GENERATION_LIVE_SMOKE_ENABLED !== "true") {
  throw new Error("GENERATION_LIVE_SMOKE_ENABLED=true is required for paid live smoke tests");
}
if (!process.env.GENAPI_API_KEY) throw new Error("GENAPI_API_KEY is required");

const fixturesDir = path.resolve(
  process.env.GENERATION_SMOKE_FIXTURES_DIR || "D:/VIZHUFASAD/stage7-private-facades",
);
const outputDir = path.resolve(
  process.env.GENERATION_SMOKE_OUTPUT_DIR || "D:/VIZHUFASAD/stage7-generation-results",
);
const limit = Math.min(3, Math.max(1, Number(process.env.GENERATION_SMOKE_IMAGE_LIMIT || 3)));
const fileOffset = Math.min(
  100,
  Math.max(0, Number(process.env.GENERATION_SMOKE_IMAGE_OFFSET || 0)),
);
const budgetMinor = Math.min(
  30_000,
  Math.max(1, Number(process.env.GENERATION_SMOKE_BUDGET_MINOR || 30_000)),
);
const availableCandidates = [
  { model: "flux-2-pro", estimatedCostMinor: 2250 },
  { model: "qwen-image-edit-2511", estimatedCostMinor: 1500 },
  { model: "nano-banana-2", estimatedCostMinor: 2500 },
  { model: "seedream-v5-pro", estimatedCostMinor: 2500 },
  { model: "flux-kontext", estimatedCostMinor: 2000 },
  // GenAPI advertised ~10 RUB, but the measured API charge was 79.82 RUB.
  { model: "restyle", estimatedCostMinor: 10_000 },
];
const requestedModels = new Set(
  String(process.env.GENERATION_SMOKE_MODELS || "nano-banana-2")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const candidates = availableCandidates.filter((item) => requestedModels.has(item.model));
if (!candidates.length || candidates.length !== requestedModels.size) {
  throw new Error("GENERATION_SMOKE_MODELS contains an unsupported model");
}
const estimatedTotal = candidates.reduce((sum, item) => sum + item.estimatedCostMinor, 0) * limit;
if (estimatedTotal > budgetMinor) {
  throw new Error(`Estimated live smoke cost ${estimatedTotal} exceeds budget ${budgetMinor}`);
}

const files = (await readdir(fixturesDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/iu.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "ru"))
  .slice(fileOffset, fileOffset + limit);
if (files.length < limit) throw new Error(`Expected at least ${limit} facade fixtures`);
await mkdir(outputDir, { recursive: true });

const input = normalizeGenerationInput({
  style: "современный минимализм",
  materials: ["светлая архитектурная штукатурка", "натуральное дерево в акцентных зонах"],
  palette: ["#E8E1D5", "#6B4D35", "#2F3336"],
  transformationLevel: "gentle",
  wishes: "Обновить только отделку фасада и цветовую композицию.",
  negativeConstraints: [
    "не менять окружающий участок",
    "не добавлять пристройки, балконы, окна или двери",
  ],
});
const composed = composeGenerationPrompt(input);
const metrics = {
  startedAt: new Date().toISOString(),
  promptVersion: composed.version,
  input,
  budgetMinor,
  estimatedTotalMinor: estimatedTotal,
  currency: "RUB",
  results: [],
};
let measuredSpendMinor = 0;

generationLoop:
for (const [fileIndex, filename] of files.entries()) {
  const sourceOrdinal = fileOffset + fileIndex;
  const sourcePath = path.join(fixturesDir, filename);
  const source = await readFile(sourcePath);
  const metadata = await sharp(source, { limitInputPixels: 80_000_000 }).metadata();
  const ratio = metadata.width / metadata.height;
  const width = ratio >= 1 ? 1024 : Math.max(512, Math.round((1024 * ratio) / 16) * 16);
  const height = ratio >= 1 ? Math.max(512, Math.round((1024 / ratio) / 16) * 16) : 1024;

  for (const [modelIndex, candidate] of candidates.entries()) {
    if (measuredSpendMinor + candidate.estimatedCostMinor > budgetMinor) {
      throw new Error(
        `Measured spend ${measuredSpendMinor} plus next estimate `
          + `${candidate.estimatedCostMinor} exceeds budget ${budgetMinor}`,
      );
    }
    const provider = new GenApiGenerationProvider({
      apiKey: process.env.GENAPI_API_KEY,
      endpoint: process.env.GENAPI_ENDPOINT,
      model: candidate.model,
      estimatedCostMinor: candidate.estimatedCostMinor,
      currency: "RUB",
      pollIntervalMs: Number(process.env.GENERATION_POLL_INTERVAL_MS || 1500),
    });
    const seed = 7_000_000 + sourceOrdinal * 100 + modelIndex;
    const started = Date.now();
    try {
      const generated = await provider.generate({
        sourceImage: source,
        sourceMimeType: metadata.format === "png" ? "image/png"
          : metadata.format === "webp" ? "image/webp" : "image/jpeg",
        prompt: composed.prompt,
        seed,
        width,
        height,
        signal: AbortSignal.timeout(Number(process.env.GENERATION_PROVIDER_TIMEOUT_MS || 180_000)),
      });
      const extension = generated.contentType === "image/png" ? "png"
        : generated.contentType === "image/webp" ? "webp" : "jpg";
      const outputName = `${String(sourceOrdinal + 1).padStart(2, "0")}-${candidate.model}.${extension}`;
      await writeFile(path.join(outputDir, outputName), generated.result);
      metrics.results.push({
        source: filename,
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        model: candidate.model,
        status: "success",
        jobId: generated.jobId,
        seed,
        wallTimeMs: Date.now() - started,
        providerDurationMs: generated.durationMs,
        estimatedCostMinor: generated.estimatedCostMinor,
        actualCostMinor: generated.actualCostMinor,
        currency: generated.currency,
        output: outputName,
      });
      measuredSpendMinor += Number(generated.actualCostMinor ?? candidate.estimatedCostMinor);
      console.log(`${candidate.model}: ${filename} -> ${outputName}`);
    } catch (error) {
      metrics.results.push({
        source: filename,
        model: candidate.model,
        status: "error",
        seed,
        wallTimeMs: Date.now() - started,
        errorCode: error.code || error.message,
      });
      const details = error.details == null ? "" : ` ${JSON.stringify(error.details)}`;
      console.error(`${candidate.model}: ${filename} failed: ${error.code || error.message}${details}`);
      if (["GENAPI_HTTP_401", "GENAPI_HTTP_402", "GENAPI_HTTP_403"].includes(error.code)) {
        break generationLoop;
      }
    }
  }
}
metrics.finishedAt = new Date().toISOString();
metrics.actualTotalMinor = metrics.results.reduce(
  (sum, item) => sum + Number(item.actualCostMinor || 0),
  0,
);
await writeFile(
  path.join(outputDir, "metrics.json"),
  `${JSON.stringify(metrics, null, 2)}\n`,
  "utf8",
);
if (metrics.results.some((item) => item.status !== "success")) process.exitCode = 1;
