function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeMode(value) {
  const normalized = String(value || "shadow").trim().toLowerCase();
  if (!new Set(["disabled","shadow","read_only_canary","bounded_mutation","enforced"]).has(normalized)) {
    throw Object.assign(new Error("Unsupported rollout mode."), { code:"container_rollout_mode_invalid",status:422 });
  }
  return normalized;
}

export function nearestRankPercentile(values, percentile) {
  const clean = (values || []).map(Number).filter(Number.isFinite).sort((a,b) => a-b);
  if (!clean.length) return 0;
  const bounded = Math.max(0,Math.min(1,Number(percentile)));
  const rank = Math.max(1,Math.ceil(bounded * clean.length));
  return clean[Math.min(clean.length - 1,rank - 1)];
}

export function summarizeResolutionPerformance(samples, { mode = "shadow" } = {}) {
  const matching = (samples || []).filter(sample => String(sample.mode || "shadow") === mode);
  const durations = matching.map(sample => finiteNumber(sample.durationMs ?? sample.duration_ms)).filter(value => value >= 0);
  const average = durations.length ? durations.reduce((sum,value) => sum + value,0) / durations.length : 0;
  return {
    mode,
    sampleCount:durations.length,
    averageLatencyMs:Number(average.toFixed(3)),
    p95LatencyMs:Number(nearestRankPercentile(durations,0.95).toFixed(3)),
    p99LatencyMs:Number(nearestRankPercentile(durations,0.99).toFixed(3)),
    withinBudgetCount:matching.filter(sample => Boolean(sample.withinBudget ?? sample.within_budget)).length
  };
}

export function summarizeAuditCoverage(comparisons, ledgerRows) {
  const ledger = new Map((ledgerRows || []).map(row => [String(row.resolutionId ?? row.resolution_id),row]));
  let audited = 0;
  for (const comparison of comparisons || []) {
    const row = ledger.get(String(comparison.resolutionId ?? comparison.resolution_id));
    if (
      row
      && String(row.mode) === "shadow"
      && !Boolean(row.providerCallMade ?? row.provider_call_made)
      && !Boolean(row.credentialPayloadRead ?? row.credential_payload_read)
      && !Boolean(row.secretsIncluded ?? row.secrets_included)
      && !Boolean(comparison.secretsIncluded ?? comparison.secrets_included)
    ) audited += 1;
  }
  const total = (comparisons || []).length;
  return {
    comparisonSampleCount:total,
    auditedSampleCount:audited,
    auditCoveragePercent:total ? Number(((100 * audited) / total).toFixed(4)) : 0
  };
}

export function evaluateContainerRolloutReadiness({
  policy,
  comparisonSampleCount = 0,
  mismatchPercent = 0,
  criticalMismatchCount = 0,
  performanceSummary = {},
  auditSummary = {},
  relationshipIssueCount = 0,
  highRiskProjectionIssueCount = 0
} = {}) {
  if (!policy) throw Object.assign(new Error("Rollout policy is required."),{ code:"container_rollout_policy_required",status:422 });
  const rolloutMode = normalizeMode(policy.rolloutMode ?? policy.rollout_mode);
  const minimumSampleCount = finiteNumber(policy.minimumSampleCount ?? policy.minimum_sample_count,100);
  const mismatchThresholdPercent = finiteNumber(policy.mismatchThresholdPercent ?? policy.mismatch_threshold_percent,0.5);
  const criticalMismatchThreshold = finiteNumber(policy.criticalMismatchThreshold ?? policy.critical_mismatch_threshold,0);
  const p95BudgetMs = finiteNumber(policy.p95BudgetMs ?? policy.p95_budget_ms,150);
  const p99BudgetMs = finiteNumber(policy.p99BudgetMs ?? policy.p99_budget_ms,400);
  const auditCoverageRequiredPercent = finiteNumber(policy.auditCoverageRequiredPercent ?? policy.audit_coverage_required_percent,100);
  const performanceSampleCount = finiteNumber(performanceSummary.sampleCount ?? performanceSummary.sample_count);
  const p95LatencyMs = finiteNumber(performanceSummary.p95LatencyMs ?? performanceSummary.p95_latency_ms);
  const p99LatencyMs = finiteNumber(performanceSummary.p99LatencyMs ?? performanceSummary.p99_latency_ms);
  const auditCoveragePercent = finiteNumber(auditSummary.auditCoveragePercent ?? auditSummary.audit_coverage_percent);

  let readinessCode = "ready_for_review";
  if (rolloutMode === "disabled") readinessCode = "disabled";
  else if (finiteNumber(comparisonSampleCount) < minimumSampleCount) readinessCode = "insufficient_samples";
  else if (performanceSampleCount < minimumSampleCount) readinessCode = "insufficient_performance_samples";
  else if (finiteNumber(mismatchPercent) > mismatchThresholdPercent) readinessCode = "mismatch_threshold_exceeded";
  else if (finiteNumber(criticalMismatchCount) > criticalMismatchThreshold) readinessCode = "critical_mismatch_threshold_exceeded";
  else if (p95LatencyMs > p95BudgetMs) readinessCode = "p95_latency_budget_exceeded";
  else if (p99LatencyMs > p99BudgetMs) readinessCode = "p99_latency_budget_exceeded";
  else if (auditCoveragePercent < auditCoverageRequiredPercent) readinessCode = "audit_coverage_below_required";
  else if (finiteNumber(relationshipIssueCount) > 0) readinessCode = "relationship_issues_present";
  else if (finiteNumber(highRiskProjectionIssueCount) > 0) readinessCode = "projection_issues_present";

  return {
    rolloutMode,
    readinessCode,
    readyForReview:readinessCode === "ready_for_review",
    enforcementRequested:!["disabled","shadow"].includes(rolloutMode),
    evidence:{
      comparisonSampleCount:finiteNumber(comparisonSampleCount),
      mismatchPercent:finiteNumber(mismatchPercent),
      criticalMismatchCount:finiteNumber(criticalMismatchCount),
      performanceSampleCount,p95LatencyMs,p99LatencyMs,auditCoveragePercent,
      relationshipIssueCount:finiteNumber(relationshipIssueCount),
      highRiskProjectionIssueCount:finiteNumber(highRiskProjectionIssueCount)
    },
    secretsIncluded:false
  };
}

export function buildContainerRollbackPlan(policy, { reason = "rollback_drill" } = {}) {
  if (!policy) throw Object.assign(new Error("Rollout policy is required."),{ code:"container_rollout_policy_required",status:422 });
  const policyKey = String(policy.policyKey ?? policy.policy_key ?? "dynamic_container_authority_v1");
  const currentMode = normalizeMode(policy.rolloutMode ?? policy.rollout_mode);
  const rollbackMode = String(policy.rollbackMode ?? policy.rollback_mode ?? "return_to_shadow");
  const targetMode = rollbackMode === "disable_consumers" ? "disabled" : "shadow";
  const confirmation = `ROLLBACK_DYNAMIC_CONTAINER_AUTHORITY_TO_${targetMode.toUpperCase()}`;
  return {
    policyKey,currentMode,targetMode,rollbackMode,reason,
    noOp:currentMode === targetMode,
    confirmation,
    actions:[
      "lock_rollout_policy_row",
      `set_rollout_mode_${targetMode}`,
      "disable_enforcement_and_provider_writes",
      "read_back_rollout_policy",
      "preserve_resolution_and_override_evidence"
    ],
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    destructiveSchemaChanges:false,
    secretsIncluded:false
  };
}

export async function runContainerRollbackDrill({
  executor,
  policyKey = "dynamic_container_authority_v1",
  apply = false,
  confirm = null,
  reason = "rollback_drill",
  actor = "dynamic_container_rollback_drill"
} = {}) {
  if (!executor?.query) throw Object.assign(new Error("A SQL executor is required."),{ code:"container_rollback_executor_required",status:500 });
  const readSql = `SELECT policy_key,rollout_mode,rollback_mode,status,metadata_json
    FROM container_rollout_policy_registry WHERE policy_key=? LIMIT 1${apply ? " FOR UPDATE" : ""}`;
  let transactionStarted = false;
  try {
    if (apply && executor.beginTransaction) {
      await executor.beginTransaction();
      transactionStarted = true;
    }
    const [rows] = await executor.query(readSql,[policyKey]);
    const policy = rows?.[0];
    if (!policy || policy.status !== "active") {
      throw Object.assign(new Error("Active rollout policy was not found."),{ code:"container_rollout_policy_not_found",status:404 });
    }
    const plan = buildContainerRollbackPlan(policy,{ reason });
    if (!apply) return { ok:true,mode:"dry_run",plan,secretsIncluded:false };
    if (confirm !== plan.confirmation) {
      throw Object.assign(new Error(`Typed confirmation ${plan.confirmation} is required.`),{ code:"container_rollback_confirmation_required",status:409 });
    }
    await executor.query(
      `UPDATE container_rollout_policy_registry
          SET rollout_mode=?,metadata_json=JSON_SET(COALESCE(metadata_json,JSON_OBJECT()),
              '$.enforcement_enabled',FALSE,'$.provider_writes_enabled',FALSE,
              '$.last_rollback_reason',?,'$.last_rollback_actor',?),updated_at=CURRENT_TIMESTAMP
        WHERE policy_key=? AND status='active'`,
      [plan.targetMode,reason,actor,policyKey]
    );
    const [readbackRows] = await executor.query(
      "SELECT policy_key,rollout_mode,rollback_mode,status,metadata_json FROM container_rollout_policy_registry WHERE policy_key=? LIMIT 1",
      [policyKey]
    );
    const readback = readbackRows?.[0];
    if (!readback || String(readback.rollout_mode) !== plan.targetMode) {
      throw Object.assign(new Error("Rollback readback did not match the target mode."),{ code:"container_rollback_readback_failed",status:409 });
    }
    if (transactionStarted && executor.commit) await executor.commit();
    return { ok:true,mode:"apply",plan,readback,secretsIncluded:false };
  } catch (error) {
    if (transactionStarted && executor.rollback) await executor.rollback().catch(() => null);
    throw error;
  }
}

export const _testingDynamicContainerRolloutSafety = { finiteNumber,normalizeMode };
