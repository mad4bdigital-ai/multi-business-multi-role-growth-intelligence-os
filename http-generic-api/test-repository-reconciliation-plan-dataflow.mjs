import assert from "node:assert/strict";
import { buildRepositoryReconciliationPlan } from "./repositoryReconciliationOrchestrator.js";

const operationId = "11111111-1111-4111-8111-111111111111";
const input = {
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  branch: "gpt/example",
  defaultBranch: "main",
  pullNumber: 42,
  expectedBaseSha: "a".repeat(40),
  expectedBranchSha: "b".repeat(40),
  mode: "dry_run",
  raw: {},
};
const reconciliation = {
  classification: "diverged_same_files",
  risk: "high",
  base_ref_sha: input.expectedBaseSha,
  branch_ref_sha: input.expectedBranchSha,
  changed_files: ["a.js"],
  overlapping_files: ["a.js"],
};
const recipe = {
  recipe_key: "repo.pr.reconcile_and_finalize",
  status: "planned",
  policy: { force_push_allowed: false, migration_apply_allowed: false },
  steps: [
    {
      step_order: 20,
      step_key: "reconcile_branch",
      step_kind: "installed_tool_call",
      tool_key: "admin_branch_reconcile",
      body_template_json: JSON.stringify({ mode: "dry_run" }),
      response_projection_json: JSON.stringify({ include: ["classification", "evidence"] }),
      required: 1,
      on_error_policy: "fail",
      status: "active",
    },
    {
      step_order: 40,
      step_key: "create_merge_commit",
      step_kind: "installed_tool_call",
      parent_action_key: "build_resolution_commit",
      tool_key: "github_branch_merge_commit_create",
      body_template_json: JSON.stringify({ force: false, recipe_key: "repo.pr.reconcile_and_finalize" }),
      response_projection_json: JSON.stringify({ include: ["commit", "update", "verification"] }),
      required: 1,
      on_error_policy: "fail",
      status: "active",
    },
  ],
};

const plan = buildRepositoryReconciliationPlan({ input, recipe, reconciliation, operationId });
assert.equal(plan.plan.dataflow.version, "repository-reconciliation-step-dataflow-v1");
assert.equal(plan.plan.dataflow.registry_templates_bound, true);
assert.equal(plan.plan.dataflow.sequential_predecessors_bound, true);
assert.equal(plan.plan.dataflow.execution_enabled, false);
assert.equal(plan.steps.length, 2);
assert.equal(plan.steps[0].execution_contract.resource.expected_base_sha, input.expectedBaseSha);
assert.equal(plan.steps[0].execution_contract.resource.expected_branch_sha, input.expectedBranchSha);
assert.deepEqual(plan.steps[0].execution_contract.registry.body_template, { mode: "dry_run" });
assert.deepEqual(plan.steps[0].execution_contract.registry.response_projection, { include: ["classification", "evidence"] });
assert.equal(plan.steps[1].execution_contract.dataflow.predecessor_step_key, "reconcile_branch");
assert.equal(plan.steps[1].execution_contract.dataflow.parent_action_key, "build_resolution_commit");
assert.equal(plan.steps[1].execution_contract.force_push_allowed, false);
assert.equal(plan.steps[1].execution_contract.migration_apply_allowed, false);
assert.equal(plan.steps[1].execution_contract.execution_enabled, false);
assert.match(plan.steps[0].execution_contract_sha256, /^[0-9a-f]{64}$/);
assert.match(plan.steps[1].execution_contract_sha256, /^[0-9a-f]{64}$/);

const changedBodyPlan = buildRepositoryReconciliationPlan({
  input,
  reconciliation,
  operationId,
  recipe: {
    ...recipe,
    steps: recipe.steps.map((step) => step.step_key === "create_merge_commit"
      ? { ...step, body_template_json: JSON.stringify({ force: true, recipe_key: "repo.pr.reconcile_and_finalize" }) }
      : step),
  },
});
assert.notEqual(changedBodyPlan.plan_sha256, plan.plan_sha256);
assert.notEqual(changedBodyPlan.steps[1].execution_contract_sha256, plan.steps[1].execution_contract_sha256);

const changedProjectionPlan = buildRepositoryReconciliationPlan({
  input,
  reconciliation,
  operationId,
  recipe: {
    ...recipe,
    steps: recipe.steps.map((step) => step.step_key === "create_merge_commit"
      ? { ...step, response_projection_json: JSON.stringify({ include: ["commit"] }) }
      : step),
  },
});
assert.notEqual(changedProjectionPlan.plan_sha256, plan.plan_sha256);

const changedHeadPlan = buildRepositoryReconciliationPlan({
  input: { ...input, expectedBranchSha: "c".repeat(40) },
  recipe,
  reconciliation: { ...reconciliation, branch_ref_sha: "c".repeat(40) },
  operationId,
});
assert.notEqual(changedHeadPlan.plan_sha256, plan.plan_sha256);
assert.equal(changedHeadPlan.steps[0].execution_contract.resource.expected_branch_sha, "c".repeat(40));

console.log(JSON.stringify({
  ok: true,
  contract: "repository_reconciliation_plan_dataflow_binding",
  proves: [
    "registry_templates_bound",
    "response_projection_bound",
    "sequential_predecessor_bound",
    "exact_resource_identity_bound",
    "execution_remains_disabled",
  ],
  secrets_included: false,
}));
