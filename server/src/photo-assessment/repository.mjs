import { getPool } from "../db/client.mjs";

export class PhotoAssessmentRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async start({ sourceImageId, projectId, promptVersion, schemaVersion }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const image = await client.query(
        `select i.id from source_images i join projects p on p.id = i.project_id
         where i.id = $1 and i.project_id = $2 and i.status = 'ready'
           and i.deleted_at is null and p.deleted_at is null for update`,
        [sourceImageId, projectId],
      );
      if (!image.rowCount) {
        await client.query("rollback");
        return null;
      }
      const assessment = await client.query(
        `insert into photo_assessments (
          source_image_id, status, prompt_version, schema_version, started_at
        ) values ($1, 'processing', $2, $3, now())
        on conflict (source_image_id) do update set
          status = 'processing', decision = null, technical_result = null,
          user_result = null, provider = null, model = null,
          prompt_version = excluded.prompt_version, schema_version = excluded.schema_version,
          failure_code = null, started_at = now(), finished_at = null,
          retry_after = null, updated_at = now()
        where photo_assessments.status <> 'processing'
        returning *`,
        [sourceImageId, promptVersion, schemaVersion],
      );
      if (!assessment.rowCount) {
        await client.query("rollback");
        return { conflict: true };
      }
      await client.query(
        "update projects set status = 'photo_validation_queued', updated_at = now() where id = $1",
        [projectId],
      );
      await client.query("commit");
      return assessment.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async attemptStarted(assessmentId, attempt) {
    await this.pool.query(
      `insert into photo_assessment_attempts (
        assessment_id, attempt_number, status, provider, model, started_at
       ) values ($1, $2, 'started', $3, $4, $5)`,
      [
        assessmentId, attempt.attemptNumber, attempt.provider,
        attempt.model, attempt.startedAt,
      ],
    );
  }

  async attemptFinished(assessmentId, attempt) {
    await this.pool.query(
      `update photo_assessment_attempts set status = $3, provider_request_id = $4,
         error_code = $5, finished_at = $6
       where assessment_id = $1 and attempt_number = $2`,
      [
        assessmentId, attempt.attemptNumber, attempt.status,
        attempt.requestId || null, attempt.errorCode || null, attempt.finishedAt,
      ],
    );
  }

  async complete({ assessmentId, projectId, result, attemptCount }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const assessment = await client.query(
        `update photo_assessments set status = 'completed', decision = $2,
          technical_result = $3, user_result = $4, provider = $5, model = $6,
          attempt_count = $7, failure_code = null, retry_after = null,
          finished_at = now(), updated_at = now()
         where id = $1 and status = 'processing' returning *`,
        [
          assessmentId, result.decision, result.technicalResult, result.userResult,
          result.provider, result.model, attemptCount,
        ],
      );
      if (!assessment.rowCount) throw new Error("PHOTO_ASSESSMENT_STATE_CONFLICT");
      const projectStatus = result.decision === "retake_required"
        ? "photo_retake_required"
        : "configuration_required";
      await client.query(
        "update projects set status = $2, updated_at = now() where id = $1 and deleted_at is null",
        [projectId, projectStatus],
      );
      await client.query("commit");
      return assessment.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async fail({ assessmentId, projectId, attemptCount, failureCode, retryAfter }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const assessment = await client.query(
        `update photo_assessments set status = 'provider_unavailable',
          attempt_count = $2, failure_code = $3, retry_after = $4,
          finished_at = now(), updated_at = now()
         where id = $1 and status = 'processing' returning *`,
        [assessmentId, attemptCount, failureCode, retryAfter],
      );
      await client.query(
        "update projects set status = 'photo_validation_queued', updated_at = now() where id = $1",
        [projectId],
      );
      await client.query("commit");
      return assessment.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findOwnedImage(userId, projectId, imageId) {
    const result = await this.pool.query(
      `select i.*, a.id as assessment_id, a.status as assessment_status,
        a.decision as assessment_decision, a.technical_result, a.user_result,
        a.provider as assessment_provider, a.model as assessment_model,
        a.prompt_version, a.schema_version, a.failure_code, a.retry_after
       from source_images i
       join projects p on p.id = i.project_id
       left join photo_assessments a on a.source_image_id = i.id
       where i.id = $1 and i.project_id = $2 and p.user_id = $3
         and i.status = 'ready' and i.deleted_at is null and p.deleted_at is null`,
      [imageId, projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async findOwnedAssessment(userId, projectId, imageId) {
    const image = await this.findOwnedImage(userId, projectId, imageId);
    if (!image?.assessment_id) return null;
    return {
      id: image.assessment_id,
      status: image.assessment_status,
      decision: image.assessment_decision,
      technical_result: image.technical_result,
      user_result: image.user_result,
      provider: image.assessment_provider,
      model: image.assessment_model,
      prompt_version: image.prompt_version,
      schema_version: image.schema_version,
      failure_code: image.failure_code,
      retry_after: image.retry_after,
    };
  }
}
