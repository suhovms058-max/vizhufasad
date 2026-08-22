import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  hasReliableHeifDecoder, MAX_INPUT_PIXELS, MAX_UPLOAD_BYTES, MIN_HEIGHT, MIN_WIDTH,
  RECOMMENDED_HEIGHT, RECOMMENDED_WIDTH,
} from "./config.mjs";

const heifBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export class ImageValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (heifBrands.has(brand)) return brand.startsWith("hei") ? "image/heic" : "image/heif";
  }
  throw new ImageValidationError("UNSUPPORTED_OR_MISMATCHED_IMAGE");
}

export async function processSourceImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) throw new ImageValidationError("INVALID_IMAGE");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new ImageValidationError("IMAGE_TOO_LARGE");
  const detectedMimeType = detectImageMime(buffer);
  if (
    (detectedMimeType === "image/heic" || detectedMimeType === "image/heif")
    && !hasReliableHeifDecoder()
  ) {
    throw new ImageValidationError("HEIF_DECODER_UNAVAILABLE");
  }

  try {
    const input = sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      pages: 1,
      unlimited: false,
    });
    const metadata = await input.metadata();
    const expectedFormat = detectedMimeType === "image/jpeg"
      ? "jpeg"
      : detectedMimeType === "image/heic" || detectedMimeType === "image/heif" ? "heif" : detectedMimeType.slice(6);
    if (metadata.format !== expectedFormat) throw new ImageValidationError("MIME_DECODER_MISMATCH");

    const base = input.autoOrient().toColorspace("srgb").flatten({ background: "#ffffff" });
    const source = await base.clone().jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const longSide = Math.max(source.info.width, source.info.height);
    const shortSide = Math.min(source.info.width, source.info.height);
    if (longSide < MIN_WIDTH || shortSide < MIN_HEIGHT) {
      throw new ImageValidationError("IMAGE_TOO_SMALL");
    }
    const working = await base.clone()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await base.clone()
      .resize({ width: 480, height: 360, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return {
      detectedMimeType,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      width: source.info.width,
      height: source.info.height,
      recommendedSize: longSide >= RECOMMENDED_WIDTH && shortSide >= RECOMMENDED_HEIGHT,
      source: source.data,
      working: working.data,
      thumbnail: thumbnail.data,
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    if (/pixel limit|exceeds pixel limit|Input image exceeds/iu.test(String(error?.message))) {
      throw new ImageValidationError("PIXEL_LIMIT_EXCEEDED");
    }
    throw new ImageValidationError("IMAGE_DECODE_FAILED");
  }
}
