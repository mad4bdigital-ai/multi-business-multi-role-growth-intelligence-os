import { createHash } from "node:crypto";

import { deepFreeze } from "../domain/index.js";

const TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,190}$/u;
const DIGEST_PATTERN = /^sha256-[0-9a-f]{64}$/u;
const METRICS_DIGEST_SCHEMA = "execution-capsule-runtime-metrics-v1";
const RETIREMENT_PLAN_DIGEST_SCHEMA = "execution-capsule-runtime-retirement-plan-v1";
const THRESHOLDS = Object.freeze({
  medianResolutionImprovementPct: 40,
  candidateEnumerationReductionPct: 60,
  parityRatePct: 100,
  coveredOperationRatePct: 100,
});

function cleanToken(value, fieldName) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    throw new TypeError(`${fieldName} must be a bounded token.`);
  }
  return token;
}

function cleanDigest(value, fieldName) {
  const digest = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!DIGEST_PATTERN.test(digest)) {
    throw new TypeError(`${fieldName} must be a sha256 digest.`);
  }
  return digest;
}

function percentage(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new TypeError(`${fieldName} must be between 0 and 100.`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer.`);
  }
  return number;
}

function normalizeMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("metrics must be an object.");
  }
  return deepFreeze({
    medianResolutionImprovementPct: percentage(
      value.medianResolutionImprovementPct,
      "metrics.medianResolutionImprovementPct",
    ),
    candidateEnumerationReductionPct: percentage(
      value.candidateEnumerationReductionPct,
      "metrics.candidateEnumerationReductionPct",
    ),
    parityRatePct: percentage(value.parityRatePct, "metrics.parityRatePct"),
    coveredOperationRatePct: percentage(
      value.coveredOperationRatePct,
      "metrics.coveredOperationRatePct",
    ),
    ambiguitySuppressionIncrease: nonNegativeInteger(
      value.ambiguitySuppressionIncrease,
      "metrics.ambiguitySuppressionIncrease",
    ),
    crossTenantAccessIncrease: nonNegativeInteger(
      value.crossTenantAccessIncrease,
      "metrics.crossTenantAccessIncrease",
    ),
    connectionSubstitutionIncrease: nonNegativeInteger(
      value.connectionSubstitutionIncrease,
      "metrics.connectionSubstitutionIncrease",
    ),
    staleAuthorityAcceptanceIncrease: nonNegativeInteger(
      value.staleAuthorityAcceptanceIncrease,
      "metrics.staleAuthorityAcceptanceIncrease",
    ),
    readPilotPassed: value.readPilotPassed === true,
    mutationPilotPassed: value.mutationPilotPassed === true,
    rollbackDrillPassed: value.rollbackDrillPassed === true,
    exactHeadCiPassed: value.exactHeadCiPassed === true,
    humanReviewPassed: value.humanReviewPassed === true,
  });
}

function canonicalMetricsPayload(metrics) {
  return {
    schemaVersion: METRICS_DIGEST_SCHEMA,
    metrics: {
      medianResolutionImprovementPct: metrics.medianResolutionImprovementPct,
      candidateEnumerationReductionPct: metrics.candidateEnumerationReductionPct,
      parityRatePct: metrics.parityRatePct,
      coveredOperationRatePct: metrics.coveredOperationRatePct,
      ambiguitySuppressionIncrease: metrics.ambiguitySuppressionIncrease,
      crossTenantAccessIncrease: metrics.crossTenantAccessIncrease,
      connectionSubstitutionIncrease: metrics.connectionSubstitutionIncrease,
      staleAuthorityAcceptanceIncrease: metrics.staleAuthorityAcceptanceIncrease,
      readPilotPassed: metrics.readPilotPassed,
      mutationPilotPassed: metrics.mutationPilotPassed,
      rollbackDrillPassed: metrics.rollbackDrillPassed,
      exactHeadCiPassed: metrics.exactHeadCiPassed,
      humanReviewPassed: metrics.humanReviewPassed,
    },
  };
}

function digestNormalizedMetrics(metrics) {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalMetricsPayload(metrics)), "utf8")
    .digest("hex");
  return `sha256-${digest}`;
}

export function computeExecutionCapsuleRuntimeMetricsDigest(rawMetrics) {
  return digestNormalizedMetrics(normalizeMetrics(rawMetrics));
}

function normalizeRetirementPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("retirementPlan must be an object.");
  }
  if (
    !Array.isArray(value.legacyResolverKeys) ||
    value.legacyResolverKeys.length === 0 ||
    value.legacyResolverKeys.length > 128
  ) {
    throw new TypeError("retirementPlan.legacyResolverKeys must contain 1 to 128 entries.");
  }
  const replacementResolverKey = cleanToken(
    value.replacementResolverKey,
    "retirementPlan.replacementResolverKey",
  );
  const normalizedKeys = value.legacyResolverKeys.map((entry, index) =>
    cleanToken(entry, `retirementPlan.legacyResolverKeys[${index}]`)
  );
  const uniqueKeys = [...new Set(normalizedKeys)].sort();
  if (uniqueKeys.length !== normalizedKeys.length) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_duplicate_legacy_resolver",
    );
  }
  if (uniqueKeys.includes(replacementResolverKey)) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_replacement_resolver_cannot_be_retired",
    );
  }
  return deepFreeze({
    planRef: cleanToken(value.planRef, "retirementPlan.planRef"),
    replacementResolverKey,
    rollbackRef: cleanToken(value.rollbackRef, "retirementPlan.rollbackRef"),
    metricsEvidenceRef: cleanToken(
      value.metricsEvidenceRef,
      "retirementPlan.metricsEvidenceRef",
    ),
    metricsEvidenceRevision: cleanToken(
      value.metricsEvidenceRevision,
      "retirementPlan.metricsEvidenceRevision",
    ),
    metricsDigest: cleanDigest(value.metricsDigest, "retirementPlan.metricsDigest"),
    legacyResolverKeys: uniqueKeys,
  });
}

function canonicalRetirementPlanPayload(retirementPlan) {
  return {
    schemaVersion: RETIREMENT_PLAN_DIGEST_SCHEMA,
    retirementPlan: {
      planRef: retirementPlan.planRef,
      replacementResolverKey: retirementPlan.replacementResolverKey,
      rollbackRef: retirementPlan.rollbackRef,
      metricsEvidenceRef: retirementPlan.metricsEvidenceRef,
      metricsEvidenceRevision: retirementPlan.metricsEvidenceRevision,
      metricsDigest: retirementPlan.metricsDigest,
      legacyResolverKeys: retirementPlan.legacyResolverKeys,
    },
  };
}

function digestNormalizedRetirementPlan(retirementPlan) {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalRetirementPlanPayload(retirementPlan)), "utf8")
    .digest("hex");
  return `sha256-${digest}`;
}

function assertMetricsDigestBinding(metrics, retirementPlan) {
  const computedDigest = digestNormalizedMetrics(metrics);
  if (computedDigest !== retirementPlan.metricsDigest) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_metrics_digest_mismatch",
    );
  }
  return computedDigest;
}

function failedGates(metrics) {
  const failed = [];
  if (metrics.medianResolutionImprovementPct < THRESHOLDS.medianResolutionImprovementPct) {
    failed.push("median_resolution_improvement_below_40_pct");
  }
  if (metrics.candidateEnumerationReductionPct < THRESHOLDS.candidateEnumerationReductionPct) {
    failed.push("candidate_enumeration_reduction_below_60_pct");
  }
  if (metrics.parityRatePct < THRESHOLDS.parityRatePct) failed.push("parity_not_complete");
  if (metrics.coveredOperationRatePct < THRESHOLDS.coveredOperationRatePct) {
    failed.push("coverage_not_complete");
  }
  if (metrics.ambiguitySuppressionIncrease !== 0) failed.push("ambiguity_suppression_regression");
  if (metrics.crossTenantAccessIncrease !== 0) failed.push("cross_tenant_access_regression");
  if (metrics.connectionSubstitutionIncrease !== 0) {
    failed.push("connection_substitution_regression");
  }
  if (metrics.staleAuthorityAcceptanceIncrease !== 0) {
    failed.push("stale_authority_acceptance_regression");
  }
  if (!metrics.readPilotPassed) failed.push("read_pilot_not_passed");
  if (!metrics.mutationPilotPassed) failed.push("mutation_pilot_not_passed");
  if (!metrics.rollbackDrillPassed) failed.push("rollback_drill_not_passed");
  if (!metrics.exactHeadCiPassed) failed.push("exact_head_ci_not_passed");
  if (!metrics.humanReviewPassed) failed.push("human_review_not_passed");
  return Object.freeze(failed.sort());
}

function requireApproval(value, retirementPlan, retirementPlanDigest) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_approval_missing",
    );
  }
  if (value.status !== "approved") {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_approval_blocked",
    );
  }
  if (cleanToken(value.planRef, "approval.planRef") !== retirementPlan.planRef) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_plan_mismatch",
    );
  }
  if (
    cleanDigest(value.planDigest, "approval.planDigest") !== retirementPlanDigest ||
    cleanToken(value.metricsEvidenceRef, "approval.metricsEvidenceRef") !==
      retirementPlan.metricsEvidenceRef ||
    cleanToken(value.metricsEvidenceRevision, "approval.metricsEvidenceRevision") !==
      retirementPlan.metricsEvidenceRevision ||
    cleanDigest(value.metricsDigest, "approval.metricsDigest") !== retirementPlan.metricsDigest
  ) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_evidence_mismatch",
    );
  }
  return deepFreeze({
    status: "approved",
    planRef: retirementPlan.planRef,
    planDigest: retirementPlanDigest,
    metricsEvidenceRef: retirementPlan.metricsEvidenceRef,
    metricsEvidenceRevision: retirementPlan.metricsEvidenceRevision,
    metricsDigest: retirementPlan.metricsDigest,
    decisionRef: cleanToken(value.decisionRef, "approval.decisionRef"),
    decisionRevision: cleanToken(value.decisionRevision, "approval.decisionRevision"),
  });
}

function projectRetirementResult(value, retirementPlan) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_result_invalid",
    );
  }
  if (value.status !== "retired") {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_result_not_retired",
    );
  }
  if (!Array.isArray(value.retiredResolverKeys)) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_result_keys_missing",
    );
  }
  const retiredResolverKeys = value.retiredResolverKeys
    .map((entry, index) => cleanToken(entry, `retirementResult.retiredResolverKeys[${index}]`))
    .sort();
  if (
    retiredResolverKeys.length !== retirementPlan.legacyResolverKeys.length ||
    retiredResolverKeys.some((entry, index) => entry !== retirementPlan.legacyResolverKeys[index])
  ) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_result_scope_mismatch",
    );
  }
  if (
    cleanToken(value.replacementResolverKey, "retirementResult.replacementResolverKey") !==
      retirementPlan.replacementResolverKey ||
    cleanToken(value.rollbackRef, "retirementResult.rollbackRef") !== retirementPlan.rollbackRef
  ) {
    throw new ExecutionCapsuleRuntimeRolloutError(
      "execution_capsule_runtime_retirement_result_binding_mismatch",
    );
  }
  return deepFreeze({
    status: "retired",
    retiredResolverKeys,
    replacementResolverKey: retirementPlan.replacementResolverKey,
    rollbackRef: retirementPlan.rollbackRef,
    secretsIncluded: false,
  });
}

async function emitSafely(emitTelemetry, event) {
  if (typeof emitTelemetry !== "function") return;
  try {
    await emitTelemetry(deepFreeze(event));
  } catch {
    // Telemetry cannot change readiness or retirement behavior.
  }
}

export const ExecutionCapsuleRuntimeRolloutStatus = Object.freeze({
  BLOCKED: "blocked",
  READY: "ready_for_legacy_retirement",
  RETIRED: "legacy_resolvers_retired",
});

export class ExecutionCapsuleRuntimeRolloutError extends Error {
  constructor(code) {
    super(code);
    this.name = "ExecutionCapsuleRuntimeRolloutError";
    this.code = code;
    this.status = 409;
  }
}

export function evaluateExecutionCapsuleRuntimeRollout({
  metrics: rawMetrics,
  retirementPlan: rawPlan,
} = {}) {
  const metrics = normalizeMetrics(rawMetrics);
  const retirementPlan = normalizeRetirementPlan(rawPlan);
  const metricsDigest = assertMetricsDigestBinding(metrics, retirementPlan);
  const retirementPlanDigest = digestNormalizedRetirementPlan(retirementPlan);
  const failed = failedGates(metrics);
  return deepFreeze({
    status: failed.length === 0
      ? ExecutionCapsuleRuntimeRolloutStatus.READY
      : ExecutionCapsuleRuntimeRolloutStatus.BLOCKED,
    retirementReady: failed.length === 0,
    retirementApplied: false,
    failedGates: failed,
    metrics,
    metricsDigest,
    retirementPlan,
    retirementPlanDigest,
    runtimeAuthority: false,
    productionActivation: false,
    secretsIncluded: false,
  });
}

export function createExecutionCapsuleRuntimeRolloutGate({
  enabled = false,
  retireLegacyResolvers = null,
  emitTelemetry = null,
} = {}) {
  if (enabled === true && typeof retireLegacyResolvers !== "function") {
    throw new TypeError("retireLegacyResolvers must be a function when enabled.");
  }
  return Object.freeze({
    enabled: enabled === true,
    mode: enabled === true ? "execution_capsule_runtime_rollout" : "shadow_only",
    async execute({
      metrics: rawMetrics,
      retirementPlan: rawPlan,
      approval: rawApproval = null,
      applyRetirement = false,
    } = {}) {
      const evaluation = evaluateExecutionCapsuleRuntimeRollout({
        metrics: rawMetrics,
        retirementPlan: rawPlan,
      });
      if (
        evaluation.status === ExecutionCapsuleRuntimeRolloutStatus.BLOCKED ||
        enabled !== true ||
        applyRetirement !== true
      ) {
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_runtime_rollout",
          status: evaluation.status,
          retirementApplied: false,
          failedGateCount: evaluation.failedGates.length,
          runtimeAuthority: false,
          productionActivation: false,
          secretsIncluded: false,
        });
        return evaluation;
      }

      const approval = requireApproval(
        rawApproval,
        evaluation.retirementPlan,
        evaluation.retirementPlanDigest,
      );
      const rawResult = await retireLegacyResolvers(deepFreeze({
        retirementPlan: evaluation.retirementPlan,
        retirementPlanDigest: evaluation.retirementPlanDigest,
        approval,
      }));
      const retirementResult = projectRetirementResult(
        rawResult,
        evaluation.retirementPlan,
      );
      const retired = deepFreeze({
        ...evaluation,
        status: ExecutionCapsuleRuntimeRolloutStatus.RETIRED,
        retirementApplied: true,
        retirementResult,
      });
      await emitSafely(emitTelemetry, {
        eventType: "execution_capsule_runtime_rollout",
        status: retired.status,
        retirementApplied: true,
        failedGateCount: 0,
        runtimeAuthority: false,
        productionActivation: false,
        secretsIncluded: false,
      });
      return retired;
    },
    rollback() {
      return createExecutionCapsuleRuntimeRolloutGate({
        enabled: false,
        retireLegacyResolvers,
        emitTelemetry,
      });
    },
  });
}
