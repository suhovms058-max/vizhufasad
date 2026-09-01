export class AdminService {
  constructor({ repository, storage, previewTtlSeconds = 300 }) {
    this.repository = repository;
    this.storage = storage;
    this.previewTtlSeconds = previewTtlSeconds;
  }

  async dashboard(requestedPage = 1) {
    const pageSize = 50;
    const page = Math.max(1, Number.parseInt(requestedPage, 10) || 1);
    const data = await this.repository.dashboard({ limit: pageSize, offset: (page - 1) * pageSize });
    return {
      ...data,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(Number(data.stats.total || 0) / pageSize)),
      generations: await Promise.all(data.generations.map(async (generation) => {
        if (!generation.result_key || generation.status !== "completed") return { ...generation, resultUrl: null };
        try {
          return {
            ...generation,
            resultUrl: await this.storage.createDownloadUrl(generation.result_key, this.previewTtlSeconds),
          };
        } catch {
          return { ...generation, resultUrl: null };
        }
      })),
    };
  }
}
