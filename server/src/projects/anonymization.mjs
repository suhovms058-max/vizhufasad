import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { MAX_UPLOAD_BYTES } from "./config.mjs";

const defaultScript = fileURLToPath(new URL("../../python/anonymize_image.py", import.meta.url));

export async function computePerceptualHash(buffer) {
  const { data, info } = await sharp(buffer, { failOn: "error" })
    .rotate()
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 9 || info.height !== 8 || info.channels !== 1 || data.length !== 72) {
    throw new ImageAnonymizationError("PHOTO_PERCEPTUAL_HASH_FAILED");
  }
  let bits = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits = (bits << 1n) | (data[row * 9 + column] > data[row * 9 + column + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export class ImageAnonymizationError extends Error {
  constructor(code, details = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export function loadAnonymizationConfig(environment = process.env) {
  const enabled = String(environment.PHOTO_ANONYMIZATION_ENABLED || "false").toLowerCase() === "true";
  const timeoutMs = Number(environment.PHOTO_ANONYMIZATION_TIMEOUT_MS || 30_000);
  const concurrency = Number(environment.PHOTO_ANONYMIZATION_CONCURRENCY || 1);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
    throw new Error("PHOTO_ANONYMIZATION_TIMEOUT_MS must be between 5000 and 120000");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("PHOTO_ANONYMIZATION_CONCURRENCY must be between 1 and 4");
  }
  return {
    enabled,
    timeoutMs,
    concurrency,
    pythonBin: environment.PHOTO_ANONYMIZATION_PYTHON_BIN || "python3",
    scriptPath: environment.PHOTO_ANONYMIZATION_SCRIPT_PATH || defaultScript,
    faceModelPath: environment.PHOTO_ANONYMIZATION_FACE_MODEL_PATH || "",
    textModelPath: environment.PHOTO_ANONYMIZATION_TEXT_MODEL_PATH || "",
    plateModelPath: environment.PHOTO_ANONYMIZATION_PLATE_MODEL_PATH || "",
    plateYoloModelPath: environment.PHOTO_ANONYMIZATION_PLATE_YOLO_MODEL_PATH || "",
  };
}

export class LocalImageAnonymizer {
  constructor(config = loadAnonymizationConfig()) {
    this.config = config;
    this.active = 0;
    this.waiters = [];
  }

  async acquire() {
    const concurrency = this.config.concurrency || 1;
    if (this.active < concurrency) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }

  async assertReady() {
    if (!this.config.enabled) throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_UNAVAILABLE");
    const required = [
      this.config.scriptPath, this.config.faceModelPath,
      this.config.textModelPath, this.config.plateModelPath, this.config.plateYoloModelPath,
    ];
    if (required.some((value) => !value)) {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_MODELS_MISSING");
    }
    try {
      await Promise.all(required.map((path) => access(path)));
    } catch {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_MODELS_MISSING");
    }
  }

  async anonymize(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.length > MAX_UPLOAD_BYTES) {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_INVALID_INPUT");
    }
    await this.acquire();
    try {
      return await this.anonymizeExclusive(buffer);
    } finally {
      this.release();
    }
  }

  async anonymizeExclusive(buffer) {
    await this.assertReady();
    const args = [
      this.config.scriptPath,
      "--face-model", this.config.faceModelPath,
      "--text-model", this.config.textModelPath,
      "--plate-model", this.config.plateModelPath,
      "--plate-yolo-model", this.config.plateYoloModelPath,
    ];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(this.config.pythonBin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      const output = [];
      const diagnostics = [];
      let outputBytes = 0;
      let diagnosticBytes = 0;
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new ImageAnonymizationError("PHOTO_ANONYMIZATION_TIMEOUT")));
      }, this.config.timeoutMs);
      child.stdout.on("data", (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_UPLOAD_BYTES) {
          child.kill("SIGKILL");
          finish(() => reject(new ImageAnonymizationError("PHOTO_ANONYMIZATION_OUTPUT_TOO_LARGE")));
          return;
        }
        output.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        diagnosticBytes += chunk.length;
        if (diagnosticBytes <= 64 * 1024) diagnostics.push(chunk);
      });
      child.once("error", () => finish(() => reject(new ImageAnonymizationError("PHOTO_ANONYMIZATION_PROCESS_FAILED"))));
      child.once("close", (code) => finish(() => resolve({
        code, buffer: Buffer.concat(output), stderr: Buffer.concat(diagnostics).toString("utf8"),
      })));
      child.stdin.once("error", () => {});
      child.stdin.end(buffer);
    });
    if (result.code !== 0) {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_DETECTOR_FAILED");
    }
    const reportLine = result.stderr.split(/\r?\n/u).find((line) => line.startsWith("ANONYMIZATION_REPORT="));
    let report;
    try {
      report = JSON.parse(reportLine?.slice("ANONYMIZATION_REPORT=".length) || "");
    } catch {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_INVALID_REPORT");
    }
    const requiredDetectors = ["face", "text", "plate"];
    if (!requiredDetectors.every((name) => report?.detectors?.[name] === "ok")) {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_INCOMPLETE");
    }
    if (report?.document?.suspected === true) {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_DOCUMENT_SUSPECTED", {
        textAreaRatio: report.document.textAreaRatio ?? null,
      });
    }
    try {
      const metadata = await sharp(result.buffer, { failOn: "error" }).metadata();
      if (metadata.format !== "jpeg" || metadata.exif || metadata.xmp || metadata.iptc) {
        throw new Error("invalid output");
      }
    } catch {
      throw new ImageAnonymizationError("PHOTO_ANONYMIZATION_INVALID_OUTPUT");
    }
    return { image: result.buffer, report };
  }
}
