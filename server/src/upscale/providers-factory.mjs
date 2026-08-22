import { assertUpscaleProvider } from "./contract.mjs";
import { GenApiUpscaleProvider } from "./providers/genapi.mjs";

export function createUpscaleProvider(config) {
  if (!config.enabled) return null;
  if (config.provider !== "genapi") throw new Error("UPSCALE_PROVIDER_UNSUPPORTED");
  return assertUpscaleProvider(new GenApiUpscaleProvider({
    apiKey: config.apiKey,
    model: config.model,
    endpoint: config.endpoint,
    factor: config.factor,
    estimatedCostMinor: config.estimatedCostMinor,
    currency: config.currency,
    pollIntervalMs: config.pollIntervalMs,
    resultMaxBytes: config.resultMaxBytes,
  }));
}
