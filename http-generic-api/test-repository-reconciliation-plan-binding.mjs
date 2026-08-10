import assert from "node:assert/strict";
import {
  assertRepositoryReconciliationPlanBinding,
  buildRepositoryReconciliationPlan,
} from "./repositoryReconciliationOrchestrator.js";

const operationId = "11111111-1111-4111-8111-111111111111";
const baseInput = {
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
const recipe = {
  recipe_key: "repo.pr.reconcile_and_finalize",
  status: "active",
  policy: { force_push_allowed: false },
  steps: [
    {
      step_order: 1,
      step_key: "reconcile",
      step_kind: "installed_tool_call",
      tool_key: "github_branch_fast_forward_to_base",
      status: "active",
    },
  ],
};
const reconciliation = {
  classification: "behind_only",
  base_ref_sha: baseInput.expectedBaseSha,
  branch_ref_sha: baseInput.expectedBranchSha,
};

const dryRunPlan = buildRepositoryReconciliationPlan({
  input: baseInput,
  recipe,
  reconciliation,
  operationId,
});
assert.equal(dryRunPlan.plan.plan_id, dryRunPlan.plan_id);
assert.equal(dryRunPlan.plan.operation_id, operationId);
assert.match(dryRunPlan.plan_sha256, /^[0-9a-f]{64}$/);

const matchingApplyInput = {
  ...baseInput,
  mode: "apply",
  raw: {
    plan_id: dryRunPlan.plan_id,
    plan_sha256: dryRunPlan.plan_sha256,
  },
};
const matchingApplyPlan = buildRepositoryReconciliationPlan({
  input: matchingApplyInput,
  recipe,
  reconciliation,
  operationId,
});
assert.equal(matchingApplyPlan.plan_sha256, dryRunPlan.plan_sha256);
assert.deepEqual(
  assertRepositoryReconciliationPlanBinding({ input: matchingApplyInput, plan: matchingApplyPlan }),
  {
    ok: true,
    required: true,
    plan_id: dryRunPlan.plan_id,
    plan_sha256: dryRunPlan.plan_sha256,
    secrets_included: false,
  },
);

assert.throws(
  () => assertRepositoryReconciliationPlanBinding({
    input: { ...matchingApplyInput, raw: { plan_id: dryRunPlan.plan_id } },
    plan: matchingApplyPlan,
  }),
  (error) => error?.code === "repository_reconciliation_plan_binding_required" && error?.status === 400,
);

assert.throws(
  () => assertRepositoryReconciliationPlanBinding({
    input: {
      ...matchingApplyInput,
      raw: { plan_id: dryRunPlan.plan_id, plan_sha256: "0".repeat(64) },
    },
    plan: matchingApplyPlan,
  }),
  (error) => error?.code === "repository_reconciliation_plan_hash_mismatch" && error?.status === 409,
);

const driftedOperationPlan = buildRepositoryReconciliationPlan({
  input: matchingApplyInput,
  recipe,
  reconciliation,
  operationId: "22222222-2222-4222-8222-222222222222",
});
assert.notEqual(driftedOperationPlan.plan_sha256, dryRunPlan.plan_sha256);
assert.throws(
  () => assertRepositoryReconciliationPlanBinding({ input: matchingApplyInput, plan: driftedOperationPlan }),
  (error) => error?.code === "repository_reconciliation_plan_hash_mismatch",
);

const differentPlanIdInput = {
  ...matchingApplyInput,
  raw: { ...matchingApplyInput.raw, plan_id: "different-plan" },
};
const differentPlanIdPlan = buildRepositoryReconciliationPlan({
  input: differentPlanIdInput,
  recipe,
  reconciliation,
  operationId,
});
assert.notEqual(differentPlanIdPlan.plan_sha256, dryRunPlan.plan_sha256);

console.log(JSON.stringify({
  ok: true,
  contract: "repository_reconciliation_exact_plan_binding",
  negative_paths: ["missing_hash", "wrong_hash", "operation_drift", "plan_id_drift"],
  secrets_included: false,
}));
