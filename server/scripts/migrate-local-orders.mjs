import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getDatabase, closeDatabase } from "../src/db/client.mjs";
import { auditLogs, projects, sourceImages } from "../src/db/schema.mjs";
import { ProjectRepository } from "../src/db/repositories.mjs";
import { putPrivateObject } from "../src/infra/storage.mjs";

const apply = process.argv.includes("--apply");
const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const ordersDir = path.join(dataDir, "orders");
const photosDir = path.join(dataDir, "photos");
const legacyOrderIdPattern = /^VF-\d{8}-[A-F0-9]{8}$/;

async function listOrderFiles() {
  try {
    return (await readdir(ordersDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function resolveStoredPhoto(storedAs) {
  if (
    typeof storedAs !== "string"
    || storedAs.length === 0
    || storedAs === "."
    || storedAs === ".."
    || /[\\/]/.test(storedAs)
  ) {
    throw new Error("Legacy photo storedAs must be a filename without path segments");
  }
  return path.join(photosDir, storedAs);
}

function projectStatus(status) {
  const mapping = {
    photo_retake_required: "photo_retake_required",
    queued_for_generation: "generation_queued",
    queued_for_ai: "photo_validation_queued",
  };
  return mapping[status] || "photo_validation_queued";
}

let imported = 0;
let skipped = 0;
const files = await listOrderFiles();

if (!apply) {
  console.log(`Dry run: found ${files.length} local order files in ${ordersDir}`);
  console.log("No data changed. Re-run with --apply after reviewing DATABASE_URL and S3 settings.");
  process.exit(0);
}

const database = getDatabase();
const repository = new ProjectRepository(database);
try {
  for (const entry of files) {
    const order = JSON.parse(await readFile(path.join(ordersDir, entry.name), "utf8"));
    if (!legacyOrderIdPattern.test(order.id)) {
      throw new Error(`Invalid legacy order id in ${entry.name}`);
    }
    if (await repository.findByLegacyOrderId(order.id)) {
      skipped += 1;
      continue;
    }
    const photoPath = resolveStoredPhoto(order.photo?.storedAs);
    const body = await readFile(photoPath);
    const storageKey = `legacy/${order.id}/source/${order.photo.storedAs}`;
    const sha256 = createHash("sha256").update(body).digest("hex");
    const stored = await putPrivateObject({
      key: storageKey,
      body,
      contentType: order.photo.mimeType,
      metadata: { legacyOrderId: order.id },
    });
    await database.transaction(async (tx) => {
      const [project] = await tx.insert(projects).values({
        legacyOrderId: order.id,
        title: `Импорт ${order.id}`,
        status: projectStatus(order.status),
        facadeConfig: {
          packageName: order.packageName,
          wishes: order.customer?.wishes || "",
          legacyCustomer: { name: order.customer?.name, contact: order.customer?.contact },
        },
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt || order.createdAt),
      }).returning();
      await tx.insert(sourceImages).values({
        projectId: project.id,
        storageBucket: stored.bucket,
        storageKey: stored.key,
        originalFilename: order.photo.originalName,
        mimeType: order.photo.mimeType,
        byteSize: order.photo.size || body.length,
        width: order.quality?.width,
        height: order.quality?.height,
        sha256,
        status: order.quality?.accepted ? "validated" : "rejected",
        qualityAssessment: { quality: order.quality, aiAssessment: order.aiAssessment },
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt || order.createdAt),
      });
      await tx.insert(auditLogs).values({
        action: "legacy_order.imported",
        entityType: "project",
        entityId: project.id,
        details: { legacyOrderId: order.id, sourceFile: entry.name },
      });
    });
    imported += 1;
  }
  console.log(`Migration completed: imported=${imported}, skipped=${skipped}, source files preserved`);
} finally {
  await closeDatabase();
}
