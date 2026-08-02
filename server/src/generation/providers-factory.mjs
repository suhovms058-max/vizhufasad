import { GenApiGenerationProvider } from "./providers/genapi.mjs";
import { UnavailableGenerationProvider } from "./providers/fallback.mjs";

export function createGenerationProviders(config) {
  const providers = [];
  if (config.enabled && config.provider === "genapi") {
    providers.push(new GenApiGenerationProvider({
      apiKey: config.apiKey,
      model: config.model,
      endpoint: config.endpoint,
      estimatedCostMinor: config.estimatedCostMinor,
      currency: config.currency,
      pollIntervalMs: config.pollIntervalMs,
      resultMaxBytes: config.resultMaxBytes,
    }));
  }
  if (config.enabled && config.fallbackProvider === "cloudru-self-hosted") {
    providers.push(new UnavailableGenerationProvider());
  }
  return providers;
}
