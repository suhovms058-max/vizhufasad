import { GenerationError } from "../contract.mjs";

export class UnavailableGenerationProvider {
  constructor({ name = "cloudru-self-hosted", model = "unconfigured" } = {}) {
    this.name = name;
    this.model = model;
  }

  async generate() {
    throw new GenerationError("FALLBACK_PROVIDER_NOT_CONFIGURED", 503, {
      retryable: false,
    });
  }
}
