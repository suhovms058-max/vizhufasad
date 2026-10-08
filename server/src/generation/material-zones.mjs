import sharp from "sharp";

function pathForStroke(stroke, width, height) {
  return stroke.map((point, index) => {
    const x = Math.round(point.x * width * 10) / 10;
    const y = Math.round(point.y * height * 10) / 10;
    return `${index === 0 ? "M" : "L"}${x} ${y}`;
  }).join(" ");
}

export function materialZonePromptInstruction(zones = []) {
  if (!zones.length) return "";
  const legend = zones.map((zone, index) => (
    `zone ${index + 1}, ${zone.color}: ${zone.material}`
  )).join("; ");
  return [
    "CLIENT MATERIAL ZONE MAP — binding spatial instruction:",
    `IMAGE 2 is an annotated copy of the source. Its translucent numbered polygons mean: ${legend}.`,
    "Apply each named finish to the complete real architectural surface inside its polygon. Align the finish boundary with the nearest existing facade edge, external corner, plinth line, entrance volume, projection, recess or aligned bay; the client is selecting a surface, not painting a decorative patch.",
    "Keep every requested zone connected and intentional. Do not move a material to another part of the house, split it into random patches, or extend it across an unrelated opening or volume.",
    "Do not reproduce the colored contours, fills, numbers or annotations in the result. Outside marked zones, complete the facade coherently with the dominant selected material while preserving all protected geometry.",
    "The client zone map takes priority over automatic material allocation whenever the two conflict.",
  ].join(" ");
}

export async function createFacadeControlReference(sourceImage, zones = [], entrance = null) {
  if (!zones.length && !entrance) return null;
  const image = sharp(sourceImage, { limitInputPixels: 80_000_000 }).rotate().toColorspace("srgb");
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) return null;
  const width = metadata.width;
  const height = metadata.height;
  const minimum = Math.min(width, height);
  const elements = [];

  zones.forEach((zone, index) => {
    for (const polygon of zone.polygons || []) {
      if (polygon.length < 3) continue;
      const points = polygon.map((point) => `${Math.round(point.x * width)},${Math.round(point.y * height)}`).join(" ");
      elements.push(`<polygon points="${points}" fill="${zone.color}" fill-opacity="0.28" stroke="${zone.color}" stroke-opacity="0.95" stroke-width="${Math.max(4, Math.round(minimum * 0.005))}" stroke-linejoin="miter"/>`);
    }
    const strokeWidth = Math.max(8, Math.round(Number(zone.brushSize || 0.045) * minimum));
    for (const stroke of zone.strokes || []) {
      if (!stroke.length) continue;
      if (stroke.length === 1) {
        elements.push(`<circle cx="${Math.round(stroke[0].x * width)}" cy="${Math.round(stroke[0].y * height)}" r="${Math.round(strokeWidth / 2)}" fill="${zone.color}" fill-opacity="0.58"/>`);
      } else {
        elements.push(`<path d="${pathForStroke(stroke, width, height)}" fill="none" stroke="${zone.color}" stroke-opacity="0.58" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
    }
    const first = zone.polygons?.[0]?.[0] || zone.strokes?.[0]?.[0];
    if (first) {
      const radius = Math.max(12, Math.round(minimum * 0.018));
      const fontSize = Math.max(14, Math.round(minimum * 0.021));
      elements.push(`<circle cx="${Math.round(first.x * width)}" cy="${Math.round(first.y * height)}" r="${radius}" fill="${zone.color}" stroke="#FFFFFF" stroke-width="2"/><text x="${Math.round(first.x * width)}" y="${Math.round(first.y * height + fontSize * 0.35)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFFFFF">${index + 1}</text>`);
    }
  });

  if (entrance) {
    const left = Math.round(entrance.bounds.left * width);
    const top = Math.round(entrance.bounds.top * height);
    const boxWidth = Math.max(4, Math.round((entrance.bounds.right - entrance.bounds.left) * width));
    const boxHeight = Math.max(4, Math.round((entrance.bounds.bottom - entrance.bounds.top) * height));
    const strokeWidth = Math.max(4, Math.round(minimum * 0.006));
    elements.push(`<rect x="${left}" y="${top}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="#00E5FF" stroke-width="${strokeWidth}"/>`);
  }

  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${elements.join("")}</svg>`);
  return image.composite([{ input: overlay }]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
