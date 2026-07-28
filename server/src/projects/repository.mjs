import { getPool } from "../db/client.mjs";

export class ProjectRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async create(userId, title) {
    const result = await this.pool.query(
      `insert into projects (user_id, title, status)
       values ($1, $2, 'draft') returning *`,
      [userId, title],
    );
    return result.rows[0];
  }

  async list(userId) {
    const result = await this.pool.query(
      `select p.*, image.id as image_id, image.thumbnail_storage_key,
        image.assessment_status, image.assessment_decision, image.assessment_user_result
       from projects p
       left join lateral (
         select i.id, i.thumbnail_storage_key, a.status as assessment_status,
           a.decision as assessment_decision, a.user_result as assessment_user_result
         from source_images i
         left join photo_assessments a on a.source_image_id = i.id
         where i.project_id = p.id and i.status = 'ready'
         order by i.created_at desc limit 1
       ) image on true
       where p.user_id = $1 and p.deleted_at is null
       order by p.updated_at desc`,
      [userId],
    );
    return result.rows;
  }

  async findOwned(userId, projectId) {
    const result = await this.pool.query(
      `select p.*, image.id as image_id, image.thumbnail_storage_key,
        image.assessment_status, image.assessment_decision, image.assessment_user_result,
        image.assessment_failure_code, image.assessment_retry_after
       from projects p
       left join lateral (
         select i.id, i.thumbnail_storage_key, a.status as assessment_status,
           a.decision as assessment_decision, a.user_result as assessment_user_result,
           a.failure_code as assessment_failure_code, a.retry_after as assessment_retry_after
         from source_images i
         left join photo_assessments a on a.source_image_id = i.id
         where i.project_id = p.id and i.status = 'ready'
         order by i.created_at desc limit 1
       ) image on true
       where p.id = $1 and p.user_id = $2 and p.deleted_at is null`,
      [projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async rename(userId, projectId, title) {
    const result = await this.pool.query(
      `update projects set title = $3, updated_at = now()
       where id = $1 and user_id = $2 and deleted_at is null returning *`,
      [projectId, userId, title],
    );
    return result.rows[0] ?? null;
  }

  async createImage(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const owned = await client.query(
        "select id from projects where id = $1 and user_id = $2 and deleted_at is null for update",
        [input.projectId, input.userId],
      );
      if (!owned.rowCount) {
        await client.query("rollback");
        return null;
      }
      const image = await client.query(
        `insert into source_images (
          id, project_id, storage_bucket, storage_key, original_filename,
          declared_mime_type, mime_type, byte_size, status, upload_expires_at
        ) values ($1, $2, $3, $4, $5, $6, $6, $7, 'uploading', $8)
        returning *`,
        [
          input.id, input.projectId, input.bucket, input.storageKey, input.originalFilename,
          input.declaredMimeType, input.byteSize, input.uploadExpiresAt,
        ],
      );
      await client.query(
        "update projects set status = 'photo_uploading', updated_at = now() where id = $1",
        [input.projectId],
      );
      await client.query("commit");
      return image.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findOwnedImage(userId, projectId, imageId) {
    const result = await this.pool.query(
      `select i.* from source_images i join projects p on p.id = i.project_id
       where i.id = $1 and i.project_id = $2 and p.user_id = $3
         and p.deleted_at is null and i.deleted_at is null`,
      [imageId, projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async markUploaded(imageId, byteSize) {
    await this.pool.query(
      `update source_images set status = 'uploaded', byte_size = $2, updated_at = now()
       where id = $1 and status = 'uploading'`,
      [imageId, byteSize],
    );
  }

  async markProcessing(imageId, projectId) {
    const result = await this.pool.query(
      `update source_images set status = 'processing', updated_at = now()
       where id = $1 and status in ('uploading', 'uploaded') returning id`,
      [imageId],
    );
    if (result.rowCount) {
      await this.pool.query(
        "update projects set status = 'photo_processing', updated_at = now() where id = $1",
        [projectId],
      );
    }
    return Boolean(result.rowCount);
  }

  async markInvalid(imageId, projectId, reason) {
    await this.pool.query(
      `update source_images set status = 'invalid', invalid_reason = $2,
        deleted_at = now(), updated_at = now()
       where id = $1 and status <> 'deleted'`,
      [imageId, reason],
    );
    await this.pool.query(
      `update projects set status = 'photo_retake_required', updated_at = now()
       where id = $1 and deleted_at is null`,
      [projectId],
    );
  }

  async markReady(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const previous = await client.query(
        `select storage_key, working_storage_key, thumbnail_storage_key
         from source_images where project_id = $1 and id <> $2
           and status = 'ready' for update`,
        [input.projectId, input.imageId],
      );
      await client.query(
        `update source_images set status = 'deleted', deleted_at = now(), updated_at = now()
         where project_id = $1 and id <> $2 and status = 'ready'`,
        [input.projectId, input.imageId],
      );
      const ready = await client.query(
        `update source_images set status = 'ready', storage_key = $2,
          working_storage_key = $3, thumbnail_storage_key = $4, mime_type = $5,
          byte_size = $6, width = $7, height = $8, sha256 = $9,
          recommended_size = $10, invalid_reason = null, processed_at = now(),
          upload_expires_at = null, updated_at = now()
         where id = $1 and status = 'processing' returning *`,
        [
          input.imageId, input.sourceKey, input.workingKey, input.thumbnailKey,
          input.detectedMimeType, input.byteSize, input.width, input.height,
          input.sha256, input.recommendedSize,
        ],
      );
      if (!ready.rowCount) throw new Error("IMAGE_STATE_CONFLICT");
      await client.query(
        "update projects set status = 'photo_ready', updated_at = now() where id = $1",
        [input.projectId],
      );
      await client.query("commit");
      return {
        image: ready.rows[0],
        previousKeys: previous.rows.flatMap((row) => [
          row.storage_key, row.working_storage_key, row.thumbnail_storage_key,
        ]).filter(Boolean),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async softDeleteProject(userId, projectId) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const project = await client.query(
        `update projects set status = 'deleted', deleted_at = now(), updated_at = now()
         where id = $1 and user_id = $2 and deleted_at is null returning *`,
        [projectId, userId],
      );
      if (!project.rowCount) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        `update source_images set status = 'deleted', deleted_at = now(), updated_at = now()
         where project_id = $1 and status <> 'deleted'`,
        [projectId],
      );
      const images = await client.query(
        `select storage_key, working_storage_key, thumbnail_storage_key
         from source_images where project_id = $1`,
        [projectId],
      );
      await client.query("commit");
      return {
        project: project.rows[0],
        keys: images.rows.flatMap((row) => [
          row.storage_key, row.working_storage_key, row.thumbnail_storage_key,
        ]).filter(Boolean),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findStaleImages(cutoff) {
    const result = await this.pool.query(
      `select i.id, i.project_id, i.storage_key, i.working_storage_key, i.thumbnail_storage_key
       from source_images i join projects p on p.id = i.project_id
       where i.status in ('uploading', 'uploaded', 'processing')
         and coalesce(i.upload_expires_at, i.updated_at) < $1
         and p.deleted_at is null`,
      [cutoff],
    );
    return result.rows;
  }

  async markStaleImageInvalid(imageId, projectId) {
    await this.markInvalid(imageId, projectId, "UPLOAD_EXPIRED");
  }

  async findExpiredDeletedProjects(cutoff) {
    const result = await this.pool.query(
      `select p.id, array_remove(array_agg(keys.key), null) as keys
       from projects p
       left join source_images i on i.project_id = p.id
       left join lateral unnest(array[i.storage_key, i.working_storage_key, i.thumbnail_storage_key]) keys(key)
         on true
       where p.deleted_at < $1 group by p.id`,
      [cutoff],
    );
    return result.rows;
  }

  async hardDeleteProject(projectId) {
    await this.pool.query("delete from projects where id = $1 and deleted_at is not null", [projectId]);
  }
}
