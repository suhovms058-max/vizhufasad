export const PHOTO_ASSESSMENT_SCHEMA_VERSION = "facade-photo-observation-v2";

export const issueCodes = [
  "not_house",
  "interior",
  "screenshot",
  "multiple_houses",
  "facade_not_visible",
  "severe_obstruction",
  "poor_perspective",
  "blurred",
  "too_dark",
  "too_bright",
  "roof_cropped",
  "house_cropped",
  "low_detail",
  "entrance_group_unclear",
];

const qualityLevel = { type: "string", enum: ["good", "acceptable", "poor"] };

export const providerObservationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scene: {
      type: "string",
      enum: ["facade", "exterior_partial", "interior", "screenshot", "multiple_houses", "other"],
    },
    houseVisible: { type: "boolean" },
    facadeVisible: { type: "boolean" },
    frameCompleteness: { type: "string", enum: ["complete", "minor_crop", "major_crop"] },
    geometry: qualityLevel,
    obstruction: { type: "string", enum: ["none", "minor", "major"] },
    perspective: qualityLevel,
    sharpness: qualityLevel,
    lighting: qualityLevel,
    roofCrop: { type: "string", enum: ["none", "minor", "major"] },
    entranceGroupPresent: { type: "boolean" },
    entranceGroupVisibility: { type: "string", enum: ["clear", "partial", "not_visible"] },
    entranceGroupType: {
      type: "string",
      enum: ["none", "direct_steps", "landing", "terrace_platform", "other"],
    },
    entranceGroupBounds: {
      type: "object",
      additionalProperties: false,
      properties: {
        left: { type: "number", minimum: 0, maximum: 1 },
        top: { type: "number", minimum: 0, maximum: 1 },
        right: { type: "number", minimum: 0, maximum: 1 },
        bottom: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["left", "top", "right", "bottom"],
    },
    entranceGroupSpanRatio: { type: "number", minimum: 0, maximum: 1 },
    entranceGroupConfidence: { type: "number", minimum: 0, maximum: 1 },
    entranceGroupDescription: { type: "string", minLength: 1, maxLength: 240 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    issueCodes: {
      type: "array",
      items: { type: "string", enum: issueCodes },
      uniqueItems: true,
      maxItems: 10,
    },
  },
  required: [
    "scene", "houseVisible", "facadeVisible", "frameCompleteness", "geometry",
    "obstruction", "perspective", "sharpness", "lighting", "roofCrop",
    "entranceGroupPresent", "entranceGroupVisibility", "entranceGroupType",
    "entranceGroupBounds", "entranceGroupSpanRatio", "entranceGroupConfidence",
    "entranceGroupDescription",
    "confidence", "issueCodes",
  ],
};

export const allowedAssessmentDecisions = new Set([
  "accepted", "accepted_with_warning", "retake_required",
]);
