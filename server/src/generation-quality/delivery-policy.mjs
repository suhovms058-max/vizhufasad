const SOFT_FAILURES = new Set([
  "position_below_threshold",
  "perspective_below_threshold",
  "position_changed_detected",
  "perspective_changed_detected",
  "overall_below_threshold",
]);

export const FALLBACK_MIN_OVERALL_SCORE = 6_200;

function reasonsFrom(assessment = {}) {
  return assessment.failureReasons || assessment.failure_reasons || [];
}

function scoreFrom(assessment = {}) {
  return Number(assessment.overallScore ?? assessment.overall_score ?? 0);
}

export function fallbackDeliveryPolicy(assessment = {}) {
  const failureReasons = [...new Set(reasonsFrom(assessment).map(String))];
  const hardFailureReasons = failureReasons.filter((reason) => !SOFT_FAILURES.has(reason));
  const overallScore = scoreFrom(assessment);
  return Object.freeze({
    eligible: failureReasons.length > 0
      && hardFailureReasons.length === 0
      && overallScore >= FALLBACK_MIN_OVERALL_SCORE,
    overallScore,
    hardFailureReasons,
    softFailureReasons: failureReasons.filter((reason) => SOFT_FAILURES.has(reason)),
  });
}

export function bestFallbackAssessment(assessments = []) {
  return assessments
    .map((assessment) => ({ assessment, policy: fallbackDeliveryPolicy(assessment) }))
    .filter(({ policy }) => policy.eligible)
    .sort((left, right) => right.policy.overallScore - left.policy.overallScore)[0]?.assessment || null;
}
