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
  const reportedSpanRatio = finiteUnit(observation.entranceGroupSpanRatio) ?? 0;
  const imageSpanRatio = bounds.right - bounds.left;
  return Object.freeze({
    type: String(observation.entranceGroupType || "other"),
    bounds: Object.freeze(bounds),
    reportedSpanRatio,
    imageSpanRatio,
    spanRatio: Math.max(reportedSpanRatio, imageSpanRatio),
    confidence: finiteUnit(observation.entranceGroupConfidence) ?? 0,
    description: String(observation.entranceGroupDescription || "").trim().slice(0, 240),
  });
}

export function entranceGroupPromptInstruction(entrance) {
  if (!entrance) return "";
  const imagePercent = Math.round(entrance.imageSpanRatio * 100);
  const reportedPercent = Math.round(entrance.reportedSpanRatio * 100);
  return [
    "ENTRANCE GROUP GEOMETRY LOCK — non-negotiable:",
    entrance.description || "An existing entrance platform and stair are visible in the source.",
    imagePercent ? `The protected rectangle spans approximately ${imagePercent}% of the source-image width.` : "",
    reportedPercent && Math.abs(reportedPercent - imagePercent) <= 10
      ? `The visual preflight estimated approximately ${reportedPercent}% of the facade.`
      : "Trust the protected rectangle and source pixels if a textual width estimate conflicts with them.",
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
