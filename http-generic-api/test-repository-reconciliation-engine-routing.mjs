import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildRepositoryReconciliationPlan,
  classifyRepositoryReconciliationStepExecution,
} from "./repositoryReconciliationOrchestrator.js";

const installed = classifyRepositoryReconciliationStepExecution({
  step_kind: "installed_tool_call",
  tool_key: "admin_branch_reconcile",
});
assert.equal(installed.route, "provider_tool");
assert.equal(installed.provider_dispatch_allowed, true);
assert.equal(installed.engine_owned, false);

for (const stepKind of ["classify", "engine_internal", "emit_evidence"]) {
  const route = classifyRepositoryReconciliationStepExecution({ step_kind: stepKind });
  assert.equal(route.provider_dispatch_allowed, false, `${stepKind} must never provider-dispatch`);
  assert.equal(route.engine_owned, true, `${stepKind} must stay engine-owned`);
}
assert.equal(
  classifyRepositoryReconciliationStepExecution({ step_kind: "unknown_kind" }).route,
  "blocked",
);

const input = {
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  branch: "gpt/reconciliation-example",
  defaultBranch: "main",
  pullNumber: 6913,
  expectedBaseSha: "a".repeat(40),
  expectedBranchSha: "b".repeat(40),
  raw: { plan_id: "routing-plan-1" },
};
const baseRecipe = {
  recipe_key: "repo.pr.reconcile_and_finalize",
  status: "planned",
  policy: {
    status: "planned",
    force_push_allowed: false,
    migration_apply_allowed: false,
    automatic_activation_allowed: false,
  },
  steps: [
    {
      step_order: 10,
      step_key: "acquire_branch_lease",
      step_kind: "classify",
      source_table: "repository_operation_leases",
      required: 1,
      status: "active",
    },
    {
      step_order: 20,
      step_key: "reconcile_branch",
      step_kind: "installed_tool_call",
      parent_action_key: "acquire_branch_lease",
      tool_key: "admin_branch_reconcile",
      body_template_json: { mode: "dry_run" },
      response_projection_json: {
        base_ref_sha: "evidence.base_ref_sha",
        branch_ref_sha: "evidence.branch_ref_sha",
      },
      required: 1,
      status: "active",
    },
    {
      step_order: 30,
      step_key: "build_resolution_commit",
      step_kind: "engine_internal",
      parent_action_key: "reconcile_branch",
      tool_key: "github_detached_resolution_commit_create",
      body_template_json: {
        engine_key: "repositoryDetachedResolutionBuilder",
        ref_update_allowed: false,
        force_push_allowed: false,
      },
      response_projection_json: {
        resolution_commit_sha: "resolution.commit_sha",
        resolution_tree_sha: "resolution.tree_sha",
      },
      required: 1,
      status: "active",
    },
    {
      step_order: 40,
      step_key: "create_merge_commit",
      step_kind: "engine_internal",
      parent_action_key: "build_resolution_commit",
      tool_key: "github_branch_merge_commit_create",
      body_template_json: {
        engine_key: "adminBranchReconciliationAdapter",
        resolution_commit_source_step: "build_resolution_commit",
        resolution_commit_source_path: "resolution.commit_sha",
        force_push_allowed: false,
      },
      response_projection_json: {
        merge_commit_sha: "commit.sha",
        branch_sha: "update.branch_sha",
      },
      required: 1,
      status: "active",
    },
    {
      step_order: 90,
      step_key: "emit_evidence",
      step_kind: "emit_evidence",
      parent_action_key: "release_branch_lease",
      source_table: "execution_log",
      required: 1,
      status: "active",
    },
  ],
};
const reconciliation = {
  classification: "diverged_same_files",
  ahead_by: 1,
  behind_by: 2,
  changed_files: ["http-generic-api/example.js"],
  base_ref_sha: input.expectedBaseSha,
  branch_ref_sha: input.expectedBranchSha,
};

const plan = buildRepositoryReconciliationPlan({
  input,
  recipe: baseRecipe,
  reconciliation,
  operationId: "routing-operation-1",
});
assert.equal(plan.plan.recipe_status, "planned");
assert.equal(plan.plan.dataflow.execution_enabled, false);
assert.equal(plan.plan.dataflow.execution_routes_bound, true);
assert.equal(plan.plan.dataflow.provider_dispatch_installed_tool_only, true);
assert.equal(plan.plan.force_push_allowed, false);
assert.equal(plan.plan.migration_apply_allowed, false);

const providerSteps = plan.steps.filter((step) => step.execution_route.provider_dispatch_allowed);
assert.deepEqual(providerSteps.map((step) => step.step_key), ["reconcile_branch"]);
for (const stepKey of ["acquire_branch_lease", "build_resolution_commit", "create_merge_commit", "emit_evidence"]) {
  const step = plan.steps.find((candidate) => candidate.step_key === stepKey);
  assert.equal(step.execution_route.provider_dispatch_allowed, false, `${stepKey} must remain off provider dispatch`);
}
assert.equal(
  plan.steps.find((step) => step.step_key === "build_resolution_commit")?.registry?.response_projection,
  undefined,
);
assert.equal(
  plan.steps.find((step) => step.step_key === "build_resolution_commit")?.execution_contract?.registry?.response_projection?.resolution_commit_sha,
  "resolution.commit_sha",
);

const parentDriftRecipe = structuredClone(baseRecipe);
parentDriftRecipe.steps.find((step) => step.step_key === "create_merge_commit").parent_action_key = "reconcile_branch";
const parentDriftPlan = buildRepositoryReconciliationPlan({
  input,
  recipe: parentDriftRecipe,
  reconciliation,
  operationId: "routing-operation-1",
});
assert.notEqual(parentDriftPlan.plan_sha256, plan.plan_sha256, "parent binding drift must change plan hash");

const projectionDriftRecipe = structuredClone(baseRecipe);
projectionDriftRecipe.steps.find((step) => step.step_key === "build_resolution_commit").response_projection_json = {
  resolution_commit_sha: "resolution.tree_sha",
};
const projectionDriftPlan = buildRepositoryReconciliationPlan({
  input,
  recipe: projectionDriftRecipe,
  reconciliation,
  operationId: "routing-operation-1",
});
assert.notEqual(projectionDriftPlan.plan_sha256, plan.plan_sha256, "projection drift must change plan hash");

const migration = fs.readFileSync(new URL("./migrations/1026_sprint69_repository_reconciliation_automation.sql", import.meta.url), "utf8");
assert.match(migration, /'build_resolution_commit','engine_internal','reconcile_branch','github_detached_resolution_commit_create'/);
assert.match(migration, /'create_merge_commit','engine_internal','build_resolution_commit','github_branch_merge_commit_create'/);
assert.match(migration, /'resolution_commit_source_step','build_resolution_commit'/);
assert.match(migration, /'resolution_commit_source_path'\s*,\s*'resolution\.commit_sha'/);
assert.doesNotMatch(migration, /'build_resolution_commit','installed_tool_call','repo_patch_batch_apply'/);
assert.match(migration, /'automatic_activation_allowed',FALSE/);
assert.match(migration, /`status`='planned'/);

const adminRoutes = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.match(adminRoutes, /repository_reconciliation_admin_surface_dry_run_only/);

console.log("repository reconciliation engine routing tests passed");
