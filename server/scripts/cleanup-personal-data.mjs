import "dotenv/config";
import { AuthRepository } from "../src/auth/repository.mjs";
import { closeDatabase } from "../src/db/client.mjs";
import * as storage from "../src/infra/storage.mjs";
import {
  AccountDeletionProcessor, PersonalDataRetentionRepository,
} from "../src/legal/retention.mjs";
import { ProjectRepository } from "../src/projects/repository.mjs";

try {
  const retention = await new PersonalDataRetentionRepository().cleanup();
  const deletions = await new AccountDeletionProcessor({
    authRepository: new AuthRepository(),
    projectRepository: new ProjectRepository(),
    storage,
  }).run();
  console.log(JSON.stringify({ ok: true, retention, deletions }));
} finally {
  await closeDatabase();
}
