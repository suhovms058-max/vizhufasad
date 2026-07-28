import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, getDatabase } from "../src/db/client.mjs";
import { ProjectRepository, TariffPlanRepository } from "../src/db/repositories.mjs";
import { projects } from "../src/db/schema.mjs";
import { eq } from "drizzle-orm";

const enabled = Boolean(process.env.DATABASE_URL);

test("project repository persists and reads a project", { skip: !enabled }, async (context) => {
  const database = getDatabase();
  const repository = new ProjectRepository(database);
  const legacyOrderId = `TEST-${crypto.randomUUID()}`;
  const created = await repository.create({ title: "Repository test", legacyOrderId });
  context.after(async () => {
    await database.delete(projects).where(eq(projects.id, created.id));
    await closeDatabase();
  });
  assert.equal((await repository.findById(created.id)).legacyOrderId, legacyOrderId);
  assert.equal((await repository.findByLegacyOrderId(legacyOrderId)).id, created.id);
});

test("seeded tariff plans remain inactive", { skip: !enabled }, async () => {
  try {
    assert.deepEqual(await new TariffPlanRepository().listActive(), []);
  } finally {
    await closeDatabase();
  }
});
