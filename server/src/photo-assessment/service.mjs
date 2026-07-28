import { MAX_UPLOAD_BYTES } from "../projects/config.mjs";
import {
  PHOTO_ASSESSMENT_PROMPT_VERSION,
} from "./prompt.mjs";
import {
  PHOTO_ASSESSMENT_SCHEMA_VERSION,
} from "./schema.mjs";
import { analyzeTechnicalPhoto } from "./technical.mjs";
import { PhotoAssessmentUnavailableError } from "./orchestrator.mjs";

export class PhotoAssessmentServiceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class PhotoAssessmentService {
  constructor({
    repository,
    orchestrator,
    storage,
    technicalAnalyzer = analyzeTechnicalPhoto,
    clock = () => new Date(),
  }) {
    this.repository = repository;
    this.orchestrator = orchestrator;
    this.storage = storage;
    this.technicalAnalyzer = technicalAnalyzer;
    this.clock = clock;
  }

  async assess({ sourceImageId, projectId, image }) {
    const started = await this.repository.start({
      sourceImageId,
      projectId,
      promptVersion: PHOTO_ASSESSMENT_PROMPT_VERSION,
      schemaVersion: PHOTO_ASSESSMENT_SCHEMA_VERSION,
    });
    if (!started) throw new PhotoAssessmentServiceError("READY_IMAGE_NOT_FOUND", 404);
    if (started.conflict) throw new PhotoAssessmentServiceError("PHOTO_ASSESSMENT_IN_PROGRESS", 409);
    const attemptOffset = Number(started.attempt_count || 0);
    const recorder = {
      started: (attempt) => this.repository.attemptStarted(started.id, {
        ...attempt,
        attemptNumber: attemptOffset + attempt.attemptNumber,
      }),
      finished: (attempt) => this.repository.attemptFinished(started.id, {
        ...attempt,
        attemptNumber: attemptOffset + attempt.attemptNumber,
      }),
    };

    try {
      const technical = await this.technicalAnalyzer(image);
      const result = await this.orchestrator.assess({ image, technical, recorder });
      return this.repository.complete({
        assessmentId: started.id,
        projectId,
        result,
        attemptCount: attemptOffset + result.attempts.length,
      });
    } catch (error) {
      const attempts = error instanceof PhotoAssessmentUnavailableError ? error.attempts.length : 0;
      return this.repository.fail({
        assessmentId: started.id,
        projectId,
        attemptCount: attemptOffset + attempts,
        failureCode: error instanceof PhotoAssessmentUnavailableError
          ? error.code
          : "PHOTO_ASSESSMENT_INTERNAL_ERROR",
        retryAfter: new Date(this.clock().getTime() + 5 * 60 * 1000),
      });
    }
  }

  async retryOwned(userId, projectId, imageId) {
    const image = await this.repository.findOwnedImage(userId, projectId, imageId);
    if (!image) throw new PhotoAssessmentServiceError("READY_IMAGE_NOT_FOUND", 404);
    if (image.assessment_status === "processing") {
      throw new PhotoAssessmentServiceError("PHOTO_ASSESSMENT_IN_PROGRESS", 409);
    }
    const buffer = await this.storage.getPrivateObjectBuffer(
      image.working_storage_key,
      MAX_UPLOAD_BYTES,
    );
    return this.assess({ sourceImageId: image.id, projectId, image: buffer });
  }

  async getOwned(userId, projectId, imageId) {
    const assessment = await this.repository.findOwnedAssessment(userId, projectId, imageId);
    if (!assessment) throw new PhotoAssessmentServiceError("PHOTO_ASSESSMENT_NOT_FOUND", 404);
    return assessment;
  }
}
