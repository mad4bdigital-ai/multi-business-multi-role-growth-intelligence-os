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

export function buildContainerCanaryPromotionPlan({ canaries = [], targetCanaryKey, readiness } = {}) {
  const targetKey=String(targetCanaryKey || "").trim();
  if(!targetKey) throw Object.assign(new Error("targetCanaryKey is required."),{ code:"container_canary_key_required",status:422 });
  if(!readiness || String(readiness.readinessCode ?? readiness.readiness_code) !== "ready_for_review") {
    throw Object.assign(new Error("Container rollout readiness must be ready_for_review before canary promotion."),{
      code:"container_canary_readiness_required",status:409
    });
  }
  const active=(canaries || []).filter(row => String(row.status || "active") === "active");
  const target=active.find(row => String(row.canaryKey ?? row.canary_key) === targetKey);
  if(!target) throw Object.assign(new Error("Active canary candidate was not found."),{ code:"container_canary_not_found",status:404 });
  if(String(target.operationClass ?? target.operation_class ?? "") !== "read_only") {
    throw Object.assign(new Error("Only read-only capabilities may enter the first canary stage."),{
      code:"container_canary_operation_not_read_only",status:422
    });
  }
  const otherPromoted=active.filter(row =>
    String(row.canaryKey ?? row.canary_key) !== targetKey
    && String(row.rolloutMode ?? row.rollout_mode) === "read_only_canary"
  );
  if(otherPromoted.length) {
    throw Object.assign(new Error("Another read-only canary is already active; promote one capability at a time."),{
      code:"container_canary_promotion_in_progress",status:409,
      details:otherPromoted.map(row => ({ canaryKey:row.canaryKey ?? row.canary_key }))
    });
  }
  const currentMode=String(target.rolloutMode ?? target.rollout_mode ?? "shadow");
  const confirmation=`PROMOTE_DYNAMIC_CONTAINER_CANARY_${targetKey.replace(/[^A-Za-z0-9]+/g,"_").toUpperCase()}`;
  return {
    canaryKey:targetKey,
    capabilityKey:String(target.capabilityKey ?? target.capability_key ?? ""),
    currentMode,
    targetMode:"read_only_canary",
    noOp:currentMode === "read_only_canary",
    confirmation,
    actions:["lock_active_canary_rows","verify_rollout_readiness","promote_exact_canary","read_back_exact_canary"],
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    secretsIncluded:false
  };
}

export async function runContainerCanaryPromotion({
  executor,
  targetCanaryKey,
  policyKey = "dynamic_container_authority_v1",
  apply = false,
  confirm = null
} = {}) {
  if(!executor?.query) throw Object.assign(new Error("A SQL executor is required."),{ code:"container_canary_executor_required",status:500 });
  let transactionStarted=false;
  try {
    if(apply && executor.beginTransaction) {
      await executor.beginTransaction();
      transactionStarted=true;
    }
    const [canaryRows]=await executor.query(
      `SELECT canary_key,capability_key,operation_class,rollout_mode,status
         FROM container_shadow_canary_registry WHERE status='active' ORDER BY canary_key${apply ? " FOR UPDATE" : ""}`
    );
    const [readinessRows]=await executor.query(
      "SELECT policy_key,rollout_mode,readiness_code,audit_coverage_percent,maximum_mismatch_percent FROM v_container_rollout_readiness WHERE policy_key=? LIMIT 1",
      [policyKey]
    );
    const readiness=readinessRows?.[0];
    if(!readiness) throw Object.assign(new Error("Rollout readiness row was not found."),{ code:"container_rollout_readiness_not_found",status:404 });
    const plan=buildContainerCanaryPromotionPlan({ canaries:canaryRows,targetCanaryKey,readiness });
    if(!apply) return { ok:true,mode:"dry_run",plan,secretsIncluded:false };
    if(confirm !== plan.confirmation) {
      throw Object.assign(new Error(`Typed confirmation ${plan.confirmation} is required.`),{
        code:"container_canary_confirmation_required",status:409
      });
    }
    if(!plan.noOp) {
      await executor.query(
        `UPDATE container_shadow_canary_registry
            SET rollout_mode='read_only_canary',metadata_json=JSON_SET(COALESCE(metadata_json,JSON_OBJECT()),
                '$.promoted_after_readiness',TRUE,'$.promotion_policy_key',?),updated_at=CURRENT_TIMESTAMP
          WHERE canary_key=? AND status='active' AND operation_class='read_only' AND rollout_mode='shadow'`,
        [policyKey,plan.canaryKey]
      );
    }
    const [readbackRows]=await executor.query(
      "SELECT canary_key,capability_key,operation_class,rollout_mode,status FROM container_shadow_canary_registry WHERE canary_key=? LIMIT 1",
      [plan.canaryKey]
    );
    const readback=readbackRows?.[0];
    if(!readback || String(readback.rollout_mode) !== "read_only_canary") {
      throw Object.assign(new Error("Canary promotion readback did not match the target mode."),{
        code:"container_canary_readback_failed",status:409
      });
    }
    if(transactionStarted && executor.commit) await executor.commit();
    return { ok:true,mode:"apply",plan,readback,secretsIncluded:false };
  } catch(error) {
    if(transactionStarted && executor.rollback) await executor.rollback().catch(() => null);
    throw error;
  }
}

export function evaluateContainerBypassRetirementReadiness({
  rolloutReadiness,
  adoptionEvidence = {},
  activeBypassCount = 0,
  activeOverrideCount = 0
} = {}) {
  const rolloutMode=String(rolloutReadiness?.rolloutMode ?? rolloutReadiness?.rollout_mode ?? "shadow");
  const readinessCode=String(rolloutReadiness?.readinessCode ?? rolloutReadiness?.readiness_code ?? "unknown");
  const evidence=rolloutReadiness?.evidence || rolloutReadiness || {};
  const expectedCapabilityCount=Math.max(1,finiteNumber(adoptionEvidence.expectedCapabilityCount ?? adoptionEvidence.expected_capability_count,1));
  const adoptedCapabilityCount=finiteNumber(adoptionEvidence.adoptedCapabilityCount ?? adoptionEvidence.adopted_capability_count);
  const requiredReadyWindows=Math.max(1,finiteNumber(adoptionEvidence.requiredReadyWindows ?? adoptionEvidence.required_ready_windows,2));
  const consecutiveReadyWindows=finiteNumber(adoptionEvidence.consecutiveReadyWindows ?? adoptionEvidence.consecutive_ready_windows);
  const auditCoveragePercent=finiteNumber(evidence.auditCoveragePercent ?? evidence.audit_coverage_percent);
  const mismatchPercent=finiteNumber(evidence.mismatchPercent ?? evidence.maximum_mismatch_percent);
  const criticalMismatchCount=finiteNumber(evidence.criticalMismatchCount ?? evidence.critical_mismatch_count);
  let readiness="ready_to_retire_bypass";
  if(finiteNumber(activeBypassCount) < 1) readiness="no_bypass_present";
  else if(rolloutMode !== "enforced") readiness="enforcement_not_complete";
  else if(readinessCode !== "ready_for_review") readiness="rollout_not_ready";
  else if(adoptedCapabilityCount < expectedCapabilityCount) readiness="adoption_incomplete";
  else if(consecutiveReadyWindows < requiredReadyWindows) readiness="adoption_stability_window_incomplete";
  else if(auditCoveragePercent < 100) readiness="audit_coverage_below_required";
  else if(mismatchPercent > 0 || criticalMismatchCount > 0) readiness="mismatch_evidence_present";
  else if(finiteNumber(activeOverrideCount) > 0) readiness="active_overrides_present";
  return {
    readinessCode:readiness,
    readyToRetireBypass:readiness === "ready_to_retire_bypass",
    evidence:{
      rolloutMode,rolloutReadinessCode:readinessCode,
      expectedCapabilityCount,adoptedCapabilityCount,
      requiredReadyWindows,consecutiveReadyWindows,
      auditCoveragePercent,mismatchPercent,criticalMismatchCount,
      activeBypassCount:finiteNumber(activeBypassCount),
      activeOverrideCount:finiteNumber(activeOverrideCount)
    },
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    secretsIncluded:false
  };
}

export const _testingDynamicContainerRolloutSafety = { finiteNumber,normalizeMode };
