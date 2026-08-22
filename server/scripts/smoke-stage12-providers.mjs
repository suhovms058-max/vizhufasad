import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { normalizeGenerationInput } from "../src/generation/contract.mjs";
import { composeGenerationPrompt } from "../src/generation/prompt.mjs";
import { GenApiGenerationProvider } from "../src/generation/providers/genapi.mjs";
import { GenApiUpscaleProvider } from "../src/upscale/providers/genapi.mjs";

if (process.env.GENERATION_LIVE_SMOKE_ENABLED !== "true") {
  throw new Error("GENERATION_LIVE_SMOKE_ENABLED=true is required for paid Stage 12 smokes");
}
if (!process.env.GENAPI_API_KEY) throw new Error("GENAPI_API_KEY is required");

const sourcePath = path.resolve(String(process.env.STAGE12_SMOKE_SOURCE_IMAGE || ""));
const editBasePath = path.resolve(String(process.env.STAGE12_SMOKE_EDIT_BASE_IMAGE || ""));
const maskPath = path.resolve(String(process.env.STAGE12_SMOKE_MASK_IMAGE || ""));
const outputDir = path.resolve(process.env.STAGE12_SMOKE_OUTPUT_DIR || "D:/VIZHUFASAD/stage12-smoke-results");
const statePath = path.join(outputDir, "metrics.json");
const budgetMinor = Math.min(30_000, Math.max(1, Number(process.env.STAGE12_SMOKE_BUDGET_MINOR || 1)));
const actions = String(process.env.STAGE12_SMOKE_ACTIONS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const allowed = new Set(["pro", "edit", "mask", "upscale"]);
if (!actions.length || actions.some((action) => !allowed.has(action))) {
  throw new Error("STAGE12_SMOKE_ACTIONS must contain pro,edit,mask and/or upscale");
}

const estimates = { pro: 5000, edit: 2500, mask: 1500, upscale: 1000 };
const estimatedTotalMinor = actions.reduce((sum, action) => sum + estimates[action], 0);
if (estimatedTotalMinor > budgetMinor) {
  throw new Error(`Estimated Stage 12 smoke cost ${estimatedTotalMinor} exceeds budget ${budgetMinor}`);
}

await mkdir(outputDir, { recursive: true });
let state = { startedAt: new Date().toISOString(), budgetMinor, estimatedTotalMinor, currency: "RUB", actions: {} };
try { state = JSON.parse(await readFile(statePath, "utf8")); } catch {}
const persist = async () => writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
const spent = () => Object.values(state.actions).reduce((sum, item) => sum + Number(item.actualCostMinor || 0), 0);

const readImage = async (filename) => {
  if (!filename || filename === path.parse(filename).root) throw new Error("Stage 12 smoke image path is required");
  const buffer = await readFile(filename);
  const metadata = await sharp(buffer, { limitInputPixels: 80_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Cannot decode ${filename}`);
  return { buffer, metadata, mimeType: metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "image/jpeg" };
};
const dimensions = ({ width, height }) => width >= height
  ? { width: 1024, height: Math.max(512, Math.round((1024 * height / width) / 16) * 16) }
  : { width: Math.max(512, Math.round((1024 * width / height) / 16) * 16), height: 1024 };
const facadeInput = normalizeGenerationInput({
  style: "современный минимализм", materials: ["светлый клинкер", "натуральное дерево"],
  palette: ["молочный", "натуральное дерево", "графит"], transformationLevel: "gentle",
  wishes: "Полностью завершить карниз, цоколь, откосы и существующие опоры.", negativeConstraints: [],
});

async function runGeneration(action, { model, source, mask = null, edit = null }) {
  const current = state.actions[action] || { status: "created", estimatedCostMinor: estimates[action] };
  if (current.status === "success") return;
  if (spent() + estimates[action] > budgetMinor) throw new Error(`Budget guard stopped before ${action}`);
  state.actions[action] = current;
  await persist();
  const provider = new GenApiGenerationProvider({
    apiKey: process.env.GENAPI_API_KEY, endpoint: process.env.GENAPI_ENDPOINT,
    model, estimatedCostMinor: estimates[action], pollIntervalMs: Number(process.env.GENERATION_POLL_INTERVAL_MS || 1500),
  });
  const prompt = composeGenerationPrompt(facadeInput, { edit }).prompt;
  const started = Date.now();
  const result = await provider.generate({
    sourceImage: source.buffer, sourceMimeType: source.mimeType,
    maskImage: mask?.buffer || null, maskMimeType: mask?.mimeType || "image/png",
    prompt, seed: 12_000 + actions.indexOf(action), ...dimensions(source.metadata),
    resumeRequestId: current.requestId || null,
    onSubmitted: async (requestId) => {
      current.status = "submitted";
      current.requestId = requestId;
      await persist();
    },
    signal: AbortSignal.timeout(Number(process.env.GENERATION_PROVIDER_TIMEOUT_MS || 240_000)),
  });
  const extension = result.contentType === "image/png" ? "png" : "jpg";
  const output = `${action}-${model}.${extension}`;
  await writeFile(path.join(outputDir, output), result.result);
  Object.assign(current, {
    status: "success", requestId: result.jobId, model, output,
    wallTimeMs: Date.now() - started, providerDurationMs: result.durationMs,
    actualCostMinor: result.actualCostMinor, finishedAt: new Date().toISOString(),
  });
  await persist();
}

async function runUpscale(source) {
  const action = "upscale";
  const current = state.actions[action] || { status: "created", estimatedCostMinor: estimates[action] };
  if (current.status === "success") return;
  if (spent() + estimates[action] > budgetMinor) throw new Error("Budget guard stopped before upscale");
  state.actions[action] = current;
  await persist();
  const provider = new GenApiUpscaleProvider({
    apiKey: process.env.GENAPI_API_KEY, endpoint: process.env.GENAPI_ENDPOINT,
    model: process.env.GENAPI_UPSCALE_MODEL || "drct-super-resolution", factor: 4,
    estimatedCostMinor: estimates[action], pollIntervalMs: Number(process.env.UPSCALE_POLL_INTERVAL_MS || 1500),
  });
  const started = Date.now();
  const result = await provider.upscale({
    sourceImage: source.buffer, sourceMimeType: source.mimeType,
    resumeRequestId: current.requestId || null,
    onSubmitted: async (requestId) => { current.status = "submitted"; current.requestId = requestId; await persist(); },
    signal: AbortSignal.timeout(Number(process.env.UPSCALE_TIMEOUT_MS || 300_000)),
  });
  const metadata = await sharp(result.result, { limitInputPixels: 100_000_000 }).metadata();
  const landscape4k = metadata.width >= 3840 && metadata.height >= 2160;
  const portrait4k = metadata.width >= 2160 && metadata.height >= 3840;
  if (!landscape4k && !portrait4k) throw new Error(`Upscale is not 4K: ${metadata.width}x${metadata.height}`);
  const output = `upscale-${metadata.width}x${metadata.height}.png`;
  await writeFile(path.join(outputDir, output), result.result);
  Object.assign(current, {
    status: "success", requestId: result.requestId, model: result.model, output,
    width: metadata.width, height: metadata.height, wallTimeMs: Date.now() - started,
    providerDurationMs: result.durationMs, actualCostMinor: result.actualCostMinor,
    finishedAt: new Date().toISOString(),
  });
  await persist();
}

const source = await readImage(sourcePath);
const editBase = actions.some((action) => ["edit", "mask", "upscale"].includes(action))
  ? await readImage(editBasePath) : null;
if (actions.includes("pro")) await runGeneration("pro", { model: process.env.GENAPI_PRO_MODEL || "nano-banana-pro", source });
if (actions.includes("edit")) await runGeneration("edit", {
  model: process.env.GENAPI_EDIT_MODEL || "qwen-image-edit-plus", source: editBase,
  edit: { scope: "walls", command: "Заменить только отделку стен на светлый клинкер. Остальное оставить без изменений." },
});
if (actions.includes("mask")) {
  const mask = await readImage(maskPath);
  if (mask.metadata.format !== "png" || mask.metadata.width !== editBase.metadata.width || mask.metadata.height !== editBase.metadata.height) {
    throw new Error("STAGE12_SMOKE_MASK_IMAGE must be PNG with exact edit-base dimensions");
  }
  await runGeneration("mask", {
    model: process.env.GENAPI_MASK_EDIT_MODEL || "bria-genfill", source: editBase, mask,
    edit: { scope: "custom_mask", command: "Заменить материал только в белой области маски на натуральное дерево." },
  });
}
if (actions.includes("upscale")) await runUpscale(editBase);
state.finishedAt = new Date().toISOString();
state.actualTotalMinor = spent();
await persist();
