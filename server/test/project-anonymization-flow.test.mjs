import assert from "node:assert/strict";
import test from "node:test";
import { ProjectError, ProjectService } from "../src/projects/service.mjs";

test("suspected document is fail-closed before storage, assessment or generation", async () => {
  const calls = [];
  const repository = {
    async findOwnedImage() {
      return {
        id: "image-1", project_id: "project-1", status: "uploading",
        storage_key: "quarantine/upload", byte_size: 32, declared_mime_type: "image/jpeg",
      };
    },
    async markUploaded() { calls.push("uploaded"); },
    async markProcessing() { calls.push("processing"); return true; },
    async markInvalid(_imageId, _projectId, reason) { calls.push(["invalid", reason]); },
  };
  const storage = {
    async headPrivateObject() { return { contentLength: 32 }; },
    async getPrivateObjectBuffer() { return Buffer.alloc(32, 1); },
    async putPrivateObject() { calls.push("stored"); },
    async deletePrivateObject() {},
    async deletePrivateObjects() {},
  };
  const service = new ProjectService({
    repository,
    storage,
    config: {},
    processor: async () => ({
      detectedMimeType: "image/jpeg", source: Buffer.alloc(32, 2), working: Buffer.alloc(32, 3),
      thumbnail: Buffer.alloc(32, 4), width: 1200, height: 800, sha256: "source", recommendedSize: true,
    }),
    anonymizer: { async anonymize() { throw Object.assign(new Error(), { code: "PHOTO_ANONYMIZATION_DOCUMENT_SUSPECTED" }); } },
    assessmentService: { async assess() { calls.push("assessment"); } },
  });
  await assert.rejects(
    service.completeUpload("user-1", "project-1", "image-1"),
    (error) => error instanceof ProjectError
      && error.code === "PHOTO_ANONYMIZATION_DOCUMENT_SUSPECTED"
      && error.status === 422,
  );
  assert.equal(calls.includes("stored"), false);
  assert.equal(calls.includes("assessment"), false);
  assert.deepEqual(calls.at(-1), ["invalid", "PHOTO_ANONYMIZATION_DOCUMENT_SUSPECTED"]);
});
