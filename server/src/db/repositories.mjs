import { eq } from "drizzle-orm";
import { getDatabase } from "./client.mjs";
import { projects, tariffPlans } from "./schema.mjs";

export class ProjectRepository {
  constructor(database = getDatabase()) {
    this.database = database;
  }

  async create(input) {
    const [project] = await this.database.insert(projects).values(input).returning();
    return project;
  }

  async findById(id) {
    const [project] = await this.database.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project ?? null;
  }

  async findByLegacyOrderId(legacyOrderId) {
    const [project] = await this.database.select().from(projects)
      .where(eq(projects.legacyOrderId, legacyOrderId)).limit(1);
    return project ?? null;
  }
}

export class TariffPlanRepository {
  constructor(database = getDatabase()) {
    this.database = database;
  }

  async listActive() {
    return this.database.select().from(tariffPlans).where(eq(tariffPlans.isActive, true));
  }
}
