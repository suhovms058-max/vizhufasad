import sharp from "sharp";

const ANALYSIS_WIDTH = 256;
const ANALYSIS_HEIGHT = 192;
const EDGE_THRESHOLD = 24;

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

async function luminance(buffer) {
  const { data } = await sharp(buffer, { limitInputPixels: 80_000_000 })
    .rotate()
    .resize(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function edgeMap(pixels) {
  const edges = new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  for (let y = 1; y < ANALYSIS_HEIGHT - 1; y += 1) {
    for (let x = 1; x < ANALYSIS_WIDTH - 1; x += 1) {
      const index = y * ANALYSIS_WIDTH + x;
      const horizontal = Math.abs(pixels[index + 1] - pixels[index - 1]);
      const vertical = Math.abs(pixels[index + ANALYSIS_WIDTH] - pixels[index - ANALYSIS_WIDTH]);
      edges[index] = horizontal + vertical >= EDGE_THRESHOLD ? 1 : 0;
    }
  }
  return edges;
}

function bounds(zone = {}) {
  return {
    left: Math.floor((zone.left ?? 0) * ANALYSIS_WIDTH),
    right: Math.ceil((zone.right ?? 1) * ANALYSIS_WIDTH),
    top: Math.floor((zone.top ?? 0) * ANALYSIS_HEIGHT),
    bottom: Math.ceil((zone.bottom ?? 1) * ANALYSIS_HEIGHT),
  };
}

function hasNearbyEdge(edges, x, y, radius = 2) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= ANALYSIS_HEIGHT) continue;
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= ANALYSIS_WIDTH) continue;
      if (edges[targetY * ANALYSIS_WIDTH + targetX]) return true;
    }
  }
  return false;
}

function tolerantEdgeScore(source, candidate, zone) {
  const area = bounds(zone);
  let sourceCount = 0;
  let candidateCount = 0;
  let sourceMatches = 0;
  let candidateMatches = 0;
  for (let y = area.top; y < area.bottom; y += 1) {
    for (let x = area.left; x < area.right; x += 1) {
      const index = y * ANALYSIS_WIDTH + x;
      if (source[index]) {
        sourceCount += 1;
        if (hasNearbyEdge(candidate, x, y)) sourceMatches += 1;
      }
      if (candidate[index]) {
        candidateCount += 1;
        if (hasNearbyEdge(source, x, y)) candidateMatches += 1;
      }
    }
  }
  if (!sourceCount && !candidateCount) return 1;
  const recall = sourceCount ? sourceMatches / sourceCount : 0;
  const precision = candidateCount ? candidateMatches / candidateCount : 0;
  return clamp((recall + precision) / 2);
}

function segmentedEdgeScore(source, candidate, zone, columns = 4, rows = 2) {
  const scores = [];
  const width = zone.right - zone.left;
  const height = zone.bottom - zone.top;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      scores.push(tolerantEdgeScore(source, candidate, {
        left: zone.left + width * column / columns,
        right: zone.left + width * (column + 1) / columns,
        top: zone.top + height * row / rows,
        bottom: zone.top + height * (row + 1) / rows,
      }));
    }
  }
  scores.sort((left, right) => left - right);
  const sensitiveCount = Math.max(1, Math.ceil(scores.length / 3));
  return scores.slice(0, sensitiveCount)
    .reduce((sum, score) => sum + score, 0) / sensitiveCount;
}

function edgeDensity(edges, zone) {
  const area = bounds(zone);
  let count = 0;
  let pixels = 0;
  for (let y = area.top; y < area.bottom; y += 1) {
    for (let x = area.left; x < area.right; x += 1) {
      count += edges[y * ANALYSIS_WIDTH + x];
      pixels += 1;
    }
  }
  return pixels ? count / pixels : 0;
}

function spatialLayoutScore(source, candidate) {
  const cells = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const zone = {
        left: column / 4, right: (column + 1) / 4,
        top: row / 4, bottom: (row + 1) / 4,
      };
      const delta = Math.abs(edgeDensity(source, zone) - edgeDensity(candidate, zone));
      cells.push(clamp(1 - delta / 0.16));
    }
  }
  return cells.reduce((sum, score) => sum + score, 0) / cells.length;
}

const protectedZoneDefinitions = Object.freeze({
  geometry: { left: 0.08, right: 0.92, top: 0.08, bottom: 0.96 },
  floors: { left: 0.1, right: 0.9, top: 0.28, bottom: 0.9 },
  roof: { left: 0.08, right: 0.92, top: 0.05, bottom: 0.48 },
  windows: { left: 0.08, right: 0.92, top: 0.3, bottom: 0.8 },
  doors: { left: 0.08, right: 0.92, top: 0.48, bottom: 0.96 },
  perspective: { left: 0, right: 1, top: 0, bottom: 1 },
  position: { left: 0.04, right: 0.96, top: 0.04, bottom: 0.98 },
  balconiesTerraces: { left: 0.06, right: 0.94, top: 0.28, bottom: 0.92 },
});

export async function analyzeStructuralSimilarity(sourceImage, candidateImage, {
  allowedChanges = {},
} = {}) {
  const [sourcePixels, candidatePixels] = await Promise.all([
    luminance(sourceImage), luminance(candidateImage),
  ]);
  const sourceEdges = edgeMap(sourcePixels);
  const candidateEdges = edgeMap(candidatePixels);
  const zones = {};
  for (const [name, zone] of Object.entries(protectedZoneDefinitions)) {
    if (allowedChanges[name] === true) continue;
    const segmented = ["roof", "windows", "doors", "balconiesTerraces"].includes(name);
    zones[name] = Math.round((segmented
      ? segmentedEdgeScore(sourceEdges, candidateEdges, zone, 4, name === "roof" ? 1 : 2)
      : tolerantEdgeScore(sourceEdges, candidateEdges, zone)) * 10_000);
  }
  const zoneValues = Object.values(zones);
  const sourceDensity = edgeDensity(sourceEdges, {});
  const candidateDensity = edgeDensity(candidateEdges, {});
  return Object.freeze({
    version: "structural-evidence-v1",
    method: "tolerant-edge-contours-and-spatial-zones",
    contours: Math.round(tolerantEdgeScore(sourceEdges, candidateEdges, {}) * 10_000),
    spatialLayout: Math.round(spatialLayoutScore(sourceEdges, candidateEdges) * 10_000),
    protectedZones: zoneValues.length
      ? Math.round(zoneValues.reduce((sum, score) => sum + score, 0) / zoneValues.length)
      : 10_000,
    zones,
    edgeDensityDelta: Math.round(Math.abs(sourceDensity - candidateDensity) * 10_000),
  });
}
