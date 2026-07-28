import sharp from "sharp";

export async function analyzeTechnicalPhoto(buffer) {
  const image = sharp(buffer, { failOn: "error", pages: 1 });
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const colorChannels = stats.channels.slice(0, 3);
  const luminance = colorChannels.length
    ? colorChannels.reduce((sum, channel) => sum + channel.mean, 0) / colorChannels.length
    : 0;
  const entropy = Number(stats.entropy.toFixed(4));
  const sharpness = Number(stats.sharpness.toFixed(4));
  const warnings = [];
  const blocking = [];

  if (longSide < 640 || shortSide < 420) blocking.push("resolution_below_minimum");
  else if (longSide < 1200 || shortSide < 800) warnings.push("resolution_below_recommended");
  if (luminance < 20) blocking.push("extreme_underexposure");
  else if (luminance < 55) warnings.push("low_light");
  if (luminance > 250) blocking.push("extreme_overexposure");
  else if (luminance > 230) warnings.push("bright_exposure");
  if (sharpness < 0.5 && entropy < 1.5) blocking.push("extreme_blur_or_no_detail");
  else if (sharpness < 1.6 || entropy < 2.5) warnings.push("low_detail");

  return {
    width,
    height,
    format: metadata.format,
    entropy,
    sharpness,
    luminance: Number(luminance.toFixed(2)),
    recommendedResolution: longSide >= 1200 && shortSide >= 800,
    warnings,
    blocking,
  };
}
