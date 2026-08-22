export class GenerationMetrics {
  constructor({ repository, queue, qualityRepository = null }) {
    this.repository = repository;
    this.queue = queue;
    this.qualityRepository = qualityRepository;
    this.counters = {
      completed: 0,
      failed: 0,
      stalled: 0,
      retries: 0,
    };
  }

  increment(name) {
    if (name in this.counters) this.counters[name] += 1;
  }

  async snapshot() {
    const [queue, database, quality] = await Promise.all([
      this.queue.counts(),
      this.repository.queueMetrics(),
      this.qualityRepository?.qualityMetrics() ?? null,
    ]);
    return {
      queue,
      database,
      quality,
      workerProcess: { ...this.counters },
      measuredAt: new Date().toISOString(),
    };
  }
}
