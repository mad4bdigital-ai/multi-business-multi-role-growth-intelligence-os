import assert from "node:assert/strict";
import {
  SPEC011_MANAGED_DELIVERY_VERSION,
  buildManagedDeliveryPlan,
  classifyDelegatedCiRepair,
  createMergeApprovalBinding,
  deriveBaseSynchronizationPlan,
  executeManagedDeliveryOperation,
  normalizeSemanticPatchIntent,
  previewManagedDeliveryOperation,
  validateManagedDeliveryReceipts,
  verifyMergeApprovalBinding,
} from "./spec011ManagedDeliveryLifecycle.js";

const BASE_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const MERGE_C = "c".repeat(40);
const BASE_D = "d".repeat(40);
const HEAD_E = "e".repeat(40);
const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const HASH_3 = "3".repeat(64);

function patchIntent() {
  return {
    intent_key: "phase6-managed-delivery",
    files: [
      {
        path: "http-generic-api/example.js",
        action: "replace",
        content_sha256: HASH_1,
        anchor: {
          kind: "symbol",
          value: "export function example",
          occurrence: 1,
          expected_context_sha256: HASH_2,
        },
      },
      {
        path: "docs/example.md",
        action: "create_file",
        content_sha256: HASH_3,
      },
    ],
  };
}

function baseInput(overrides = {}) {
  return {
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
    pull_number: 6000,
    branch: "gpt/spec011-phase6-example",
    default_branch: "main",
    expected_head_sha: HEAD_B,
    expected_base_sha: BASE_A,
    idempotency_key: "spec011-phase6-test",
    patch_intent: patchIntent(),
    ...overrides,
  };
}

const normalizedPatch = normalizeSemanticPatchIntent(patchIntent());
assert.equal(normalizedPatch.semantic_only, true);
assert.equal(normalizedPatch.line_number_anchors_allowed, false);
assert.match(normalizedPatch.intent_sha256, /^[0-9a-f]{64}$/);
assert.equal(normalizedPatch.files[0].path, "docs/example.md");
assert.equal(normalizedPatch.files[1].anchor.kind, "symbol");

assert.throws(
  () => normalizeSemanticPatchIntent({
    files: [{
      path: "src/a.js",
      action: "replace",
      content_sha256: HASH_1,
      anchor: { kind: "line_number", value: "42", occurrence: 1, expected_context_sha256: HASH_2 },
    }],
  }),
  (error) => error?.code === "MANAGED_DELIVERY_STABLE_ANCHOR_REQUIRED",
);

assert.throws(
  () => normalizeSemanticPatchIntent({
    files: [{ path: "../escape.js", action: "create_file", content_sha256: HASH_1 }],
  }),
  (error) => error?.code === "MANAGED_DELIVERY_PATCH_PATH_INVALID",
);

const plan = buildManagedDeliveryPlan(baseInput());
assert.equal(plan.version, SPEC011_MANAGED_DELIVERY_VERSION);
assert.equal(plan.operation_key, "repo.change.execute");
assert.equal(plan.durable_automation_key, "pr_delivery");
assert.equal(plan.safety.no_force_push, true);
assert.equal(plan.safety.no_protected_branch_bypass, true);
assert.equal(plan.safety.approval_bound_to_final_head_and_base, true);
assert.equal(plan.safety.same_cycle_post_merge_readback_required, true);
assert.match(plan.plan_sha256, /^[0-9a-f]{64}$/);

for (const forbidden of [
  { force_push: true },
  { force: true },
  { bypass_branch_protection: true },
  { admin_override: true },
  { direct_protected_branch_write: true },
]) {
  assert.throws(
    () => buildManagedDeliveryPlan(baseInput(forbidden)),
    (error) => error?.code === "MANAGED_DELIVERY_BYPASS_FORBIDDEN",
  );
}

assert.throws(
  () => buildManagedDeliveryPlan(baseInput({ branch: "main" })),
  (error) => error?.code === "MANAGED_DELIVERY_PROTECTED_HEAD_FORBIDDEN",
);
assert.throws(
  () => buildManagedDeliveryPlan(baseInput({ mutation_approval: { password: "never-store-this" } })),
  (error) => error?.code === "MANAGED_DELIVERY_SECRET_FIELD_REJECTED",
);

const syncPlan = deriveBaseSynchronizationPlan({
  expected_base_sha: BASE_A,
  expected_head_sha: HEAD_B,
  current_base_sha: BASE_D,
  current_head_sha: HEAD_E,
  branch: "gpt/spec011-phase6-example",
  active_runs: [
    { run_id: "run-stale", status: "running", base_sha: BASE_A, head_sha: HEAD_B },
    { run_id: "run-current", status: "running", base_sha: BASE_D, head_sha: HEAD_E },
    { run_id: "run-terminal", status: "completed", base_sha: BASE_A, head_sha: HEAD_B },
  ],
});
assert.equal(syncPlan.required, true);
assert.deepEqual(syncPlan.stale_run_ids, ["run-stale"]);
assert.equal(syncPlan.synchronization_operation, "repo.branch.reconcile");
assert.equal(syncPlan.force_push_allowed, false);
assert.equal(syncPlan.exact_readback_required, true);

const allowedRepair = classifyDelegatedCiRepair({
  diagnosis: { code: "docs_reference_integrity", risk: "low", structured: true },
  delegation_mode: "delegated_plan_bound",
  candidate_files: ["docs/runbook.md", "specs/011/example.md"],
  attempt: 0,
  expected_head_sha: HEAD_B,
  expected_base_sha: BASE_A,
  current_head_sha: HEAD_B,
  current_base_sha: BASE_A,
});
assert.equal(allowedRepair.allowed, true);
assert.equal(allowedRepair.max_attempts, 1);
assert.equal(allowedRepair.force_push_allowed, false);

const blockedRepair = classifyDelegatedCiRepair({
  diagnosis: { code: "docs_reference_integrity", risk: "high", structured: true },
  delegation_mode: "delegated_plan_bound",
  candidate_files: ["http-generic-api/server.js"],
  attempt: 1,
  expected_head_sha: HEAD_B,
  expected_base_sha: BASE_A,
  current_head_sha: HEAD_E,
  current_base_sha: BASE_D,
});
assert.equal(blockedRepair.allowed, false);
for (const reason of [
  "diagnosis_risk_not_low",
  "repair_attempt_budget_exhausted",
  "candidate_path_outside_allowlist",
  "head_sha_drift",
  "base_sha_drift",
]) assert(blockedRepair.reasons.includes(reason), `missing repair blocker ${reason}`);

const approval = createMergeApprovalBinding({
  pull_number: 6000,
  final_head_sha: HEAD_B,
  final_base_sha: BASE_A,
  approved_by: "reviewer@example.invalid",
  approved_at: "2026-08-03T08:00:00.000Z",
  expires_at: "2026-08-03T09:00:00.000Z",
});
assert.match(approval.binding_sha256, /^[0-9a-f]{64}$/);
assert.equal(verifyMergeApprovalBinding(approval, {
  pull_number: 6000,
  final_head_sha: HEAD_B,
  final_base_sha: BASE_A,
  now: "2026-08-03T08:30:00.000Z",
}).valid, true);
const driftedApproval = verifyMergeApprovalBinding(approval, {
  pull_number: 6000,
  final_head_sha: HEAD_E,
  final_base_sha: BASE_A,
  now: "2026-08-03T08:30:00.000Z",
});
assert.equal(driftedApproval.valid, false);
assert(driftedApproval.reasons.includes("final_head_sha_mismatch"));
assert(verifyMergeApprovalBinding(approval, {
  pull_number: 6000,
  final_head_sha: HEAD_B,
  final_base_sha: BASE_A,
  now: "2026-08-03T10:00:00.000Z",
}).reasons.includes("approval_expired"));

const receipts = {
  merge: {
    merged: true,
    expected_head_sha: HEAD_B,
    expected_base_sha: BASE_A,
    merge_sha: MERGE_C,
  },
  branch_delete: {
    verified_absent: true,
    expected_head_sha: HEAD_B,
  },
  deployment: {
    receipt_id: "deploy-receipt-1",
    deployed_sha: MERGE_C,
  },
  production_readback: {
    parity: "verified",
    deployed_sha: MERGE_C,
  },
};
const receiptValidation = validateManagedDeliveryReceipts(receipts, {
  final_head_sha: HEAD_B,
  final_base_sha: BASE_A,
});
assert.equal(receiptValidation.complete, true);
assert.equal(receiptValidation.same_cycle_readback_verified, true);
assert.match(receiptValidation.receipt_chain_sha256, /^[0-9a-f]{64}$/);
const incompleteReceipts = validateManagedDeliveryReceipts({
  ...receipts,
  production_readback: { parity: "degraded", deployed_sha: HEAD_E },
}, { final_head_sha: HEAD_B, final_base_sha: BASE_A });
assert.equal(incompleteReceipts.complete, false);
assert(incompleteReceipts.blockers.includes("production_parity_unverified"));
assert(incompleteReceipts.blockers.includes("production_readback_sha_mismatch"));

let previewCall = null;
const previewResult = await previewManagedDeliveryOperation(baseInput(), {
  previewOperation: async (input) => {
    previewCall = input;
    return { ok: true, plan: { durable: true }, mutations_executed: false, secrets_included: false };
  },
});
assert.equal(previewResult.status, "planned");
assert.equal(previewResult.mutations_executed, false);
assert.equal(previewCall.operation_key, "repo.change.preview");
assert.equal(previewCall.automation_key, "pr_delivery");

const executeCalls = [];
const completed = await executeManagedDeliveryOperation({
  ...baseInput(),
  approval_binding: approval,
}, {
  now: "2026-08-03T08:30:00.000Z",
  readRepositoryState: async () => ({ base_sha: BASE_A, head_sha: HEAD_B, active_runs: [] }),
  readCiDiagnosis: async () => ({ status: "success", missing_checks: [], secrets_included: false }),
  executeOperation: async (input) => {
    executeCalls.push(input);
    return { ok: true, status: "completed", run_id: "durable-run-1", secrets_included: false };
  },
  readLifecycleReceipts: async () => receipts,
});
assert.equal(completed.ok, true);
assert.equal(completed.status, "completed");
assert.equal(executeCalls.length, 1);
assert.equal(executeCalls[0].operation_key, "repo.change.execute");
assert.equal(executeCalls[0].automation_key, "pr_delivery");
assert.equal(executeCalls[0].expected_head_sha, HEAD_B);
assert.equal(executeCalls[0].expected_base_sha, BASE_A);
assert.equal(executeCalls[0].step_args.pr_finalize.approval_binding_sha256, approval.binding_sha256);

const movedApproval = createMergeApprovalBinding({
  pull_number: 6000,
  final_head_sha: HEAD_E,
  final_base_sha: BASE_D,
  approved_by: "reviewer@example.invalid",
  approved_at: "2026-08-03T08:00:00.000Z",
  expires_at: "2026-08-03T09:00:00.000Z",
});
const movedReceipts = {
  merge: { merged: true, expected_head_sha: HEAD_E, expected_base_sha: BASE_D, merge_sha: MERGE_C },
  branch_delete: { verified_absent: true, expected_head_sha: HEAD_E },
  deployment: { receipt_id: "deploy-receipt-2", deployed_sha: MERGE_C },
  production_readback: { parity: "verified", deployed_sha: MERGE_C },
};
let stateReadCount = 0;
const cancelledRuns = [];
const movedExecuteCalls = [];
const moved = await executeManagedDeliveryOperation({
  ...baseInput(),
  approval_binding: movedApproval,
}, {
  now: "2026-08-03T08:30:00.000Z",
  readRepositoryState: async () => {
    stateReadCount += 1;
    if (stateReadCount === 1) {
      return {
        base_sha: BASE_D,
        head_sha: HEAD_E,
        active_runs: [{ run_id: "stale-run-9", status: "running", base_sha: BASE_A, head_sha: HEAD_B }],
      };
    }
    return { base_sha: BASE_D, head_sha: HEAD_E, active_runs: [] };
  },
  cancelStaleRun: async (runId) => cancelledRuns.push(runId),
  readCiDiagnosis: async () => ({ status: "success", missing_checks: [], secrets_included: false }),
  executeOperation: async (input) => {
    movedExecuteCalls.push(input);
    return { ok: true, status: "completed", run_id: `run-${movedExecuteCalls.length}`, secrets_included: false };
  },
  readLifecycleReceipts: async () => movedReceipts,
});
assert.equal(moved.status, "completed");
assert.deepEqual(cancelledRuns, ["stale-run-9"]);
assert.equal(movedExecuteCalls.length, 2);
assert.equal(movedExecuteCalls[0].operation_key, "repo.branch.reconcile");
assert.equal(movedExecuteCalls[0].idempotency_key, "spec011-phase6-test:base-sync");
assert.equal(movedExecuteCalls[1].operation_key, "repo.change.execute");
assert.equal(movedExecuteCalls[1].expected_head_sha, HEAD_E);
assert.equal(movedExecuteCalls[1].expected_base_sha, BASE_D);

const approvalPending = await executeManagedDeliveryOperation(baseInput({ approval_binding: approval }), {
  now: "2026-08-03T08:30:00.000Z",
  readRepositoryState: async () => ({ base_sha: BASE_D, head_sha: HEAD_E, active_runs: [] }),
  readCiDiagnosis: async () => ({ status: "success", missing_checks: [], secrets_included: false }),
  executeOperation: async () => { throw new Error("must not execute with stale approval"); },
});
assert.equal(approvalPending.status, "approval_pending");
assert(approvalPending.approval.reasons.includes("final_head_sha_mismatch"));
assert(approvalPending.approval.reasons.includes("final_base_sha_mismatch"));

const repairPending = await executeManagedDeliveryOperation(baseInput({ approval_binding: approval }), {
  now: "2026-08-03T08:30:00.000Z",
  readRepositoryState: async () => ({ base_sha: BASE_A, head_sha: HEAD_B, active_runs: [] }),
  readCiDiagnosis: async () => ({
    status: "failed",
    diagnosis: { code: "runtime_semantic_failure", risk: "high", structured: true },
    candidate_files: ["http-generic-api/server.js"],
  }),
  executeOperation: async () => { throw new Error("must not execute disallowed repair"); },
});
assert.equal(repairPending.status, "repair_pending");
assert.equal(repairPending.repair.allowed, false);
assert(repairPending.repair.reasons.includes("failure_code_not_allowlisted"));

console.log("Spec 011 managed delivery lifecycle tests passed");
