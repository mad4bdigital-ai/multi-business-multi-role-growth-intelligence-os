import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adminBranchFastForwardConfirmation,
  buildAdminBranchReconcileContinuation,
  classifyAdminBranchReconcileState,
} from "./routes/gptToolsRoutes.js";

assert.equal(classifyAdminBranchReconcileState({ status: "identical", ahead_by: 0, behind_by: 0 }), "clean");
assert.equal(classifyAdminBranchReconcileState({ status: "behind", ahead_by: 0, behind_by: 3 }), "behind_only");
assert.equal(classifyAdminBranchReconcileState({ status: "ahead", ahead_by: 2, behind_by: 0 }), "ahead_only");
assert.equal(classifyAdminBranchReconcileState({ status: "diverged", ahead_by: 2, behind_by: 3 }), "diverged");

assert.equal(
  adminBranchFastForwardConfirmation("gpt/admin-branch-reconcile-adapter-20260608"),
  "FAST_FORWARD_GPT_ADMIN_BRANCH_RECONCILE_ADAPTER_20260608"
);

const resourceState = {
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  branch: "gpt/example",
  base_branch: "main",
  branch_sha: "a".repeat(40),
  base_sha: "b".repeat(40),
  compare_status: "diverged",
  ahead_by: 2,
  behind_by: 3,
  file_count: 2,
  files: [
    { filename: "http-generic-api/routes/gptToolsRoutes.js", status: "modified", changes: 42 },
  ],
};
const continuation = buildAdminBranchReconcileContinuation({
  owner: resourceState.owner,
  repo: resourceState.repo,
  branch: resourceState.branch,
  baseBranch: resourceState.base_branch,
  resourceState,
  classification: "diverged",
});
assert.equal(continuation.checkpoint.engine, "shared-reconciliation-continuation-v1");
assert.equal(continuation.checkpoint.interruption_signal, "branch_diverged");
assert.equal(continuation.checkpoint.resource_scope.scope_type, "repository");
assert.equal(continuation.resume_plan.next_required_step, "manual_rebase_or_recreate_branch");
assert.equal(continuation.secrets_included, false);

const source = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.match(source, /name: "admin_branch_reconcile"/);
assert.match(source, /reconcileAdminBranch/);
assert.match(source, /force: false/);
assert.match(source, /admin_branch_reconcile_confirmation_required/);
assert.match(source, /admin_branch_reconcile_protected_branch/);
assert.doesNotMatch(source, /force: true/);

console.log("admin branch reconcile adapter tests passed");
