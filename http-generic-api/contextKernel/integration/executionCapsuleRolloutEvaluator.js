import {
  deepFreeze,
  median,
  requireNonNegativeFinite,
  requireObject,
  requireRatio,
  requireToken,
} from "./executionCapsuleRolloutSupport.js";

const DEFAULT_LANES = Object.freeze(["tenant_read", "admin_read", "governed_mutation"]);
const TRUSTED_CERTIFICATES = new WeakSet();

function normalizeSample(sample, index) {
  const value = requireObject(sample, `samples[${index}]`);
  return deepFreeze({
    sampleRef: requireToken(value.sampleRef || `sample-${index + 1}`, `samples[${index}].sampleRef`),
    lane: requireToken(value.lane, `samples[${index}].lane`),
    legacyDurationMs: requireNonNegativeFinite(value.legacyDurationMs, `samples[${index}].legacyDurationMs`),
    capsuleDurationMs: requireNonNegativeFinite(value.capsuleDurationMs, `samples[${index}].capsuleDurationMs`),
    legacyCandidateEnumerations: requireNonNegativeFinite(
      value.legacyCandidateEnumerations,
      `samples[${index}].legacyCandidateEnumerations`,
    ),
    capsuleCandidateEnumerations: requireNonNegativeFinite(
      value.capsuleCandidateEnumerations,
      `samples[${index}].capsuleCandidateEnumerations`,
    ),
    parityMatch: value.parityMatch === true,
    exactTargetRetained: value.exactTargetRetained === true,
    authoritySafe: value.authoritySafe === true,
    staleAuthorityAccepted: value.staleAuthorityAccepted === true,
    ambiguitySuppressed: value.ambiguitySuppressed === true,
    crossTenantAccess: value.crossTenantAccess === true,
    connectionSubstituted: value.connectionSubstituted === true,
  });
}

function normalizeRollbackEvidence(value) {
  const evidence = requireObject(value, "rollbackEvidence");
  return deepFreeze({
    exactOwnerIsolationRetained: evidence.exactOwnerIsolationRetained === true,
    failClosedWhenGuardUnavailable: evidence.failClosedWhenGuardUnavailable === true,
    legacyResolverRestorable: evidence.legacyResolverRestorable === true,
    providerDispatchPerformed: evidence.providerDispatchPerformed === true,
    databaseWritePerformed: evidence.databaseWritePerformed === true,
    credentialMutationPerformed: evidence.credentialMutationPerformed === true,
  });
}

export function createExecutionCapsuleRolloutEvaluator({
  minimumSampleCount = 6,
  requiredLanes = DEFAULT_LANES,
  minimumMedianImprovement = 0.4,
  minimumEnumerationReduction = 0.6,
} = {}) {
  if (!Number.isInteger(minimumSampleCount) || minimumSampleCount < 1) {
    throw new TypeError("minimumSampleCount must be a positive integer.");
  }
  if (!Array.isArray(requiredLanes) || requiredLanes.length === 0) {
    throw new TypeError("requiredLanes must be a non-empty array.");
  }
  const lanes = Object.freeze([...new Set(requiredLanes.map((lane, index) =>
    requireToken(lane, `requiredLanes[${index}]`)
  ))].sort());
  const improvementFloor = requireRatio(minimumMedianImprovement, "minimumMedianImprovement");
  const enumerationFloor = requireRatio(minimumEnumerationReduction, "minimumEnumerationReduction");

  return Object.freeze({
    evaluate({ samples, rollbackEvidence } = {}) {
      if (!Array.isArray(samples)) throw new TypeError("samples must be an array.");
      const normalized = Object.freeze(samples.map(normalizeSample));
      const rollback = normalizeRollbackEvidence(rollbackEvidence);
      const observedLanes = new Set(normalized.map((sample) => sample.lane));
      const missingLanes = lanes.filter((lane) => !observedLanes.has(lane));
      const legacyMedian = median(normalized.map((sample) => sample.legacyDurationMs));
      const capsuleMedian = median(normalized.map((sample) => sample.capsuleDurationMs));
      const medianImprovement = legacyMedian > 0
        ? Math.max(0, (legacyMedian - capsuleMedian) / legacyMedian)
        : 0;
      const legacyEnumerations = normalized.reduce(
        (total, sample) => total + sample.legacyCandidateEnumerations,
        0,
      );
      const capsuleEnumerations = normalized.reduce(
        (total, sample) => total + sample.capsuleCandidateEnumerations,
        0,
      );
      const enumerationReduction = legacyEnumerations > 0
        ? Math.max(0, (legacyEnumerations - capsuleEnumerations) / legacyEnumerations)
        : 0;
      const parityFailures = normalized.filter((sample) => !sample.parityMatch).length;
      const targetFailures = normalized.filter((sample) => !sample.exactTargetRetained).length;
      const safetyViolations = normalized.filter((sample) =>
        !sample.authoritySafe || sample.staleAuthorityAccepted || sample.ambiguitySuppressed ||
        sample.crossTenantAccess || sample.connectionSubstituted
      ).length;
      const rollbackSafe = rollback.exactOwnerIsolationRetained &&
        rollback.failClosedWhenGuardUnavailable && rollback.legacyResolverRestorable &&
        !rollback.providerDispatchPerformed && !rollback.databaseWritePerformed &&
        !rollback.credentialMutationPerformed;
      const reasonCodes = [];
      if (normalized.length < minimumSampleCount) reasonCodes.push("execution_capsule_rollout_sample_count_insufficient");
      if (missingLanes.length) reasonCodes.push("execution_capsule_rollout_required_lane_missing");
      if (parityFailures) reasonCodes.push("execution_capsule_rollout_parity_failed");
      if (targetFailures) reasonCodes.push("execution_capsule_rollout_target_retention_failed");
      if (safetyViolations) reasonCodes.push("execution_capsule_rollout_safety_violation");
      if (medianImprovement < improvementFloor) reasonCodes.push("execution_capsule_rollout_performance_floor_not_met");
      if (enumerationReduction < enumerationFloor) reasonCodes.push("execution_capsule_rollout_enumeration_floor_not_met");
      if (!rollbackSafe) reasonCodes.push("execution_capsule_rollout_rollback_not_safe");

      const certificate = deepFreeze({
        contract: "mad4b.execution-capsule-rollout-certificate.v1",
        status: reasonCodes.length ? "blocked" : "certified",
        rolloutAllowed: reasonCodes.length === 0,
        legacyRetirementAllowed: reasonCodes.length === 0,
        sampleCount: normalized.length,
        requiredLanes: lanes,
        observedLanes: [...observedLanes].sort(),
        missingLanes,
        parityFailures,
        targetFailures,
        safetyViolations,
        legacyMedianDurationMs: legacyMedian,
        capsuleMedianDurationMs: capsuleMedian,
        medianImprovement,
        minimumMedianImprovement: improvementFloor,
        legacyCandidateEnumerations: legacyEnumerations,
        capsuleCandidateEnumerations: capsuleEnumerations,
        enumerationReduction,
        minimumEnumerationReduction: enumerationFloor,
        rollbackSafe,
        reasonCodes,
        secretsIncluded: false,
      });
      TRUSTED_CERTIFICATES.add(certificate);
      return certificate;
    },
  });
}

export function isTrustedExecutionCapsuleRolloutCertificate(certificate) {
  return Boolean(certificate && typeof certificate === "object" && TRUSTED_CERTIFICATES.has(certificate));
}
