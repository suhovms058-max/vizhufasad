import sharp from "sharp";

function finiteUnit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

export function entranceGroupObservation(sourceAssessment) {
  const observation = sourceAssessment?.observation || sourceAssessment?.technicalResult?.observation
    || sourceAssessment?.technical_result?.observation || null;
  if (!observation?.entranceGroupPresent || observation.entranceGroupVisibility !== "clear") return null;
  const raw = observation.entranceGroupBounds || {};
  const bounds = {
    left: finiteUnit(raw.left), top: finiteUnit(raw.top),
    right: finiteUnit(raw.right), bottom: finiteUnit(raw.bottom),
  };
  if (Object.values(bounds).some((value) => value == null)
    || bounds.right - bounds.left < 0.05 || bounds.bottom - bounds.top < 0.05) return null;
  return Object.freeze({
    type: String(observation.entranceGroupType || "other"),
    bounds: Object.freeze(bounds),
    spanRatio: finiteUnit(observation.entranceGroupSpanRatio) ?? 0,
    confidence: finiteUnit(observation.entranceGroupConfidence) ?? 0,
    description: String(observation.entranceGroupDescription || "").trim().slice(0, 240),
  });
}

export function entranceGroupPromptInstruction(entrance) {
  if (!entrance) return "";
  const percent = Math.round(entrance.spanRatio * 100);
  return [
    "ENTRANCE GROUP GEOMETRY LOCK — non-negotiable:",
    entrance.description || "An existing entrance platform and stair are visible in the source.",
    percent ? `Its visible width is approximately ${percent}% of the facade.` : "",
    "Keep its exact footprint, span, depth, height, platform edges, stair direction, step arrangement, supports and connection to every exterior door.",
    "Redesign and fully finish its visible surfaces to match the facade: apply coherent materials, colors, plinth treatment, step finish, railings, handrails and lighting where appropriate.",
    "Do not leave raw concrete unfinished, but never shorten, enlarge, remove, move or replace the platform with direct steps.",
  ].filter(Boolean).join(" ");
}

export async function createEntranceControlReference(sourceImage, entrance) {
  if (!entrance) return null;
  const image = sharp(sourceImage, { limitInputPixels: 80_000_000 }).rotate().toColorspace("srgb");
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) return null;
  const left = Math.round(entrance.bounds.left * metadata.width);
  const top = Math.round(entrance.bounds.top * metadata.height);
  const width = Math.max(4, Math.round((entrance.bounds.right - entrance.bounds.left) * metadata.width));
  const height = Math.max(4, Math.round((entrance.bounds.bottom - entrance.bounds.top) * metadata.height));
  const stroke = Math.max(4, Math.round(Math.min(metadata.width, metadata.height) * 0.006));
  const overlay = Buffer.from(`<svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg"><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="none" stroke="#00E5FF" stroke-width="${stroke}"/></svg>`);
  return image.composite([{ input: overlay }]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
