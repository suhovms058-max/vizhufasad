export class GenerationMetrics {
  constructor({ repository, queue }) {
    this.repository = repository;
    this.queue = queue;
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
    const [queue, database] = await Promise.all([
      this.queue.counts(),
      this.repository.queueMetrics(),
    ]);
    return {
      queue,
      database,
      workerProcess: { ...this.counters },
      measuredAt: new Date().toISOString(),
    };
  }
}
