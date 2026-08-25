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

test("active tariff repository reads the effective public catalog", { skip: !enabled }, async () => {
  try {
    const plans = await new TariffPlanRepository().listActive();
    assert.deepEqual(
      plans.map(({ code, priceMinor, credits }) => ({ code, priceMinor, credits })),
      [
        { code: "FREE", priceMinor: 0, credits: 1 },
        { code: "TOPUP_1", priceMinor: 24900, credits: 1 },
        { code: "TOPUP_2", priceMinor: 49800, credits: 2 },
        { code: "TOPUP_3", priceMinor: 74700, credits: 3 },
        { code: "START", priceMinor: 79000, credits: 4 },
        { code: "OPTIMUM", priceMinor: 129000, credits: 8 },
        { code: "MAXIMUM", priceMinor: 349000, credits: 25 },
      ],
    );
  } finally {
    await closeDatabase();
  }
});
