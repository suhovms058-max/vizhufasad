import assert from "node:assert/strict";
import test from "node:test";
import { PHOTO_PROCESSING_CONSENT_VERSION } from "../src/legal/photo-consent.mjs";
import { ProjectError, ProjectService } from "../src/projects/service.mjs";

function setup() {
  const createdImages = [];
  const repository = {
    async findOwned() {
      return { id: "project-1", user_id: "user-1", facade_config: {}, geometry_policy: {} };
    },
    async createImage(input) {
      createdImages.push(input);
      return input;
    },
    async markInvalid() {},
  };
  const storage = {
    getStorageBucket: () => "private-source-images",
    createUploadUrl: async () => ({ url: "https://storage.example.test/upload", headers: {} }),
  };
  const now = new Date("2026-08-22T10:00:00.000Z");
  const service = new ProjectService({
    repository,
    storage,
    config: { uploadTtlSeconds: 900 },
    clock: () => now,
  });
  return { service, createdImages, now };
}

const uploadInput = {
  filename: "facade.jpg",
  mimeType: "image/jpeg",
  byteSize: 1024,
};

test("photo upload intent requires the current standalone consent", async () => {
  const { service, createdImages } = setup();
  await assert.rejects(
    service.createUploadIntent("user-1", "project-1", uploadInput),
    (error) => error instanceof ProjectError
      && error.code === "PHOTO_PROCESSING_CONSENT_REQUIRED"
      && error.status === 422,
  );
  await assert.rejects(
    service.createUploadIntent("user-1", "project-1", {
      ...uploadInput,
      consent: { accepted: true, version: "outdated" },
    }),
    (error) => error instanceof ProjectError && error.code === "PHOTO_PROCESSING_CONSENT_REQUIRED",
  );
  assert.equal(createdImages.length, 0);
});

test("photo upload intent records consent version and time", async () => {
  const { service, createdImages, now } = setup();
  await service.createUploadIntent("user-1", "project-1", {
    ...uploadInput,
    consent: { accepted: true, version: PHOTO_PROCESSING_CONSENT_VERSION },
  });
  assert.equal(createdImages.length, 1);
  assert.equal(createdImages[0].consentVersion, PHOTO_PROCESSING_CONSENT_VERSION);
  assert.equal(createdImages[0].consentedAt, now);
});
