import { GENERATION_PROMPT_VERSION } from "./contract.mjs";

const modeInstructions = {
  gentle: "Use a restrained design language while preserving the exact architecture. Gentle means restrained styling only: it never permits retaining a raw structural wall surface as the final facade.",
  balanced: "Use a noticeable but buildable facade composition while preserving every protected structural element.",
  conceptual: "Use a more expressive composition of finish materials, colors, lighting and facade details on the existing wall surfaces. Keep the architecture and every protected structural element unchanged.",
};

function isCombinedFacade(materials) {
  return materials.some((material) => /^(комбинированная|combined)$/iu.test(String(material).trim()));
}

function finishInstruction(input, automaticMaterials) {
  const rawSurfaceRule = "RAW-SURFACE REPLACEMENT — non-negotiable: if the source shows aerated-concrete blocks, cinder blocks, unfinished masonry, bare concrete, primer or a construction shell, cover every visible raw wall field with a real finished facade system. Preserve the wall plane, all openings and roof geometry, but completely hide raw block joints. A recolour, tint, wash, thin paint-like layer or isolated accents over the same raw blocks is invalid.";
  if (automaticMaterials) {
    return [
      "AUTOMATIC MATERIAL SYSTEM: Select and visibly apply a coherent, buildable facade system: a primary wall finish plus one or two complementary facade materials appropriate to the required style. Show real texture, scale, joints, edges, reveals and installation logic. Do not return raw blockwork, a primer-only shell or a result that merely repaints the existing wall color.",
      rawSurfaceRule,
    ].join(" ");
  }
  if (isCombinedFacade(input.materials)) {
    return [
      "COMBINED FACADE SYSTEM — mandatory: make the complete facade look finished. Use one continuous primary finish across all raw exterior wall surfaces (for example smooth mineral plaster, fibre-cement or large-format facade panels) and place complementary stone, wood or metal accents only as deliberate secondary areas. Finish the plinth, external corners, window/door reveals and existing columns in the same coherent system. The primary finish must visually dominate the raw wall area.",
      rawSurfaceRule,
    ].join(" ");
  }
  return [
    `Required finish materials: ${input.materials.join(", ")}. Show their real texture, scale, joints, edges and installation logic over the visible wall surfaces.`,
    rawSurfaceRule,
  ].join(" ");
}

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

export function composeGenerationPrompt(input, {
  qualityRetryReasons = [], edit = null,
} = {}) {
  const automaticMaterials = input.materials.length === 0
    || input.materials.every((material) => /^(автоподбор|auto)$/iu.test(String(material).trim()));
  const protectedItems = Object.entries(input.preserve)
    .filter(([, enabled]) => enabled)
    .map(([key]) => preserveLabels[key]);
  const allowedItems = Object.entries(input.preserve)
    .filter(([, enabled]) => !enabled)
    .map(([key]) => preserveLabels[key]);
  const openingRetry = qualityRetryReasons.some((reason) => /windows|doors|opening/iu.test(reason));
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
    finishInstruction(input, automaticMaterials),
    input.palette.length
      ? `Required color palette: ${input.palette.join(", ")}. Keep material colors within this palette.`
      : "",
    input.wishes
      ? `Required client wishes: ${input.wishes}. Treat these wishes as part of the design brief unless they conflict with protected geometry.`
      : "",
    "STRUCTURAL LOCK: Keep the exact same house, storey count, roof, viewpoint and position. Keep every original window, door, balcony, terrace, structural post and canopy in the identical count, size, shape and pixel position. Never add, remove, move, resize or duplicate any of them.",
    "ROOF SILHOUETTE LOCK: Preserve every roof ridge, gable or hip angle, eave, overhang and roof-to-wall boundary in the exact same pixel position. Change facade finishes only; never alter the roof contour or its geometry.",
    "OPENING LOCK: Before applying any finish, inventory every visible original window and door from left to right. Keep the identical count, type, size and pixel position. Never add an opening to a blank wall, remove an opening or duplicate an opening.",
    "COMPLETION STANDARD: Resolve the whole visible facade as a coherent finished object. Complete wall finishes; external corners and material transitions; cornice/eaves, fascia and soffit lining; the plinth/base; window and door reveals, sills and flashings; and the finish of every already-existing column, post or support. Add realistic gutters and downpipes only where they normally attach to the existing roof, without changing roof geometry. Preserve existing porch, canopy and support positions while giving their visible surfaces a finished material treatment.",
    "SAFETY COMPLETION: Inspect the existing architecture and automatically add realistic guardrails or handrails only where an already-existing accessible elevated platform, balcony opening, porch edge, exterior stair or dangerous level change would normally require fall protection. Match the required facade style, materials and palette. Do not invent a new balcony, terrace, platform, stair, opening or support in order to place a railing.",
    "Use believable construction thickness, seams, junctions, shadow gaps, caps and drainage details. No raw blockwork, exposed unfinished concrete, primer-only surfaces, floating cladding or flat paint-only treatment when the client selected finish materials.",
    protectedItems.length
      ? `STRICTLY PRESERVE: ${protectedItems.join("; ")}. These elements must remain pixel-position consistent with the source photograph.`
      : "",
    allowedItems.length
      ? `The user explicitly allows changes to: ${allowedItems.join("; ")}.`
      : "",
    input.preserve.plot
      ? "Keep the original environment, season, lighting direction and camera optics."
      : "Automatically clean up the visible construction area around the facade: remove temporary debris, loose building materials, tools, machinery, parked vehicles and other non-architectural clutter. Turn unfinished foreground into restrained, realistic landscaping with plausible lawn, paths and planting that fit the house. Do not move the house, change permanent terrain, hide the facade or invent structures.",
    "The result is a facade visualization concept, not a construction drawing.",
    input.preserve.noNewFloors
      ? "Never add a new storey, even when other facade changes are allowed."
      : "A storey change is allowed only when the client also disabled preservation of the storey count.",
    "Do not change any protected floor, window, door, roof, terrace, balcony, extension, structural post or canopy. Safety railings on already-existing geometry are the only permitted automatically inferred addition. Do not add people, vehicles, text, logos, watermarks or construction drawings.",
    qualityRetryReasons.length
      ? `AUTOMATIC QUALITY RETRY: The previous candidate was rejected for: ${qualityRetryReasons.join(", ")}. Correct those failures. Increase source-image fidelity and preserve all protected contours, openings, roof lines, storeys, viewpoint and house position. This is the single automatic retry; do not trade structural fidelity for style.`
      : "",
    qualityRetryReasons.some((reason) => /finish|unfinished_facade/iu.test(reason))
      ? "RETRY FINISH LOCK: The previous result left a raw construction wall visible or merely recoloured it. Replace the exposed raw blockwork with the required full facade system now. Do not return any exposed aerated-concrete, cinder-block or unfinished masonry as the main wall finish."
      : "",
    openingRetry
      ? "RETRY OPENING LOCK: Copy the source window and door inventory exactly. Any extra, missing, moved, resized or duplicated opening makes this result invalid. Keep every source blank wall free of new openings."
      : "",
    input.negativeConstraints.length
      ? `Additional forbidden changes: ${input.negativeConstraints.join("; ")}.`
      : "",
  ].filter(Boolean).join("\n");
  return { prompt, version: GENERATION_PROMPT_VERSION };
}
