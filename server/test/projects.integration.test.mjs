import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import {
  ensurePrivateBucket, getPrivateObjectBuffer, headPrivateObject,
} from "../src/infra/storage.mjs";
import * as storage from "../src/infra/storage.mjs";
import { loadProjectConfig } from "../src/projects/config.mjs";
import { ProjectRepository } from "../src/projects/repository.mjs";
import { ProjectError, ProjectService } from "../src/projects/service.mjs";

const enabled = [
  "DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET",
].every((name) => process.env[name]);

test("project ownership, direct upload, sanitization, cleanup and deletion work", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new ProjectRepository(pool);
  const automaticAssessmentCalls = [];
  const service = new ProjectService({
    repository,
    storage,
    config: loadProjectConfig(),
    assessmentService: {
      async assess(input) {
        automaticAssessmentCalls.push(input);
        return { status: "completed", decision: "accepted" };
      },
    },
  });
  const userA = randomUUID();
  const userB = randomUUID();
  const projectIds = [];

  try {
    await ensurePrivateBucket();
    await pool.query(
      `insert into users (id, email, status) values ($1, $2, 'active'), ($3, $4, 'active')`,
      [userA, `owner-${userA}@example.test`, userB, `other-${userB}@example.test`],
    );
    const project = await service.create(userA, "Дом у леса");
    projectIds.push(project.id);
    await assert.rejects(
      service.open(userB, project.id),
      (error) => error instanceof ProjectError && error.code === "PROJECT_NOT_FOUND",
    );

    const photo = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#c8b59a" },
    }).withExif({ IFD0: { Artist: "private metadata" } }).jpeg().toBuffer();
    const intent = await service.createUploadIntent(userA, project.id, {
      filename: "facade.jpg",
      mimeType: "image/jpeg",
      byteSize: photo.length,
    });
    const upload = await fetch(intent.upload.url, {
      method: "PUT",
      headers: { ...intent.upload.headers, "Content-Length": String(photo.length) },
      body: photo,
    });
    assert.ok(upload.ok, `presigned upload returned ${upload.status}`);

    const ready = await service.completeUpload(userA, project.id, intent.image.id);
    assert.equal(ready.status, "ready");
    assert.equal(ready.width, 1200);
    assert.equal(ready.height, 800);
    assert.equal(ready.recommended_size, true);
    assert.equal(ready.assessment.decision, "accepted");
    assert.equal(automaticAssessmentCalls[0].sourceImageId, ready.id);
    assert.equal((await service.open(userA, project.id)).status, "photo_ready");
    await assert.rejects(
      service.imageUrl(userB, project.id, ready.id, "source"),
      (error) => error instanceof ProjectError && error.code === "IMAGE_NOT_FOUND",
    );

    const source = await getPrivateObjectBuffer(ready.storage_key, 25 * 1024 * 1024);
    const sourceMetadata = await sharp(source).metadata();
    assert.equal(sourceMetadata.exif, undefined);
    assert.equal(sourceMetadata.space, "srgb");
    assert.equal((await headPrivateObject(ready.thumbnail_storage_key)).contentType, "image/webp");

    const mismatchProject = await service.create(userA, "Проверка MIME");
    projectIds.push(mismatchProject.id);
    const png = await sharp(photo).png().toBuffer();
    const mismatchIntent = await service.createUploadIntent(userA, mismatchProject.id, {
      filename: "pretends-to-be-jpeg.jpg",
      mimeType: "image/jpeg",
      byteSize: png.length,
    });
    const mismatchUpload = await fetch(mismatchIntent.upload.url, {
      method: "PUT",
      headers: { ...mismatchIntent.upload.headers, "Content-Length": String(png.length) },
      body: png,
    });
    assert.ok(mismatchUpload.ok);
    await assert.rejects(
      service.completeUpload(userA, mismatchProject.id, mismatchIntent.image.id),
      (error) => error instanceof ProjectError && error.code === "MIME_DECODER_MISMATCH",
    );

    const staleProject = await service.create(userA, "Незавершённая загрузка");
    projectIds.push(staleProject.id);
    const staleIntent = await service.createUploadIntent(userA, staleProject.id, {
      filename: "stale.jpg",
      mimeType: "image/jpeg",
      byteSize: photo.length,
    });
    await pool.query(
      "update source_images set upload_expires_at = now() - interval '48 hours' where id = $1",
      [staleIntent.image.id],
    );
    const cleanup = await service.cleanup();
    assert.equal(cleanup.staleUploads, 1);
    const staleState = await pool.query("select status, invalid_reason from source_images where id = $1", [
      staleIntent.image.id,
    ]);
    assert.deepEqual(staleState.rows[0], { status: "invalid", invalid_reason: "UPLOAD_EXPIRED" });

    await service.remove(userA, project.id);
    const deleted = await pool.query("select status, deleted_at from projects where id = $1", [project.id]);
    assert.equal(deleted.rows[0].status, "deleted");
    assert.ok(deleted.rows[0].deleted_at);
    await assert.rejects(headPrivateObject(ready.storage_key));
  } finally {
    await pool.query("delete from projects where id = any($1::uuid[])", [projectIds]);
    await pool.query("delete from users where id = any($1::uuid[])", [[userA, userB]]);
    await closeDatabase();
  }
});
