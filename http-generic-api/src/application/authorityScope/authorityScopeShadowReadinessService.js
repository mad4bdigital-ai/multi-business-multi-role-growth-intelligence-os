export const AUTHORITY_SCOPE_SHADOW_READINESS_CODES = Object.freeze({
  READY_FOR_REVIEW:"ready_for_review",
  INSUFFICIENT_SAMPLES:"authority_scope_insufficient_samples",
  UNRESOLVED_PRESENT:"authority_scope_unresolved_present",
  MISMATCH_THRESHOLD_EXCEEDED:"authority_scope_mismatch_threshold_exceeded"
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

export function evaluateAuthorityScopeShadowReadiness({
  policy,
  summary = {},
  baseReadinessCode = "ready_for_review"
} = {}) {
  if (!policy) {
    throw Object.assign(new Error("Authority Scope shadow readiness requires a rollout policy."), {
      code:"authority_scope_readiness_policy_required",
      status:422
    });
  }

  const normalizedBaseReadinessCode = String(baseReadinessCode || "ready_for_review").trim();
  const minimumSampleCount = nonNegativeNumber(
    policy.minimumSampleCount ?? policy.minimum_sample_count,
    100
  );
  const mismatchThresholdPercent = nonNegativeNumber(
    policy.mismatchThresholdPercent ?? policy.mismatch_threshold_percent,
    0.5
  );
  const sampleCount = nonNegativeNumber(summary.sampleCount ?? summary.sample_count);
  const matchCount = nonNegativeNumber(summary.matchCount ?? summary.match_count);
  const mismatchCount = nonNegativeNumber(summary.mismatchCount ?? summary.mismatch_count);
  const unresolvedCount = nonNegativeNumber(summary.unresolvedCount ?? summary.unresolved_count);
  const comparableSampleCount = nonNegativeNumber(
    summary.comparableSampleCount ?? summary.comparable_sample_count,
    matchCount + mismatchCount
  );
  const calculatedMismatchPercent = comparableSampleCount
    ? (100 * mismatchCount) / comparableSampleCount
    : 0;
  const mismatchPercent = nonNegativeNumber(
    summary.mismatchPercent ?? summary.mismatch_percent,
    calculatedMismatchPercent
  );

  let readinessCode = normalizedBaseReadinessCode;
  if (readinessCode === AUTHORITY_SCOPE_SHADOW_READINESS_CODES.READY_FOR_REVIEW) {
    if (sampleCount < minimumSampleCount) {
      readinessCode = AUTHORITY_SCOPE_SHADOW_READINESS_CODES.INSUFFICIENT_SAMPLES;
    } else if (unresolvedCount > 0) {
      readinessCode = AUTHORITY_SCOPE_SHADOW_READINESS_CODES.UNRESOLVED_PRESENT;
    } else if (mismatchPercent > mismatchThresholdPercent) {
      readinessCode = AUTHORITY_SCOPE_SHADOW_READINESS_CODES.MISMATCH_THRESHOLD_EXCEEDED;
    }
  }

  return Object.freeze({
    baseReadinessCode:normalizedBaseReadinessCode,
    readinessCode,
    readyForReview:readinessCode === AUTHORITY_SCOPE_SHADOW_READINESS_CODES.READY_FOR_REVIEW,
    enforcementRequested:false,
    promotionRequested:false,
    authorityGranted:false,
    evidence:Object.freeze({
      sampleCount,
      matchCount,
      mismatchCount,
      unresolvedCount,
      comparableSampleCount,
      mismatchPercent:Number(mismatchPercent.toFixed(4)),
      minimumSampleCount,
      mismatchThresholdPercent
    }),
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    secretsIncluded:false
  });
}

export const _testingAuthorityScopeShadowReadinessService = Object.freeze({
  finiteNumber,
  nonNegativeNumber
});
