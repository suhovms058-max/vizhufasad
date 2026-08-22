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
      generationKinds: ["standard"],
    }));
  }
  if (config.proEnabled && config.provider === "genapi") {
    providers.push(new GenApiGenerationProvider({
      apiKey: config.apiKey,
      model: config.proModel,
      endpoint: config.endpoint,
      estimatedCostMinor: config.proEstimatedCostMinor,
      currency: config.currency,
      pollIntervalMs: config.pollIntervalMs,
      resultMaxBytes: config.resultMaxBytes,
      generationKinds: ["pro"],
    }));
  }
  if ((config.enabled || config.proEnabled) && config.fallbackProvider === "cloudru-self-hosted") {
    const fallback = new UnavailableGenerationProvider();
    fallback.generationKinds = config.proEnabled ? ["standard", "pro"] : ["standard"];
    providers.push(fallback);
  }
  return providers;
}
