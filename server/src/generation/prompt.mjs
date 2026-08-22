import { GENERATION_PROMPT_VERSION } from "./contract.mjs";

const modeInstructions = {
  gentle: "Use a restrained design language and finish the existing envelope without changing its architecture.",
  balanced: "Use a noticeable but buildable facade composition while preserving every protected structural element.",
  conceptual: "Use a more expressive facade composition, but still preserve every protected structural element.",
};

const preserveLabels = {
  geometry: "building geometry and footprint",
  floors: "number of storeys",
  noNewFloors: "the prohibition on adding new storeys",
  roof: "roof shape, pitch, outline and position",
  windows: "all window count, size, shape and position",
  doors: "all door count, size, shape and position",
  balconies: "all existing balconies and their geometry",
  terraces: "all existing terraces and their geometry",
  plot: "the visible plot, paths, vegetation and terrain",
  perspective: "camera viewpoint, perspective and crop",
  housePosition: "house position and scale within the frame",
};

const editScopeLabels = {
  full_facade: "the visible facade finish only",
  walls: "the wall finish surfaces only",
  plinth: "the existing plinth/base surfaces only",
  roof: "the visible roof finish only, without changing its outline, pitch or structure",
  entrance: "the existing entrance group surfaces only",
  custom_mask: "only the white editable pixels in the second supplied mask image",
};

export function composeGenerationPrompt(input, { qualityRetryReasons = [], edit = null } = {}) {
  const protectedItems = Object.entries(input.preserve)
    .filter(([, enabled]) => enabled)
    .map(([key]) => preserveLabels[key]);
  const allowedItems = Object.entries(input.preserve)
    .filter(([, enabled]) => !enabled)
    .map(([key]) => preserveLabels[key]);
  const prompt = [
    edit
      ? "TASK: Edit the supplied already-completed facade visualization of the exact same real house. Return a photorealistic corrected version of that same image, not a redesign of the entire house."
      : "TASK: Edit the supplied photograph of the exact same real house. Show the house as a fully completed, photorealistic exterior facade concept, not as an unfinished shell with merely painted walls and not as a different house.",
    edit
      ? `EDIT BOUNDARY: Change ${editScopeLabels[edit.scope]}. Client command: ${edit.command}. Everything outside this boundary must remain visually identical to the supplied result. The second image, when supplied, is a black-and-white mask: white pixels may change and black pixels are protected.`
      : "",
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
    input.preserve.noNewFloors
      ? "Never add a new storey, even when other facade changes are allowed."
      : "A storey change is allowed only when the client also disabled preservation of the storey count.",
    "Do not change any protected floor, window, door, roof, terrace, balcony, extension, structural post or canopy. Safety railings on already-existing geometry are the only permitted automatically inferred addition. Do not add people, vehicles, text, logos, watermarks or construction drawings.",
    qualityRetryReasons.length
      ? `AUTOMATIC QUALITY RETRY: The previous candidate was rejected for: ${qualityRetryReasons.join(", ")}. Correct those failures. Increase source-image fidelity and preserve all protected contours, openings, roof lines, storeys, viewpoint and house position. This is the single automatic retry; do not trade structural fidelity for style.`
      : "",
    input.negativeConstraints.length
      ? `Additional forbidden changes: ${input.negativeConstraints.join("; ")}.`
      : "",
  ].filter(Boolean).join("\n");
  return { prompt, version: GENERATION_PROMPT_VERSION };
}
