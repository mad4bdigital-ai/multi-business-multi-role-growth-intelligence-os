import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nearestRankPercentile,
  summarizeResolutionPerformance,
  summarizeAuditCoverage,
  evaluateContainerRolloutReadiness,
  buildContainerRollbackPlan,
  runContainerRollbackDrill,
  buildContainerCanaryPromotionPlan,
  runContainerCanaryPromotion,
  evaluateContainerBypassRetirementReadiness
} from "./dynamicContainerRolloutSafety.js";

const policy = {
  policyKey:"dynamic_container_authority_v1",
  rolloutMode:"read_only_canary",
  mismatchThresholdPercent:0.5,
  criticalMismatchThreshold:0,
  p95BudgetMs:150,
  p99BudgetMs:400,
  auditCoverageRequiredPercent:100,
  minimumSampleCount:100,
  rollbackMode:"return_to_shadow"
};

assert.equal(nearestRankPercentile([],0.95),0);
assert.equal(nearestRankPercentile([5,1,4,3,2],0.95),5);
assert.equal(nearestRankPercentile([1,2,3,4,5],0.5),3);

const samples = Array.from({ length:100 },(_,index) => ({ mode:"shadow",durationMs:index + 1,withinBudget:index < 99 }));
const performance = summarizeResolutionPerformance(samples);
assert.deepEqual(performance,{ mode:"shadow",sampleCount:100,averageLatencyMs:50.5,p95LatencyMs:95,p99LatencyMs:99,withinBudgetCount:99 });

const comparisons = [
  { resolutionId:"resolution-1",secretsIncluded:false },
  { resolutionId:"resolution-2",secretsIncluded:false }
];
const completeLedger = [
  { resolutionId:"resolution-1",mode:"shadow",providerCallMade:false,credentialPayloadRead:false,secretsIncluded:false },
  { resolutionId:"resolution-2",mode:"shadow",providerCallMade:false,credentialPayloadRead:false,secretsIncluded:false }
];
assert.deepEqual(summarizeAuditCoverage(comparisons,completeLedger),{ comparisonSampleCount:2,auditedSampleCount:2,auditCoveragePercent:100 });
assert.equal(summarizeAuditCoverage(comparisons,completeLedger.slice(0,1)).auditCoveragePercent,50);

function readiness(overrides = {}) {
  return evaluateContainerRolloutReadiness({
    policy,comparisonSampleCount:100,mismatchPercent:0,criticalMismatchCount:0,
    performanceSummary:performance,auditSummary:{ auditCoveragePercent:100 },
    relationshipIssueCount:0,highRiskProjectionIssueCount:0,...overrides
  });
}

assert.equal(readiness().readinessCode,"ready_for_review");
assert.equal(readiness({ comparisonSampleCount:99 }).readinessCode,"insufficient_samples");
assert.equal(readiness({ performanceSummary:{ ...performance,sampleCount:99 } }).readinessCode,"insufficient_performance_samples");
assert.equal(readiness({ mismatchPercent:0.5001 }).readinessCode,"mismatch_threshold_exceeded");
assert.equal(readiness({ criticalMismatchCount:1 }).readinessCode,"critical_mismatch_threshold_exceeded");
assert.equal(readiness({ performanceSummary:{ ...performance,p95LatencyMs:151 } }).readinessCode,"p95_latency_budget_exceeded");
assert.equal(readiness({ performanceSummary:{ ...performance,p99LatencyMs:401 } }).readinessCode,"p99_latency_budget_exceeded");
assert.equal(readiness({ auditSummary:{ auditCoveragePercent:99.9999 } }).readinessCode,"audit_coverage_below_required");
assert.equal(readiness({ relationshipIssueCount:1 }).readinessCode,"relationship_issues_present");
assert.equal(readiness({ highRiskProjectionIssueCount:1 }).readinessCode,"projection_issues_present");
assert.equal(readiness({ policy:{ ...policy,rolloutMode:"disabled" } }).readinessCode,"disabled");
assert.throws(() => readiness({ policy:{ ...policy,rolloutMode:"unknown" } }),error => error.code === "container_rollout_mode_invalid" && error.status === 422);

const shadowPlan = buildContainerRollbackPlan({ policy_key:"dynamic_container_authority_v1",rollout_mode:"bounded_mutation",rollback_mode:"return_to_shadow" });
assert.equal(shadowPlan.targetMode,"shadow");
assert.equal(shadowPlan.confirmation,"ROLLBACK_DYNAMIC_CONTAINER_AUTHORITY_TO_SHADOW");
assert.equal(shadowPlan.providerCalls,false);
assert.equal(shadowPlan.credentialPayloadReads,false);
assert.equal(shadowPlan.externalWrites,false);
assert.equal(shadowPlan.destructiveSchemaChanges,false);

const disablePlan = buildContainerRollbackPlan({ policy_key:"dynamic_container_authority_v1",rollout_mode:"enforced",rollback_mode:"disable_consumers" });
assert.equal(disablePlan.targetMode,"disabled");
assert.equal(disablePlan.confirmation,"ROLLBACK_DYNAMIC_CONTAINER_AUTHORITY_TO_DISABLED");

function rollbackExecutor(initialMode = "bounded_mutation") {
  let mode = initialMode;
  const calls = [];
  let updateCount = 0;
  return {
    calls,
    get updateCount() { return updateCount; },
    beginTransaction:async () => calls.push("begin"),
    commit:async () => calls.push("commit"),
    rollback:async () => calls.push("rollback"),
    query:async (sql,params) => {
      calls.push(sql);
      if (sql.startsWith("SELECT")) return [[{ policy_key:"dynamic_container_authority_v1",rollout_mode:mode,rollback_mode:"return_to_shadow",status:"active",metadata_json:"{}" }]];
      if (sql.startsWith("UPDATE")) { mode=params[0]; updateCount += 1; return [{ affectedRows:1 }]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

const dryRunExecutor = rollbackExecutor();
const dryRun = await runContainerRollbackDrill({ executor:dryRunExecutor });
assert.equal(dryRun.mode,"dry_run");
assert.equal(dryRun.plan.targetMode,"shadow");
assert.equal(dryRunExecutor.updateCount,0);
assert(!dryRunExecutor.calls.includes("begin"));

const confirmationExecutor = rollbackExecutor();
await assert.rejects(runContainerRollbackDrill({ executor:confirmationExecutor,apply:true,confirm:"WRONG" }),error => error.code === "container_rollback_confirmation_required" && error.status === 409);
assert.deepEqual(confirmationExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","rollback"]);
assert.equal(confirmationExecutor.updateCount,0);

const applyExecutor = rollbackExecutor();
const applied = await runContainerRollbackDrill({ executor:applyExecutor,apply:true,confirm:"ROLLBACK_DYNAMIC_CONTAINER_AUTHORITY_TO_SHADOW",reason:"automated_spec_kit_rollback_drill" });
assert.equal(applied.mode,"apply");
assert.equal(applied.readback.rollout_mode,"shadow");
assert.equal(applyExecutor.updateCount,1);
assert.deepEqual(applyExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","commit"]);

const canaries = [
  { canary_key:"preview-resolution",capability_key:"createContainerContextResolution",operation_class:"read_only",rollout_mode:"shadow",status:"active" },
  { canary_key:"rollout-readiness",capability_key:"getContainerAuthorityRolloutReadiness",operation_class:"read_only",rollout_mode:"shadow",status:"active" }
];
const canaryReadiness={ policy_key:"dynamic_container_authority_v1",rollout_mode:"shadow",readiness_code:"ready_for_review",audit_coverage_percent:100,maximum_mismatch_percent:0 };
const promotionPlan=buildContainerCanaryPromotionPlan({ canaries,targetCanaryKey:"preview-resolution",readiness:canaryReadiness });
assert.equal(promotionPlan.targetMode,"read_only_canary");
assert.equal(promotionPlan.confirmation,"PROMOTE_DYNAMIC_CONTAINER_CANARY_PREVIEW_RESOLUTION");
assert.equal(promotionPlan.providerCalls,false);
assert.equal(promotionPlan.externalWrites,false);
assert.throws(
  () => buildContainerCanaryPromotionPlan({ canaries,targetCanaryKey:"preview-resolution",readiness:{ readiness_code:"insufficient_samples" } }),
  error => error.code === "container_canary_readiness_required" && error.status === 409
);
assert.throws(
  () => buildContainerCanaryPromotionPlan({
    canaries:[canaries[0],{ ...canaries[1],rollout_mode:"read_only_canary" }],
    targetCanaryKey:"preview-resolution",
    readiness:canaryReadiness
  }),
  error => error.code === "container_canary_promotion_in_progress" && error.status === 409
);
assert.throws(
  () => buildContainerCanaryPromotionPlan({
    canaries:[{ ...canaries[0],operation_class:"mutation" }],
    targetCanaryKey:"preview-resolution",
    readiness:canaryReadiness
  }),
  error => error.code === "container_canary_operation_not_read_only" && error.status === 422
);

function canaryExecutor() {
  let mode="shadow";
  let updateCount=0;
  const calls=[];
  return {
    calls,
    get updateCount() { return updateCount; },
    beginTransaction:async () => calls.push("begin"),
    commit:async () => calls.push("commit"),
    rollback:async () => calls.push("rollback"),
    query:async (sql) => {
      calls.push(sql);
      if(sql.includes("FROM container_shadow_canary_registry WHERE status='active'")) {
        return [[{ ...canaries[0],rollout_mode:mode },canaries[1]]];
      }
      if(sql.includes("FROM v_container_rollout_readiness")) return [[canaryReadiness]];
      if(sql.startsWith("UPDATE container_shadow_canary_registry")) {
        mode="read_only_canary";
        updateCount += 1;
        return [{ affectedRows:1 }];
      }
      if(sql.includes("FROM container_shadow_canary_registry WHERE canary_key=?")) {
        return [[{ ...canaries[0],rollout_mode:mode }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

const canaryDryRunExecutor=canaryExecutor();
const canaryDryRun=await runContainerCanaryPromotion({ executor:canaryDryRunExecutor,targetCanaryKey:"preview-resolution" });
assert.equal(canaryDryRun.mode,"dry_run");
assert.equal(canaryDryRunExecutor.updateCount,0);
assert(!canaryDryRunExecutor.calls.includes("begin"));

const canaryWrongConfirmExecutor=canaryExecutor();
await assert.rejects(
  runContainerCanaryPromotion({ executor:canaryWrongConfirmExecutor,targetCanaryKey:"preview-resolution",apply:true,confirm:"WRONG" }),
  error => error.code === "container_canary_confirmation_required" && error.status === 409
);
assert.deepEqual(canaryWrongConfirmExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","rollback"]);
assert.equal(canaryWrongConfirmExecutor.updateCount,0);

const canaryApplyExecutor=canaryExecutor();
const canaryApplied=await runContainerCanaryPromotion({
  executor:canaryApplyExecutor,
  targetCanaryKey:"preview-resolution",
  apply:true,
  confirm:"PROMOTE_DYNAMIC_CONTAINER_CANARY_PREVIEW_RESOLUTION"
});
assert.equal(canaryApplied.mode,"apply");
assert.equal(canaryApplied.readback.rollout_mode,"read_only_canary");
assert.equal(canaryApplyExecutor.updateCount,1);
assert.deepEqual(canaryApplyExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","commit"]);

const enforcedReady={
  rolloutMode:"enforced",
  readinessCode:"ready_for_review",
  evidence:{ auditCoveragePercent:100,mismatchPercent:0,criticalMismatchCount:0 }
};
const completeAdoption={ expectedCapabilityCount:2,adoptedCapabilityCount:2,requiredReadyWindows:2,consecutiveReadyWindows:2 };
const bypassReady=evaluateContainerBypassRetirementReadiness({
  rolloutReadiness:enforcedReady,
  adoptionEvidence:completeAdoption,
  activeBypassCount:1,
  activeOverrideCount:0
});
assert.equal(bypassReady.readinessCode,"ready_to_retire_bypass");
assert.equal(bypassReady.readyToRetireBypass,true);
assert.equal(evaluateContainerBypassRetirementReadiness({ rolloutReadiness:{ ...enforcedReady,rolloutMode:"shadow" },adoptionEvidence:completeAdoption,activeBypassCount:1 }).readinessCode,"enforcement_not_complete");
assert.equal(evaluateContainerBypassRetirementReadiness({ rolloutReadiness:enforcedReady,adoptionEvidence:{ ...completeAdoption,adoptedCapabilityCount:1 },activeBypassCount:1 }).readinessCode,"adoption_incomplete");
assert.equal(evaluateContainerBypassRetirementReadiness({ rolloutReadiness:enforcedReady,adoptionEvidence:{ ...completeAdoption,consecutiveReadyWindows:1 },activeBypassCount:1 }).readinessCode,"adoption_stability_window_incomplete");
assert.equal(evaluateContainerBypassRetirementReadiness({ rolloutReadiness:{ ...enforcedReady,evidence:{ ...enforcedReady.evidence,auditCoveragePercent:99.9 } },adoptionEvidence:completeAdoption,activeBypassCount:1 }).readinessCode,"audit_coverage_below_required");
assert.equal(evaluateContainerBypassRetirementReadiness({ rolloutReadiness:{ ...enforcedReady,evidence:{ ...enforcedReady.evidence,mismatchPercent:0.01 } },adoptionEvidence:completeAdoption,activeBypassCount:1 }).readinessCode,"mismatch_evidence_present");
assert.equal(evaluateContainerBypassRetirementReadiness({ rolloutReadiness:enforcedReady,adoptionEvidence:completeAdoption,activeBypassCount:1,activeOverrideCount:1 }).readinessCode,"active_overrides_present");
assert.equal(evaluateContainerBypassRetirementReadiness({ rolloutReadiness:enforcedReady,adoptionEvidence:completeAdoption,activeBypassCount:0 }).readinessCode,"no_bypass_present");

const migration319 = readFileSync(new URL("./migrations/319_sprint69_dynamic_container_authority_foundation.sql",import.meta.url),"utf8");
const migration320 = readFileSync(new URL("./migrations/320_sprint69_dynamic_container_authority_runtime_contracts.sql",import.meta.url),"utf8");
const openapi = readFileSync(new URL("./openapi/container-authority.yaml",import.meta.url),"utf8");
const repository = readFileSync(new URL("./dynamicContainerAuthorityRepository.js",import.meta.url),"utf8");
const projection = readFileSync(new URL("./dynamicContainerProjectionService.js",import.meta.url),"utf8");

for (const indexName of ["idx_cr_tenant_from_status","idx_cr_tenant_to_status","idx_cc_descendant_depth","idx_cra_principal_status","idx_cra_container_status","idx_crb_container_dimension_status","idx_crb_tenant_resource_status","idx_crb_effect_validity"]) assert.match(migration319,new RegExp(indexName));
for (const indexName of ["idx_cecl_tenant_target_created","idx_csc_tenant_status_created","idx_crps_mode_created","idx_crps_tenant_duration"]) assert.match(migration320,new RegExp(indexName));

assert.match(repository,/FROM container_relationships/);
assert.match(repository,/FROM container_role_assignments/);
assert.match(repository,/FROM container_resource_bindings/);
assert.match(migration320,/CREATE OR REPLACE VIEW `v_container_resolution_performance_summary`/);
assert.match(migration320,/PERCENT_RANK\(\) OVER \(PARTITION BY mode ORDER BY duration_ms\)/);
assert.match(migration320,/CREATE OR REPLACE VIEW `v_container_audit_coverage`/);
assert.match(migration320,/p95_latency_budget_exceeded/);
assert.match(migration320,/p99_latency_budget_exceeded/);
assert.match(migration320,/audit_coverage_below_required/);
assert.match(migration320,/critical_mismatch_threshold_exceeded/);

assert.match(projection,/INSERT INTO platform_graph_nodes/);
assert.match(projection,/INSERT INTO platform_graph_edges/);
assert.match(projection,/'projection_only'/);
assert.match(projection,/'context_only'/);
assert.match(projection,/runtime_role,runtime_enforced/);
assert.match(projection,/'context_only',0/);
assert.doesNotMatch(projection,/authority_status='authoritative'/);

console.log("dynamic container rollout safety, rollback, query-index, and graph projection contracts passed");
