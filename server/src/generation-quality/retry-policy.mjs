const ARCHITECTURAL_FAILURE = /(?:same_house|different_house|floors|roof|windows|doors|opening|balcon|terrace|entrance_group|contours|spatial_layout|protected_zones)/iu;

export function automaticQualityRetryPolicy(failureReasons = []) {
  const reasons = [...new Set((failureReasons || []).map(String))];
  const architecturalReasons = reasons.filter((reason) => ARCHITECTURAL_FAILURE.test(reason));
  return Object.freeze({
    eligible: reasons.length > 0 && architecturalReasons.length === 0,
    architecturalReasons,
    retryableReasons: reasons.filter((reason) => !ARCHITECTURAL_FAILURE.test(reason)),
  });
}
