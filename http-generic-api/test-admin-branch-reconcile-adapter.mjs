import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  branchReconcileConfirmation,
  buildBranchReconcileDryRunPlan,
  classifyBranchReconciliation,
} from "./adminBranchReconciliationAdapter.js";

assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "identical", ahead_by: 0, behind_by: 0 } }).classification, "up_to_date");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "behind", ahead_by: 0, behind_by: 3 } }).classification, "behind_only");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "ahead", ahead_by: 2, behind_by: 0 } }).classification, "ahead_only");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "diverged", ahead_by: 2, behind_by: 3 }, branch_to_base: { files: [{ filename: "same.js" }] }, }).classification, "diverged_no_overlap");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "diverged", ahead_by: 2, behind_by: 3, files: [{ filename: "same.js" }] }, branch_to_base: { files: [{ filename: "same.js" }] }, }).classification, "diverged_same_files");

assert.equal(
  branchReconcileConfirmation("gpt/admin-branch-reconcile-adapter-20260608"),
  "RECONCILE_BRANCH_GPT_ADMIN_BRANCH_RECONCILE_ADAPTER_20260608"
);

const classification = {
  classification: "diverged_same_files",
  risk: "high",
  reason_code: "branch_and_default_changed_same_files",
  apply_allowed: false,
  resume_allowed: false,
  ahead_by: 2,
  behind_by: 3,
  changed_files: ["http-generic-api/routes/gptToolsRoutes.js"],
  base_changed_files: ["http-generic-api/routes/gptToolsRoutes.js"],
  overlapping_files: ["http-generic-api/routes/gptToolsRoutes.js"],
};

const plan = buildBranchReconcileDryRunPlan({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  branch: "gpt/example",
  default_branch: "main",
  base_ref: { object: { sha: "b".repeat(40) } },
  branch_ref: { object: { sha: "a".repeat(40) } },
  base_to_branch: { status: "diverged", ahead_by: 2, behind_by: 3 },
  branch_to_base: { status: "diverged", ahead_by: 3, behind_by: 2 },
  classification,
});
assert.equal(plan.adapter, "admin-branch-reconciliation-v1");
assert.equal(plan.continuation.checkpoint.engine, "shared-reconciliation-continuation-v1");
assert.equal(plan.continuation.checkpoint.interruption_signal, "branch_diverged");
assert.equal(plan.continuation.checkpoint.resource_scope.scope_type, "repository");
assert.equal(plan.dry_run.apply_supported, false);
assert.equal(plan.secrets_included, false);

const source = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./adminBranchReconciliationAdapter.js", import.meta.url), "utf8");
assert.equal((source.match(/name: "admin_branch_reconcile"/g) || []).length, 1, "admin_branch_reconcile should be registered exactly once");
assert.match(source, /runAdminBranchReconcile/);
assert.doesNotMatch(source, /export async function reconcileAdminBranch/);
assert.doesNotMatch(source, /FAST_FORWARD_/);
assert.doesNotMatch(source, /createContinuationCheckpoint/);
assert.doesNotMatch(source, /planContinuationResume/);
assert.match(source, /admin_branch_reconcile_failed/);
assert.match(source, /admin_branch_reconcile/);
assert.doesNotMatch(source, /guarded_mutation/);
assert.doesNotMatch(source, /force: true/);

assert.equal((source.match(/name: "github_branch_fast_forward_to_base"/g) || []).length, 1, "github_branch_fast_forward_to_base should be registered exactly once");
assert.match(source, /requireGithubBranchFastForwardEnvelope/);
assert.match(source, /runGithubBranchFastForwardToBase/);
assert.match(source, /capability_envelope_id/);
assert.match(source, /acceptedIntents: \["github_branch_fast_forward_to_base"/);
assert.match(adapter, /export async function runGithubBranchFastForwardToBase/);
assert.match(adapter, /expected_base_sha/);
assert.match(adapter, /expected_branch_sha/);
assert.match(adapter, /github_branch_fast_forward_stale_dry_run_evidence/);
assert.match(adapter, /body: \{ sha: baseSha, force: false \}/);
assert.match(adapter, /github_branch_fast_forward_readback_failed/);
assert.doesNotMatch(adapter, /force: true/);

const repoPatchTokenIndex = source.indexOf("const token = await getGitHubAppInstallationToken({});");
const envelopeGateIndex = source.lastIndexOf("await requireRepoPatchCapabilityEnvelope", repoPatchTokenIndex);
assert.ok(envelopeGateIndex > -1, "repo_patch_apply capability envelope gate must remain before direct GitHub token resolution");

const fastForwardIndex = source.indexOf("const result = await runGithubBranchFastForwardToBase");
const fastForwardEnvelopeIndex = source.lastIndexOf("await requireGithubBranchFastForwardEnvelope", fastForwardIndex);
assert.ok(fastForwardEnvelopeIndex > -1, "github_branch_fast_forward_to_base must require a capability envelope before ref mutation");

const migrationName = "236_sprint68_admin_branch_reconciliation_policy.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
assert.match(migration, /Admin Branch Reconciliation Adapter Contract/);
assert.match(migration, /admin_branch_reconcile_requires_dry_run_and_checkpoint/);
assert.match(migration, /admin-branch-reconciliation-v1/);
assert.match(migration, /force_push_or_force_ref_update',false/);
assert.match(migration, /secrets_included',false/);
assert.ok(runner.includes("234_sprint68_ticket_lifecycle_reconciliation_tool.sql"), "governed migration runner must retain main migration 234");
assert.ok(runner.includes("235_sprint67_capability_envelope_approval_tool.sql"), "governed migration runner must retain main migration 235");
assert.ok(runner.includes(migrationName), "governed migration runner must allow migration 236");
assert.ok(readiness.includes(migrationName), "release readiness must track migration 236");
assert.ok(!runner.includes("234_sprint68_admin_branch_reconcile_continuation_policy.sql"), "old migration 234 name must not stay allowlisted");
assert.ok(!runner.includes("235_sprint68_admin_branch_reconciliation_policy.sql"), "old migration 235 name must not stay allowlisted");

console.log("admin branch reconcile adapter tests passed");
