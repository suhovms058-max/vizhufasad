import "dotenv/config";
import { loadGenerationConfig } from "./src/generation/config.mjs";
import { loadGenerationQualityConfig } from "./src/generation-quality/config.mjs";
import { GenerationQualityOrchestrator } from "./src/generation-quality/orchestrator.mjs";
import { createGenerationQualityProviders } from "./src/generation-quality/providers.mjs";
import { GenerationQualityRepository } from "./src/generation-quality/repository.mjs";
import { GenerationMetrics } from "./src/generation/metrics.mjs";
import { GenerationProcessor } from "./src/generation/processor.mjs";
import { createGenerationProviders } from "./src/generation/providers-factory.mjs";
import { createGenerationQueue } from "./src/generation/queue.mjs";
import { GenerationRepository } from "./src/generation/repository.mjs";
import { createGenerationWorker } from "./src/generation/worker.mjs";
import { closeDatabase } from "./src/db/client.mjs";
import * as storage from "./src/infra/storage.mjs";
import { WalletRepository } from "./src/wallet/repository.mjs";
import { WalletService } from "./src/wallet/service.mjs";
import { loadWalletConfig } from "./src/wallet/config.mjs";

const required = [
  "DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY", "S3_BUCKET",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

const config = loadGenerationConfig();
const qualityConfig = loadGenerationQualityConfig();
if (!config.enabled) throw new Error("FEATURE_STANDARD_GENERATION_ENABLED must be true");
const repository = new GenerationRepository();
const qualityRepository = new GenerationQualityRepository();
const queue = createGenerationQueue(config);
const walletService = new WalletService({
  repository: new WalletRepository(),
  config: loadWalletConfig(),
});
const processor = new GenerationProcessor({
  repository,
  qualityRepository,
  qualityOrchestrator: new GenerationQualityOrchestrator({
    providers: createGenerationQualityProviders(qualityConfig),
    config: qualityConfig,
  }),
  storage,
  walletService,
  providers: createGenerationProviders(config),
  config,
  qualityConfig,
});
const metrics = new GenerationMetrics({ repository, queue, qualityRepository });
const runtime = createGenerationWorker({
  config, processor, repository, queue, metrics,
});
await runtime.runWatchdog();
console.log("VIZHUFASAD generation worker started", {
  queue: config.queueName,
  concurrency: config.workerConcurrency,
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log("Generation worker graceful shutdown", { signal });
  const forced = setTimeout(() => process.exit(1), config.timeoutMs + 15_000);
  forced.unref?.();
  await runtime.close();
  await queue.close();
  await closeDatabase();
  clearTimeout(forced);
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM").catch(() => process.exit(1)));
process.once("SIGINT", () => shutdown("SIGINT").catch(() => process.exit(1)));
