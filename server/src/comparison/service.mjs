import sharp from "sharp";
import { ComparisonError, normalizeComparisonGenerationIds } from "./contract.mjs";

export class ComparisonService {
  constructor({ repository, storage, signedUrlTtlSeconds = 300 }) {
    this.repository = repository;
    this.storage = storage;
    this.signedUrlTtlSeconds = signedUrlTtlSeconds;
  }

  async assertAccess(userId) {
    if (!await this.repository.hasAccess(userId)) throw new ComparisonError("COMPARISON_PLAN_REQUIRED", 403);
  }

  async access(userId) { return { allowed: await this.repository.hasAccess(userId), minimumPlan: "OPTIMUM" }; }

  async create(userId, projectId, value = {}) {
    await this.assertAccess(userId);
    const comparison = await this.repository.createOwned(
      userId, projectId, normalizeComparisonGenerationIds(value.generationIds),
    );
    if (!comparison) throw new ComparisonError("COMPARISON_RESULTS_NOT_FOUND", 404);
    return this.view(userId, projectId, comparison.id);
  }

  async view(userId, projectId, comparisonId) {
    await this.assertAccess(userId);
    const comparison = await this.repository.findOwned(userId, projectId, comparisonId);
    if (!comparison) throw new ComparisonError("COMPARISON_NOT_FOUND", 404);
    const items = await Promise.all(comparison.items.map(async ({ resultKey, ...item }) => ({
      ...item,
      imageUrl: await this.storage.createDownloadUrl(resultKey, this.signedUrlTtlSeconds),
    })));
    const { collage_bucket: _bucket, collage_key: collageKey, ...safe } = comparison;
    return {
      ...safe,
      items,
      collageUrl: collageKey
        ? await this.storage.createDownloadUrl(collageKey, this.signedUrlTtlSeconds)
        : null,
    };
  }

  async selectWinner(userId, projectId, comparisonId, generationId) {
    await this.assertAccess(userId);
    if (!await this.repository.selectWinnerOwned(userId, projectId, comparisonId, generationId)) {
      throw new ComparisonError("COMPARISON_RESULT_NOT_FOUND", 404);
    }
    return this.view(userId, projectId, comparisonId);
  }

  async favorite(userId, projectId, comparisonId, generationId, favorite) {
    await this.assertAccess(userId);
    if (typeof favorite !== "boolean") throw new ComparisonError("INVALID_FAVORITE");
    if (!await this.repository.setFavoriteOwned(userId, projectId, comparisonId, generationId, favorite)) {
      throw new ComparisonError("COMPARISON_RESULT_NOT_FOUND", 404);
    }
    return this.view(userId, projectId, comparisonId);
  }

  async createCollage(userId, projectId, comparisonId) {
    await this.assertAccess(userId);
    const comparison = await this.repository.findOwned(userId, projectId, comparisonId);
    if (!comparison) throw new ComparisonError("COMPARISON_NOT_FOUND", 404);
    const cellWidth = 1200;
    const cellHeight = 800;
    const columns = 2;
    const rows = Math.ceil(comparison.items.length / columns);
    const layers = await Promise.all(comparison.items.map(async (item, index) => ({
      input: await sharp(await this.storage.getPrivateObjectBuffer(item.resultKey, 25 * 1024 * 1024))
        .rotate().resize(cellWidth, cellHeight, { fit: "contain", background: "#171817" })
        .jpeg({ quality: 92 }).toBuffer(),
      left: index % columns * cellWidth,
      top: Math.floor(index / columns) * cellHeight,
    })));
    const collage = await sharp({
      create: { width: columns * cellWidth, height: rows * cellHeight, channels: 3, background: "#171817" },
    }).composite(layers).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    const key = `users/${userId}/projects/${projectId}/comparisons/${comparisonId}/collage.jpg`;
    await this.storage.putPrivateObject({
      key, body: collage, contentType: "image/jpeg",
      metadata: { comparisonId, itemCount: String(comparison.items.length) },
    });
    await this.repository.setCollageOwned(
      userId, projectId, comparisonId, this.storage.getStorageBucket(), key, "image/jpeg",
    );
    return this.view(userId, projectId, comparisonId);
  }
}
