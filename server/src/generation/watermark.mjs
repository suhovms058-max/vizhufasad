import sharp from "sharp";

function watermarkSvg(width, height) {
  const size = Math.max(24, Math.round(Math.min(width, height) / 22));
  const rows = [];
  for (let y = -height; y < height * 2; y += size * 4) {
    rows.push(`<text x="${-width / 3}" y="${y}" font-size="${size}">ВИЖУФАСАД · КОНЦЕПЦИЯ</text>`);
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-28 ${width / 2} ${height / 2})" fill="white" fill-opacity="0.28"
      font-family="Arial, sans-serif" font-weight="700" letter-spacing="2">${rows.join("")}</g>
  </svg>`);
}

export async function createFreeWatermark(buffer) {
  const image = sharp(buffer, { limitInputPixels: 80_000_000 }).rotate().toColorspace("srgb");
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("WATERMARK_IMAGE_INVALID");
  return image
    .composite([{ input: watermarkSvg(metadata.width, metadata.height), blend: "over" }])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
