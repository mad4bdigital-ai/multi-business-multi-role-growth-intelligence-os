import assert from "node:assert/strict";
import {
  assessRuntimeBreakGlassFollowupTransition,
  requiredBreakGlassFollowupConfirmation,
} from "./runtimeBreakGlassReconciliationClosure.js";

const breakGlassId = "11111111-1111-4111-8111-111111111111";
const mainSha = "a".repeat(40);
const productionSha = "b".repeat(40);
const planSha = "c".repeat(64);
const confirm = (state) => requiredBreakGlassFollowupConfirmation(breakGlassId, state);

const mainCommitted = assessRuntimeBreakGlassFollowupTransition({
  incident: { break_glass_id: breakGlassId, lifecycle_state: "RECONCILING" },
  to_state: "MAIN_COMMITTED",
  confirm: confirm("MAIN_COMMITTED"),
  evidence: {
    main_commit_sha: mainSha,
    repository_reconciliation_plan_id: "plan-1",
    repository_reconciliation_plan_sha256: planSha,
    repository_reconciliation_pr_number: 7000,
    repository_reconciliation_readback_verified: true,
  },
});
assert.equal(mainCommitted.ready, true);
assert.equal(mainCommitted.update.main_commit_sha, mainSha);

const staging = assessRuntimeBreakGlassFollowupTransition({
  incident: { break_glass_id: breakGlassId, lifecycle_state: "MAIN_COMMITTED", main_commit_sha: mainSha },
  to_state: "STAGING_VERIFIED",
  confirm: confirm("STAGING_VERIFIED"),
  evidence: { staging_commit_sha: mainSha, staging_verified: true, required_checks_complete: true },
});
assert.equal(staging.ready, true);

const badStaging = assessRuntimeBreakGlassFollowupTransition({
  incident: { break_glass_id: breakGlassId, lifecycle_state: "MAIN_COMMITTED", main_commit_sha: mainSha },
  to_state: "STAGING_VERIFIED",
  confirm: confirm("STAGING_VERIFIED"),
  evidence: { staging_commit_sha: "d".repeat(40), staging_verified: true, required_checks_complete: true },
});
assert.equal(badStaging.ready, false);
assert.equal(badStaging.reason_code, "break_glass_staging_verification_incomplete");

const promoted = assessRuntimeBreakGlassFollowupTransition({
  incident: { break_glass_id: breakGlassId, lifecycle_state: "STAGING_VERIFIED", main_commit_sha: mainSha },
  to_state: "PRODUCTION_PROMOTED",
  confirm: confirm("PRODUCTION_PROMOTED"),
  evidence: {
    promotion_source_main_sha: mainSha,
    production_commit_sha: productionSha,
    production_promotion_verified: true,
    production_promotion_authorization_id: "promotion-auth-1",
  },
});
assert.equal(promoted.ready, true);

const redeployed = assessRuntimeBreakGlassFollowupTransition({
  incident: { break_glass_id: breakGlassId, lifecycle_state: "PRODUCTION_PROMOTED", production_commit_sha: productionSha },
  to_state: "REDEPLOYED",
  confirm: confirm("REDEPLOYED"),
  evidence: { deployed_commit_sha: productionSha, deployment_verified: true, deployment_attestation_id: "22222222-2222-4222-8222-222222222222" },
});
assert.equal(redeployed.ready, true);

const clean = assessRuntimeBreakGlassFollowupTransition({
  incident: { break_glass_id: breakGlassId, lifecycle_state: "REDEPLOYED", production_commit_sha: productionSha },
  to_state: "CLEAN_READBACK",
  confirm: confirm("CLEAN_READBACK"),
  evidence: { runtime_commit_sha: productionSha, readback_verified: true, working_tree_clean: true, unapproved_local_change_count: 0 },
});
assert.equal(clean.ready, true);

const closeBlocked = assessRuntimeBreakGlassFollowupTransition({
  incident: { break_glass_id: breakGlassId, lifecycle_state: "CLEAN_READBACK", main_commit_sha: mainSha },
  to_state: "CLOSED",
  confirm: confirm("CLOSED"),
  evidence: { close_incident: true },
});
assert.equal(closeBlocked.ready, false);
assert.equal(closeBlocked.reason_code, "break_glass_reconciliation_incomplete");

const closeReady = assessRuntimeBreakGlassFollowupTransition({
  incident: {
    break_glass_id: breakGlassId,
    lifecycle_state: "CLEAN_READBACK",
    main_commit_sha: mainSha,
    staging_verified_at: new Date().toISOString(),
    production_commit_sha: productionSha,
    production_promoted_at: new Date().toISOString(),
    deployment_attestation_id: "22222222-2222-4222-8222-222222222222",
    redeployed_at: new Date().toISOString(),
    clean_readback_at: new Date().toISOString(),
    clean_runtime_readback_json: JSON.stringify({ readback_verified: true, working_tree_clean: true, unapproved_local_change_count: 0, runtime_integrity_state: "verified_clean" }),
  },
  to_state: "CLOSED",
  confirm: confirm("CLOSED"),
  evidence: { close_incident: true },
});
assert.equal(closeReady.ready, true);
assert.match(closeReady.update.closure_evidence_sha256, /^[0-9a-f]{64}$/);

console.log("runtime break-glass reconciliation closure tests passed");
