import "dotenv/config";
import { loadGenerationConfig } from "./src/generation/config.mjs";
import { loadGenerationQualityConfig } from "./src/generation-quality/config.mjs";
import { GenerationQualityOrchestrator } from "./src/generation-quality/orchestrator.mjs";
import { createGenerationQualityProviders } from "./src/generation-quality/providers.mjs";
import { GenerationQualityRepository } from "./src/generation-quality/repository.mjs";
import { GenerationMetrics } from "./src/generation/metrics.mjs";
import { GenerationProcessor } from "./src/generation/processor.mjs";
import { FreeTrialRepository } from "./src/free-trial/repository.mjs";
import { FreeTrialService } from "./src/free-trial/service.mjs";
import { createGenerationProviders } from "./src/generation/providers-factory.mjs";
import { createGenerationQueue } from "./src/generation/queue.mjs";
import { GenerationRepository } from "./src/generation/repository.mjs";
import { createGenerationWorker } from "./src/generation/worker.mjs";
import { closeDatabase } from "./src/db/client.mjs";
import * as storage from "./src/infra/storage.mjs";
import { WalletRepository } from "./src/wallet/repository.mjs";
import { WalletService } from "./src/wallet/service.mjs";
import { loadWalletConfig } from "./src/wallet/config.mjs";
import { loadUpscaleConfig } from "./src/upscale/config.mjs";
import { UpscaleProcessor } from "./src/upscale/processor.mjs";
import { createUpscaleProvider } from "./src/upscale/providers-factory.mjs";
import { createUpscaleQueue } from "./src/upscale/queue.mjs";
import { UpscaleRepository } from "./src/upscale/repository.mjs";
import { createUpscaleWorker } from "./src/upscale/worker.mjs";

const required = [
  "DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY", "S3_BUCKET",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

const config = loadGenerationConfig();
const qualityConfig = loadGenerationQualityConfig();
const upscaleConfig = loadUpscaleConfig();
if (!config.enabled && !config.proEnabled && !config.editorEnabled) {
  throw new Error("At least one generation feature must be enabled");
}
const repository = new GenerationRepository();
const qualityRepository = new GenerationQualityRepository();
const queue = createGenerationQueue(config);
const walletConfig = loadWalletConfig();
const walletService = new WalletService({
  repository: new WalletRepository(),
  config: walletConfig,
});
const freeTrialService = new FreeTrialService({
  repository: new FreeTrialRepository(),
  walletService,
  freeBonusCredits: walletConfig.freeBonusCredits,
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
  freeTrialService,
});
const metrics = new GenerationMetrics({ repository, queue, qualityRepository });
const runtime = createGenerationWorker({
  config, processor, repository, queue, metrics,
});
const upscaleRepository = upscaleConfig.enabled ? new UpscaleRepository() : null;
const upscaleQueue = upscaleConfig.enabled ? createUpscaleQueue(upscaleConfig) : null;
const upscaleRuntime = upscaleConfig.enabled ? createUpscaleWorker({
  config: upscaleConfig,
  processor: new UpscaleProcessor({
    repository: upscaleRepository,
    provider: createUpscaleProvider(upscaleConfig),
    walletService,
    storage,
    config: upscaleConfig,
  }),
}) : null;
await runtime.runWatchdog();
console.log("VIZHUFASAD generation worker started", {
  queue: config.queueName,
  concurrency: config.workerConcurrency,
  upscaleQueue: upscaleRuntime ? upscaleConfig.queueName : "disabled",
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log("Generation worker graceful shutdown", { signal });
  const forced = setTimeout(() => process.exit(1), config.timeoutMs + 15_000);
  forced.unref?.();
  await runtime.close();
  await upscaleRuntime?.close();
  await queue.close();
  await upscaleQueue?.close();
  await closeDatabase();
  clearTimeout(forced);
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM").catch(() => process.exit(1)));
process.once("SIGINT", () => shutdown("SIGINT").catch(() => process.exit(1)));
