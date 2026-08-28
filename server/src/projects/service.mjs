import { randomUUID } from "node:crypto";
import { normalizeGenerationInput } from "../generation/contract.mjs";
import {
  isCurrentPhotoConsent, isCurrentPhotoRights, PHOTO_PROCESSING_CONSENT_HASH,
  PHOTO_PROCESSING_CONSENT_VERSION, PHOTO_USAGE_RIGHTS_HASH, PHOTO_USAGE_RIGHTS_VERSION,
} from "../legal/photo-consent.mjs";
import {
  allowedUploadMimeTypes, hasReliableHeifDecoder, HEIF_MIME_TYPES, MAX_UPLOAD_BYTES,
} from "./config.mjs";
import { ImageValidationError, processSourceImage } from "./image-processing.mjs";

export class ProjectError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function cleanTitle(value) {
  const title = String(value || "").trim().replace(/\s+/gu, " ");
  if (!title || title.length > 120) throw new ProjectError("INVALID_PROJECT_TITLE");
  return title;
}

function cleanFilename(value) {
  const filename = String(value || "").trim().replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 160);
  return filename || "facade-photo";
}

export class ProjectService {
  constructor({
    repository,
    storage,
    config,
    processor = processSourceImage,
    assessmentService,
    clock = () => new Date(),
  }) {
    this.repository = repository;
    this.storage = storage;
    this.config = config;
    this.processor = processor;
    this.assessmentService = assessmentService;
    this.clock = clock;
  }

  projectView(project) {
    const facadeConfig = project.facade_config && Object.keys(project.facade_config).length
      ? project.facade_config
      : null;
    return {
      ...project,
      configuration: facadeConfig
        ? { ...facadeConfig, preserve: project.geometry_policy || {} }
        : null,
      assessment: project.image_id && project.assessment_status
        ? {
          imageId: project.image_id,
          status: project.assessment_status,
          decision: project.assessment_decision,
          userResult: project.assessment_user_result,
          failureCode: project.assessment_failure_code,
          retryAfter: project.assessment_retry_after,
        }
        : null,
    };
  }

  async create(userId, title) {
    return this.repository.create(userId, cleanTitle(title));
  }

  async list(userId) {
    const projects = await this.repository.list(userId);
    return Promise.all(projects.map(async (project) => ({
      ...this.projectView(project),
      thumbnailUrl: project.thumbnail_storage_key
        ? await this.storage.createDownloadUrl(project.thumbnail_storage_key)
        : null,
    })));
  }

  async open(userId, projectId) {
    const project = await this.repository.findOwned(userId, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", 404);
    return {
      ...this.projectView(project),
      thumbnailUrl: project.thumbnail_storage_key
        ? await this.storage.createDownloadUrl(project.thumbnail_storage_key)
        : null,
    };
  }

  async rename(userId, projectId, title) {
    const project = await this.repository.rename(userId, projectId, cleanTitle(title));
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", 404);
    return project;
  }

  async saveConfiguration(userId, projectId, value) {
    const input = normalizeGenerationInput(value);
    const { preserve, ...facadeConfig } = input;
    const project = await this.repository.updateConfiguration(
      userId,
      projectId,
      facadeConfig,
      preserve,
    );
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", 404);
    return this.projectView(project);
  }

  async remove(userId, projectId) {
    const deleted = await this.repository.softDeleteProject(userId, projectId);
    if (!deleted) throw new ProjectError("PROJECT_NOT_FOUND", 404);
    await this.storage.deletePrivateObjects(deleted.keys).catch((error) => {
      console.error("Project object deletion deferred to retention cleanup", {
        projectId,
        error: error?.name || "STORAGE_DELETE_FAILED",
      });
    });
    return deleted.project;
  }

  async createUploadIntent(userId, projectId, input) {
    await this.open(userId, projectId);
    if (!isCurrentPhotoConsent(input.consent)) {
      throw new ProjectError("PHOTO_PROCESSING_CONSENT_REQUIRED", 422);
    }
    if (!isCurrentPhotoRights(input.rights)) {
      throw new ProjectError("PHOTO_USAGE_RIGHTS_REQUIRED", 422);
    }
    const declaredMimeType = String(input.mimeType || "").toLowerCase();
    if (!allowedUploadMimeTypes().includes(declaredMimeType)) {
      if (HEIF_MIME_TYPES.has(declaredMimeType) && !hasReliableHeifDecoder()) {
        throw new ProjectError("HEIF_CONVERSION_REQUIRED", 415);
      }
      throw new ProjectError("UNSUPPORTED_IMAGE_TYPE", 415);
    }
    const byteSize = Number(input.byteSize);
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) {
      throw new ProjectError("IMAGE_SIZE_LIMIT", 413);
    }
    const imageId = randomUUID();
    const uploadKey = `quarantine/${userId}/${projectId}/${imageId}/upload`;
    const uploadExpiresAt = new Date(this.clock().getTime() + this.config.uploadTtlSeconds * 1000);
    const image = await this.repository.createImage({
      id: imageId,
      userId,
      projectId,
      bucket: this.storage.getStorageBucket(),
      storageKey: uploadKey,
      originalFilename: cleanFilename(input.filename),
      declaredMimeType,
      byteSize,
      uploadExpiresAt,
      consentVersion: PHOTO_PROCESSING_CONSENT_VERSION,
      consentHash: PHOTO_PROCESSING_CONSENT_HASH,
      consentedAt: this.clock(),
      rightsVersion: PHOTO_USAGE_RIGHTS_VERSION,
      rightsHash: PHOTO_USAGE_RIGHTS_HASH,
      rightsConfirmedAt: this.clock(),
    });
    if (!image) throw new ProjectError("PROJECT_NOT_FOUND", 404);
    try {
      const upload = await this.storage.createUploadUrl({
        key: uploadKey,
        contentType: declaredMimeType,
        contentLength: byteSize,
        expiresIn: this.config.uploadTtlSeconds,
      });
      return { image, upload: { ...upload, headers: { "Content-Type": declaredMimeType } } };
    } catch (error) {
      await this.repository.markInvalid(imageId, projectId, "UPLOAD_URL_FAILED");
      throw error;
    }
  }

  async completeUpload(userId, projectId, imageId) {
    const image = await this.repository.findOwnedImage(userId, projectId, imageId);
    if (!image) throw new ProjectError("IMAGE_NOT_FOUND", 404);
    if (!["uploading", "uploaded"].includes(image.status)) {
      throw new ProjectError("IMAGE_STATE_CONFLICT", 409);
    }

    const generatedKeys = [];
    try {
      const object = await this.storage.headPrivateObject(image.storage_key);
      if (
        object.contentLength < 1
        || object.contentLength > MAX_UPLOAD_BYTES
        || object.contentLength !== Number(image.byte_size)
      ) {
        throw new ImageValidationError("IMAGE_SIZE_MISMATCH");
      }
      await this.repository.markUploaded(imageId, object.contentLength);
      if (!await this.repository.markProcessing(imageId, projectId)) {
        throw new ProjectError("IMAGE_STATE_CONFLICT", 409);
      }
      const buffer = await this.storage.getPrivateObjectBuffer(image.storage_key, MAX_UPLOAD_BYTES);
      const processed = await this.processor(buffer);
      const normalizedDeclaredMime = image.declared_mime_type === "image/jpg"
        ? "image/jpeg"
        : image.declared_mime_type;
      if (processed.detectedMimeType !== normalizedDeclaredMime) {
        throw new ImageValidationError("MIME_DECODER_MISMATCH");
      }
      const prefix = `users/${userId}/projects/${projectId}/images/${imageId}`;
      const sourceKey = `${prefix}/source.jpg`;
      const workingKey = `${prefix}/working.jpg`;
      const thumbnailKey = `${prefix}/thumbnail.webp`;
      generatedKeys.push(sourceKey, workingKey, thumbnailKey);
      await this.storage.putPrivateObject({
        key: sourceKey, body: processed.source, contentType: "image/jpeg",
        metadata: { imageId, variant: "source" },
      });
      await this.storage.putPrivateObject({
        key: workingKey, body: processed.working, contentType: "image/jpeg",
        metadata: { imageId, variant: "working" },
      });
      await this.storage.putPrivateObject({
        key: thumbnailKey, body: processed.thumbnail, contentType: "image/webp",
        metadata: { imageId, variant: "thumbnail" },
      });
      await this.storage.deletePrivateObject(image.storage_key);
      const ready = await this.repository.markReady({
        imageId, projectId, sourceKey, workingKey, thumbnailKey,
        detectedMimeType: processed.detectedMimeType,
        byteSize: processed.source.length,
        width: processed.width,
        height: processed.height,
        sha256: processed.sha256,
        recommendedSize: processed.recommendedSize,
      });
      await this.storage.deletePrivateObjects(ready.previousKeys).catch((error) => {
        console.error("Replaced image deletion deferred to project retention cleanup", {
          projectId,
          error: error?.name || "STORAGE_DELETE_FAILED",
        });
      });
      let assessment = null;
      if (this.assessmentService) {
        try {
          assessment = await this.assessmentService.assess({
            sourceImageId: imageId,
            projectId,
            image: processed.working,
          });
        } catch (error) {
          console.error("Automatic photo assessment failed without deleting the ready image", {
            projectId,
            imageId,
            error: error?.code || error?.name || "PHOTO_ASSESSMENT_FAILED",
          });
        }
      }
      return { ...ready.image, assessment };
    } catch (error) {
      await this.storage.deletePrivateObjects([image.storage_key, ...generatedKeys]).catch(() => {});
      const reason = error.code || error.message || "IMAGE_PROCESSING_FAILED";
      await this.repository.markInvalid(imageId, projectId, String(reason).slice(0, 80));
      if (error instanceof ProjectError) throw error;
      throw new ProjectError(reason, reason === "IMAGE_SIZE_MISMATCH" ? 413 : 422);
    }
  }

  async imageUrl(userId, projectId, imageId, variant) {
    const image = await this.repository.findOwnedImage(userId, projectId, imageId);
    if (!image || image.status !== "ready") throw new ProjectError("IMAGE_NOT_FOUND", 404);
    const key = variant === "thumbnail"
      ? image.thumbnail_storage_key
      : variant === "working" ? image.working_storage_key : image.storage_key;
    if (!key) throw new ProjectError("IMAGE_VARIANT_NOT_FOUND", 404);
    return this.storage.createDownloadUrl(key);
  }

  async getAssessment(userId, projectId, imageId) {
    if (!this.assessmentService) throw new ProjectError("PHOTO_ASSESSMENT_DISABLED", 503);
    try {
      return await this.assessmentService.getOwned(userId, projectId, imageId);
    } catch (error) {
      if (error?.status) throw new ProjectError(error.code, error.status);
      throw error;
    }
  }

  async retryAssessment(userId, projectId, imageId) {
    if (!this.assessmentService) throw new ProjectError("PHOTO_ASSESSMENT_DISABLED", 503);
    try {
      return await this.assessmentService.retryOwned(userId, projectId, imageId);
    } catch (error) {
      if (error?.status) throw new ProjectError(error.code, error.status);
      throw error;
    }
  }

  async cleanup() {
    const staleCutoff = new Date(this.clock().getTime() - this.config.unfinishedHours * 60 * 60 * 1000);
    const stale = await this.repository.findStaleImages(staleCutoff);
    for (const image of stale) {
      await this.storage.deletePrivateObjects([
        image.storage_key, image.working_storage_key, image.thumbnail_storage_key,
      ]);
      await this.repository.markStaleImageInvalid(image.id, image.project_id);
    }
    const deletionCutoff = new Date(
      this.clock().getTime() - this.config.deletedRetentionDays * 24 * 60 * 60 * 1000,
    );
    const expiredProjects = await this.repository.findExpiredDeletedProjects(deletionCutoff);
    for (const project of expiredProjects) {
      await this.storage.deletePrivateObjects(project.keys || []);
      await this.repository.hardDeleteProject(project.id);
    }
    return { staleUploads: stale.length, deletedProjects: expiredProjects.length };
  }
}
