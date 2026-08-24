import Ajv from "ajv";
import {
  assertGenerationQualityProvider, GenerationQualityError,
  qualityDecisionForAttempt, VLM_QUALITY_RESULT_SCHEMA,
} from "./contract.mjs";
import { composeGenerationQualityPrompt } from "./prompt.mjs";
import { analyzeStructuralSimilarity } from "./structural.mjs";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function basisPoints(value) {
  return Math.max(0, Math.min(10_000, Math.round(Number(value) * 10_000)));
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 10_000;
}

function evaluate({ observation, structural, allowedChanges, thresholds, assessmentNumber }) {
  const vlm = Object.fromEntries(
    Object.entries(observation)
      .filter(([, value]) => typeof value === "number")
      .map(([name, value]) => [name, basisPoints(value)]),
  );
  const protectedNames = [
    "floors", "roof", "windows", "doors", "balconiesTerraces", "position", "perspective",
  ].filter((name) => allowedChanges[name] !== true);
  const protectedVlm = average(protectedNames.map((name) => vlm[name]));
  const overallScore = Math.round(
    vlm.sameHouse * 0.18
    + protectedVlm * 0.24
    + structural.contours * 0.14
    + structural.spatialLayout * 0.1
    + structural.protectedZones * 0.12
    + vlm.artifacts * 0.12
    + vlm.style * 0.1,
  );
  const failures = [];
  if (vlm.sameHouse < thresholds.sameHouse) failures.push("same_house_below_threshold");
  for (const name of protectedNames) {
    if (vlm[name] < thresholds.protectedElement) failures.push(`${name}_below_threshold`);
  }
  if (structural.contours < thresholds.contours) failures.push("contours_below_threshold");
  // Material seams, timber slats and landscaping legitimately change local
  // edge density. A low layout-density score is therefore blocking only when
  // another structural signal independently confirms the change.
  if (structural.spatialLayout < thresholds.spatialLayout && (
    structural.contours < thresholds.contours
    || structural.protectedZones < thresholds.protectedZones
  )) failures.push("spatial_layout_below_threshold");
  if (structural.protectedZones < thresholds.protectedZones) failures.push("protected_zones_below_threshold");
  if (vlm.artifacts < thresholds.artifacts) failures.push("artifacts_below_threshold");
  if (vlm.style < thresholds.style) failures.push("style_below_threshold");
  if (overallScore < thresholds.overall) failures.push("overall_below_threshold");
  return {
    decision: qualityDecisionForAttempt(failures.length === 0, assessmentNumber),
    overallScore,
    scoreBreakdown: { ...vlm, ...structural, protectedVlm },
    failureReasons: [...new Set(failures)],
  };
}

export class GenerationQualityOrchestrator {
  constructor({ providers, config, structuralAnalyzer = analyzeStructuralSimilarity, wait = delay }) {
    this.providers = providers;
    this.config = config;
    this.structuralAnalyzer = structuralAnalyzer;
    this.wait = wait;
    const ajv = new Ajv({ allErrors: true, strict: true });
    this.validate = ajv.compile(VLM_QUALITY_RESULT_SCHEMA);
  }

  async assess({ sourceImage, candidateImage, input, allowedChanges, assessmentNumber }) {
    const structural = await this.structuralAnalyzer(sourceImage, candidateImage, { allowedChanges });
    const qualityPrompt = composeGenerationQualityPrompt({ input, allowedChanges });
    const route = [];
    if (this.config.primary !== "none") route.push({ name: this.config.primary, attempts: this.config.primaryAttempts });
    if (this.config.fallback !== "none") route.push({ name: this.config.fallback, attempts: 1 });
    const attempts = [];
    for (const target of route) {
      const provider = this.providers[target.name];
      if (!provider) continue;
      assertGenerationQualityProvider(provider);
      for (let number = 1; number <= target.attempts; number += 1) {
        const timeout = AbortSignal.timeout(this.config.timeoutMs);
        try {
          const result = await provider.compare({
            sourceImage, candidateImage, prompt: qualityPrompt.prompt, signal: timeout,
          });
          if (!this.validate(result.observation)) {
            throw new GenerationQualityError("QUALITY_PROVIDER_SCHEMA_INVALID", { retryable: true });
          }
          const evaluated = evaluate({
            observation: result.observation,
            structural,
            allowedChanges,
            thresholds: this.config.thresholds,
            assessmentNumber,
          });
          return {
            ...evaluated,
            schemaVersion: "generation-quality-assessment-v1",
            promptVersion: qualityPrompt.version,
            policyVersion: "facade-quality-policy-v1",
            provider: provider.name,
            model: provider.model,
            providerRequestId: result.requestId,
            vlmResult: result.observation,
            structuralResult: structural,
            providerAttempts: [...attempts, { provider: provider.name, status: "succeeded" }],
          };
        } catch (caught) {
          const error = caught instanceof GenerationQualityError
            ? caught
            : new GenerationQualityError("QUALITY_PROVIDER_UNEXPECTED_ERROR", { retryable: true });
          attempts.push({ provider: provider.name, status: "failed", code: error.code });
          if (!error.retryable || number === target.attempts) break;
          if (this.config.retryDelayMs) await this.wait(this.config.retryDelayMs);
        }
      }
    }
    throw new GenerationQualityError("GENERATION_QUALITY_UNAVAILABLE", {
      retryable: true,
      details: attempts,
    });
  }
}
