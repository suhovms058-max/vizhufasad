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
      candidateNumbers: config.retryModel ? [1] : [1, 2],
    }));
    if (config.retryModel) {
      providers.push(new GenApiGenerationProvider({
        apiKey: config.apiKey,
        model: config.retryModel,
        endpoint: config.endpoint,
        estimatedCostMinor: config.retryEstimatedCostMinor,
        currency: config.currency,
        pollIntervalMs: config.pollIntervalMs,
        resultMaxBytes: config.resultMaxBytes,
        generationKinds: ["standard"],
        candidateNumbers: [2],
      }));
    }
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
  if (config.editorEnabled && config.provider === "genapi") {
    providers.push(new GenApiGenerationProvider({
      apiKey: config.apiKey,
      model: config.editModel,
      endpoint: config.endpoint,
      estimatedCostMinor: config.editEstimatedCostMinor,
      currency: config.currency,
      pollIntervalMs: config.pollIntervalMs,
      resultMaxBytes: config.resultMaxBytes,
      generationKinds: ["edit"],
      editScopes: ["full_facade", "walls", "plinth", "roof", "entrance"],
    }));
    providers.push(new GenApiGenerationProvider({
      apiKey: config.apiKey,
      model: config.maskEditModel,
      endpoint: config.endpoint,
      estimatedCostMinor: config.maskEditEstimatedCostMinor,
      currency: config.currency,
      pollIntervalMs: config.pollIntervalMs,
      resultMaxBytes: config.resultMaxBytes,
      generationKinds: ["edit"],
      editScopes: ["custom_mask"],
    }));
  }
  if ((config.enabled || config.proEnabled) && config.fallbackProvider === "cloudru-self-hosted") {
    const fallback = new UnavailableGenerationProvider();
    fallback.generationKinds = [
      ...(config.enabled ? ["standard"] : []),
      ...(config.proEnabled ? ["pro"] : []),
      ...(config.editorEnabled ? ["edit"] : []),
    ];
    providers.push(fallback);
  }
  return providers;
}
