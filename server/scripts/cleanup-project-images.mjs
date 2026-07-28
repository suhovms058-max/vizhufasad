import "dotenv/config";
import { closeDatabase } from "../src/db/client.mjs";
import { ensurePrivateBucket } from "../src/infra/storage.mjs";
import * as storage from "../src/infra/storage.mjs";
import { loadProjectConfig } from "../src/projects/config.mjs";
import { ProjectRepository } from "../src/projects/repository.mjs";
import { ProjectService } from "../src/projects/service.mjs";

try {
  await ensurePrivateBucket();
  const service = new ProjectService({
    repository: new ProjectRepository(),
    storage,
    config: loadProjectConfig(),
  });
  const result = await service.cleanup();
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await closeDatabase();
}
