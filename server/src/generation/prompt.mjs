import { GENERATION_PROMPT_VERSION } from "./contract.mjs";

const modeInstructions = {
  gentle: "Use a restrained design language and finish the existing envelope without changing its architecture.",
  balanced: "Use a noticeable but buildable facade composition while preserving every protected structural element.",
  conceptual: "Use a more expressive facade composition, but still preserve every protected structural element.",
};

const preserveLabels = {
  geometry: "building geometry and footprint",
  floors: "number of storeys",
  roof: "roof shape, pitch, outline and position",
  windows: "all window count, size, shape and position",
  doors: "all door count, size, shape and position",
  perspective: "camera viewpoint, perspective and crop",
  housePosition: "house position and scale within the frame",
};

export function composeGenerationPrompt(input, { qualityRetryReasons = [] } = {}) {
  const protectedItems = Object.entries(input.preserve)
    .filter(([, enabled]) => enabled)
    .map(([key]) => preserveLabels[key]);
  const allowedItems = Object.entries(input.preserve)
    .filter(([, enabled]) => !enabled)
    .map(([key]) => preserveLabels[key]);
  const prompt = [
    "TASK: Edit the supplied photograph of the exact same real house. Show the house as a fully completed, photorealistic exterior facade concept, not as an unfinished shell with merely painted walls and not as a different house.",
    modeInstructions[input.transformationLevel],
    "CLIENT BRIEF — apply these choices consistently to all suitable visible facade surfaces:",
    `Required facade style: ${input.style}.`,
    input.materials.length
      ? `Required finish materials: ${input.materials.join(", ")}. Show their real texture, scale, joints, edges and installation logic.`
      : "Choose physically plausible finish materials consistent with the required style.",
    input.palette.length
      ? `Required color palette: ${input.palette.join(", ")}. Keep material colors within this palette.`
      : "",
    input.wishes
      ? `Required client wishes: ${input.wishes}. Treat these wishes as part of the design brief unless they conflict with protected geometry.`
      : "",
    "COMPLETION STANDARD: Resolve the whole visible facade as a coherent finished object. Complete wall finishes; external corners and material transitions; cornice/eaves, fascia and soffit lining; the plinth/base; window and door reveals, sills and flashings; and the finish of every already-existing column, post or support. Add realistic gutters and downpipes only where they normally attach to the existing roof, without changing roof geometry. Preserve existing porch, canopy and support positions while giving their visible surfaces a finished material treatment.",
    "SAFETY COMPLETION: Inspect the existing architecture and automatically add realistic guardrails or handrails only where an already-existing accessible elevated platform, balcony opening, porch edge, exterior stair or dangerous level change would normally require fall protection. Match the required facade style, materials and palette. Do not invent a new balcony, terrace, platform, stair, opening or support in order to place a railing.",
    "Use believable construction thickness, seams, junctions, shadow gaps, caps and drainage details. No raw blockwork, exposed unfinished concrete, primer-only surfaces, floating cladding or flat paint-only treatment when the client selected finish materials.",
    protectedItems.length
      ? `STRICTLY PRESERVE: ${protectedItems.join("; ")}. These elements must remain pixel-position consistent with the source photograph.`
      : "",
    allowedItems.length
      ? `The user explicitly allows changes to: ${allowedItems.join("; ")}.`
      : "",
    "Keep the original environment, season, lighting direction and camera optics. The result is a facade visualization concept, not a construction drawing.",
    "Do not add or remove floors, windows, doors, roof volumes, terraces, balconies, extensions, structural posts or canopies. Safety railings on already-existing geometry are the only permitted automatically inferred addition. Do not move or resize openings. Do not add people, vehicles, text, logos, watermarks or construction drawings.",
    qualityRetryReasons.length
      ? `AUTOMATIC QUALITY RETRY: The previous candidate was rejected for: ${qualityRetryReasons.join(", ")}. Correct those failures. Increase source-image fidelity and preserve all protected contours, openings, roof lines, storeys, viewpoint and house position. This is the single automatic retry; do not trade structural fidelity for style.`
      : "",
    input.negativeConstraints.length
      ? `Additional forbidden changes: ${input.negativeConstraints.join("; ")}.`
      : "",
  ].filter(Boolean).join("\n");
  return { prompt, version: GENERATION_PROMPT_VERSION };
}
