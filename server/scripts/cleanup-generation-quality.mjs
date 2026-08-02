import "dotenv/config";
import { closeDatabase } from "../src/db/client.mjs";
import { GenerationQualityRepository } from "../src/generation-quality/repository.mjs";
import * as storage from "../src/infra/storage.mjs";

const repository = new GenerationQualityRepository();
let removed = 0;
try {
  while (true) {
    const expired = await repository.findExpiredDiagnostics(new Date(), 100);
    if (!expired.length) break;
    for (const assessment of expired) {
      await storage.deletePrivateObject(assessment.diagnostic_key);
      await repository.clearDiagnostic(assessment.id);
      removed += 1;
    }
    if (expired.length < 100) break;
  }
  console.log(JSON.stringify({ removed, completedAt: new Date().toISOString() }));
} finally {
  await closeDatabase();
}
