import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runRepositoryReconciliationOrchestrator } from "./repositoryReconciliationOrchestrator.js";
import { repositoryReconciliationApplyConfirmation } from "./repositoryReconciliationAdminSurfaceLegacy.js";

const baseSha = "a".repeat(40);
const branchSha = "b".repeat(40);
let reconcileCalls = 0;
let executeStepCalls = 0;

const pool = {
  async query(sql) {
    if (sql.includes("FROM platform_resource_recipes")) {
      return [[{
        recipe_key: "repo.pr.reconcile_and_finalize",
        resource_type: "repository",
        operation_key: "reconcile_and_finalize",
        adapter_key: "repository_reconciliation_orchestrator",
        risk_class: "high",
        mode: "write",
        requires_capability_envelope: 1,
        requires_typed_confirmation: 1,
        requires_same_cycle_readback: 1,
        policy_json: JSON.stringify({ orchestrator_lease_required: true, force_push_allowed: false }),
        engine_key: "repository_reconciliation_orchestrator",
        status: "active",
      }]];
    }
    if (sql.includes("FROM platform_resource_recipe_steps")) {
      return [[{
        step_order: 1,
        step_key: "branch_readback",
        step_kind: "installed_tool_call",
        parent_action_key: null,
        tool_key: "admin_branch_reconcile",
        endpoint_key: null,
        source_table: null,
        source_pk_template_json: null,
        query_template_json: null,
        body_template_json: null,
        response_projection_json: null,
        required: 1,
        on_error_policy: "halt",
        status: "active",
      }]];
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};

const result = await runRepositoryReconciliationOrchestrator({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  branch: "gpt/example",
  default_branch: "main",
  pull_number: 2859,
  expected_base_sha: baseSha,
  expected_branch_sha: branchSha,
  mode: "dry_run",
  operation_id: "orchestrator-test-run-0001",
}, {
  pool,
  randomUUID: () => "orchestrator-test-run-0001",
  reconcileBranch: async () => {
    reconcileCalls += 1;
    return {
      classification: "diverged_no_overlap",
      risk: "medium",
      ahead_by: 1,
      behind_by: 2,
      changed_files: ["a.js"],
      overlapping_files: [],
      evidence: { base_ref_sha: baseSha, branch_ref_sha: branchSha },
    };
  },
  executeStep: async () => {
    executeStepCalls += 1;
    throw new Error("dry-run must not execute recipe steps");
  },
});

assert.equal(reconcileCalls, 1);
assert.equal(executeStepCalls, 0);
assert.equal(result.ok, true);
assert.equal(result.mode, "dry_run");
assert.equal(result.apply_allowed, false);
assert.equal(result.apply_readiness.recipe_active, true);
assert.equal(result.apply_readiness.admin_apply_surface_exposed, false);
assert.equal(result.apply_readiness.provider_executor_implemented, false);
assert.equal(result.apply_readiness.engine_executor_implemented, false);
assert.ok(result.apply_readiness.blockers.includes("repository_reconciliation_admin_apply_surface_not_exposed"));
assert.ok(result.apply_readiness.blockers.includes("repository_reconciliation_engine_internal_executor_not_wired"));
assert.equal(result.plan.plan.recipe_key, "repo.pr.reconcile_and_finalize");
assert.equal(result.plan.plan.resource.expected_base_sha, baseSha);
assert.equal(result.plan.plan.resource.expected_branch_sha, branchSha);
assert.equal(result.plan.steps.length, 1);
assert.equal(result.plan.plan.force_push_allowed, false);
assert.equal(result.plan.plan.migration_apply_allowed, false);
assert.equal(result.secrets_included, false);
assert.equal(repositoryReconciliationApplyConfirmation("plan-123"), "APPLY_REPOSITORY_RECONCILIATION_PLAN_123");

await assert.rejects(
  () => runRepositoryReconciliationOrchestrator({
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
    branch: "gpt/example",
    default_branch: "main",
    pull_number: 2859,
    expected_base_sha: baseSha,
    expected_branch_sha: branchSha,
    mode: "dry_run",
  }, {
    pool,
    reconcileBranch: async () => ({
      classification: "diverged_no_overlap",
      evidence: { base_ref_sha: "c".repeat(40), branch_ref_sha: branchSha },
    }),
  }),
  (error) => error?.code === "repository_reconciliation_base_drift",
);

const routes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const adminSurface = readFileSync(new URL("./repositoryReconciliationAdminSurface.js", import.meta.url), "utf8");
const adminSurfaceLegacy = readFileSync(new URL("./repositoryReconciliationAdminSurfaceLegacy.js", import.meta.url), "utf8");
const orchestrator = readFileSync(new URL("./repositoryReconciliationOrchestrator.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260722_generalized_surface_callability_and_reconciliation_guard.sql", import.meta.url), "utf8");
const activation = readFileSync(new URL("./migrations/20260812_repository_reconciliation_admin_apply_activation.sql", import.meta.url), "utf8");

assert.equal((routes.match(/name: "repository_reconciliation_orchestrator"/g) || []).length, 1);
assert.match(routes, /runRepositoryReconciliationAdminSurface/);
assert.match(routes, /enum: \["dry_run", "apply"\]/);
assert.doesNotMatch(routes, /repository_reconciliation_admin_surface_dry_run_only/);
assert.match(adminSurface, /getGovernancePool/);
assert.match(adminSurface, /build_resolution_commit/);
assert.match(adminSurface, /create_merge_commit/);
assert.match(adminSurface, /finalize_pr/);
assert.match(adminSurface, /contextPlanSha/);
assert.match(adminSurface, /contextStepKey/);
assert.match(adminSurface, /acceptedCapabilityKeys: \["repo_patch_apply"\]/);
assert.match(adminSurfaceLegacy, /resolution_entries_sha256/);
assert.match(adminSurfaceLegacy, /authorizePlan/);
assert.match(adminSurfaceLegacy, /executeEngineStep/);
assert.match(adminSurfaceLegacy, /runGithubDetachedResolutionCommitCreate/);
assert.match(adminSurfaceLegacy, /runGithubBranchMergeCommitCreate/);
assert.match(adminSurfaceLegacy, /finalizeGithubPullRequest/);
assert.match(adminSurfaceLegacy, /force: false/);
assert.match(adminSurfaceLegacy, /force_push: false/);
assert.match(orchestrator, /acquireRepositoryOperationLease/);
assert.match(orchestrator, /assertRepositoryOperationLeaseHolder/);
assert.match(orchestrator, /releaseRepositoryOperationLease/);
const dryRunReturnIndex = orchestrator.indexOf('if (input.mode === "dry_run")');
const leaseAcquireIndex = orchestrator.indexOf("const lease = await acquireRepositoryOperationLease");
assert.ok(dryRunReturnIndex > -1 && leaseAcquireIndex > dryRunReturnIndex, "dry-run must return before lease acquisition");
assert.match(migration, /WHERE `recipe_key` = 'repo\.pr\.reconcile_and_finalize'/);
assert.match(migration, /'\$\.orchestrator_lease_required', TRUE/);
assert.match(migration, /'\$\.low_level_merge_without_lease_forbidden', TRUE/);
assert.match(migration, /'\$\.force_push_allowed', FALSE/);
assert.match(migration, /'\$\.protected_branch_direct_write_allowed', FALSE/);
assert.match(activation, /SET status='active'/);
assert.match(activation, /v_repository_reconciliation_apply_readiness/);
assert.match(activation, /'\$\.force_push_allowed', FALSE/);
assert.match(activation, /'\$\.per_step_plan_authority_required', TRUE/);

console.log("repository reconciliation orchestrator export tests passed");
