import {
  deepFreeze,
  median,
  normalizeCertificationContext,
  requireNonNegativeFinite,
  requireObject,
  requireRatio,
  requireToken,
} from "./executionCapsuleRolloutSupport.js";

const REQUIRED_LANES = Object.freeze(["tenant_read", "admin_read", "governed_mutation"]);
const MINIMUM_SAMPLE_COUNT = 6;
const MINIMUM_SAMPLES_PER_REQUIRED_LANE = 2;
const MINIMUM_MEDIAN_IMPROVEMENT = 0.4;
const MINIMUM_ENUMERATION_REDUCTION = 0.6;
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
  minimumSampleCount = MINIMUM_SAMPLE_COUNT,
  minimumSamplesPerRequiredLane = MINIMUM_SAMPLES_PER_REQUIRED_LANE,
  requiredLanes = REQUIRED_LANES,
  minimumMedianImprovement = MINIMUM_MEDIAN_IMPROVEMENT,
  minimumEnumerationReduction = MINIMUM_ENUMERATION_REDUCTION,
} = {}) {
  if (!Number.isInteger(minimumSampleCount) || minimumSampleCount < MINIMUM_SAMPLE_COUNT) {
    throw new TypeError(`minimumSampleCount cannot be lower than ${MINIMUM_SAMPLE_COUNT}.`);
  }
  if (
    !Number.isInteger(minimumSamplesPerRequiredLane) ||
    minimumSamplesPerRequiredLane < MINIMUM_SAMPLES_PER_REQUIRED_LANE
  ) {
    throw new TypeError(
      `minimumSamplesPerRequiredLane cannot be lower than ${MINIMUM_SAMPLES_PER_REQUIRED_LANE}.`,
    );
  }
  if (!Array.isArray(requiredLanes) || requiredLanes.length === 0) {
    throw new TypeError("requiredLanes must be a non-empty array.");
  }
  const lanes = Object.freeze([...new Set(requiredLanes.map((lane, index) =>
    requireToken(lane, `requiredLanes[${index}]`)
  ))].sort());
  const missingMandatoryLanes = REQUIRED_LANES.filter((lane) => !lanes.includes(lane));
  if (missingMandatoryLanes.length) {
    throw new TypeError(`requiredLanes must include: ${REQUIRED_LANES.join(", ")}.`);
  }
  const improvementFloor = requireRatio(minimumMedianImprovement, "minimumMedianImprovement");
  const enumerationFloor = requireRatio(minimumEnumerationReduction, "minimumEnumerationReduction");
  if (improvementFloor < MINIMUM_MEDIAN_IMPROVEMENT) {
    throw new TypeError(`minimumMedianImprovement cannot be lower than ${MINIMUM_MEDIAN_IMPROVEMENT}.`);
  }
  if (enumerationFloor < MINIMUM_ENUMERATION_REDUCTION) {
    throw new TypeError(`minimumEnumerationReduction cannot be lower than ${MINIMUM_ENUMERATION_REDUCTION}.`);
  }

  return Object.freeze({
    evaluate({ samples, rollbackEvidence, certificationContext } = {}) {
      if (!Array.isArray(samples)) throw new TypeError("samples must be an array.");
      const normalized = Object.freeze(samples.map(normalizeSample));
      const normalizedContext = normalizeCertificationContext(certificationContext);
      const rollback = normalizeRollbackEvidence(rollbackEvidence);
      const sampleRefs = new Set(normalized.map((sample) => sample.sampleRef));
      const duplicateSampleRefs = normalized.length - sampleRefs.size;
      const observedLanes = new Set(normalized.map((sample) => sample.lane));
      const missingLanes = lanes.filter((lane) => !observedLanes.has(lane));
      const laneSampleCounts = Object.fromEntries(lanes.map((lane) => [
        lane,
        normalized.filter((sample) => sample.lane === lane).length,
      ]));
      const underrepresentedLanes = REQUIRED_LANES.filter(
        (lane) => laneSampleCounts[lane] < minimumSamplesPerRequiredLane,
      );
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
      if (duplicateSampleRefs) reasonCodes.push("execution_capsule_rollout_duplicate_sample_ref");
      if (missingLanes.length) reasonCodes.push("execution_capsule_rollout_required_lane_missing");
      if (underrepresentedLanes.length) reasonCodes.push("execution_capsule_rollout_required_lane_underrepresented");
      if (parityFailures) reasonCodes.push("execution_capsule_rollout_parity_failed");
      if (targetFailures) reasonCodes.push("execution_capsule_rollout_target_retention_failed");
      if (safetyViolations) reasonCodes.push("execution_capsule_rollout_safety_violation");
      if (medianImprovement < improvementFloor) reasonCodes.push("execution_capsule_rollout_performance_floor_not_met");
      if (enumerationReduction < enumerationFloor) reasonCodes.push("execution_capsule_rollout_enumeration_floor_not_met");
      if (!rollbackSafe) reasonCodes.push("execution_capsule_rollout_rollback_not_safe");

      const certificate = deepFreeze({
        contract: "mad4b.execution-capsule-rollout-certificate.v2",
        certificationContext: normalizedContext,
        status: reasonCodes.length ? "blocked" : "certified",
        rolloutAllowed: reasonCodes.length === 0,
        legacyRetirementAllowed: reasonCodes.length === 0,
        sampleCount: normalized.length,
        uniqueSampleCount: sampleRefs.size,
        duplicateSampleRefs,
        minimumSampleCount,
        minimumSamplesPerRequiredLane,
        requiredLanes: lanes,
        observedLanes: [...observedLanes].sort(),
        missingLanes,
        laneSampleCounts,
        underrepresentedLanes,
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
