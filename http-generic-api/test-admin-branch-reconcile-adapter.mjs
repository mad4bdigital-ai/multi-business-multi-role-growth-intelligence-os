import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertAdminBranchReconcileTarget,
  branchMergeCommitConfirmation,
  branchReconcileConfirmation,
  buildBranchReconcileDryRunPlan,
  classifyBranchReconciliation,
  validateGithubMergeResolutionEvidence,
} from "./adminBranchReconciliationAdapter.js";

assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "identical", ahead_by: 0, behind_by: 0 } }).classification, "up_to_date");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "behind", ahead_by: 0, behind_by: 3 } }).classification, "behind_only");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "ahead", ahead_by: 2, behind_by: 0 } }).classification, "ahead_only");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "diverged", ahead_by: 2, behind_by: 3 }, branch_to_base: { files: [{ filename: "same.js" }] }, }).classification, "diverged_no_overlap");
assert.equal(classifyBranchReconciliation({ branch: "gpt/example", base_to_branch: { status: "diverged", ahead_by: 2, behind_by: 3, files: [{ filename: "same.js" }] }, branch_to_base: { files: [{ filename: "same.js" }] }, }).classification, "diverged_same_files");

assert.equal(
  branchReconcileConfirmation("gpt/admin-branch-reconcile-adapter-20260608"),
  "RECONCILE_BRANCH_GPT_ADMIN_BRANCH_RECONCILE_ADAPTER_20260608"
);assert.equal(
  branchMergeCommitConfirmation("gpt/example-fix"),
  "CREATE_MERGE_COMMIT_GPT_EXAMPLE_FIX"
);

const validResolution = validateGithubMergeResolutionEvidence({
  expected_base_sha: "b".repeat(40),
  branch_changed_files: ["a.js", "b.js"],
  resolution_commit: {
    tree: { sha: "c".repeat(40) },
    parents: [{ sha: "b".repeat(40) }],
  },
  resolution_compare: {
    status: "ahead",
    ahead_by: 1,
    behind_by: 0,
    files: [{ filename: "b.js" }, { filename: "a.js" }],
  },
});
assert.equal(validResolution.ok, true);
assert.deepEqual(validResolution.missing_files, []);
assert.deepEqual(validResolution.extra_files, []);
assert.equal(validResolution.tree_sha, "c".repeat(40));

const extraFileResolution = validateGithubMergeResolutionEvidence({
  expected_base_sha: "b".repeat(40),
  branch_changed_files: ["a.js"],
  resolution_commit: {
    tree: { sha: "c".repeat(40) },
    parents: [{ sha: "b".repeat(40) }],
  },
  resolution_compare: {
    status: "ahead",
    ahead_by: 1,
    behind_by: 0,
    files: [{ filename: "a.js" }, { filename: "unrelated.js" }],
  },
});
assert.equal(extraFileResolution.ok, false);
assert(extraFileResolution.reasons.includes("resolution_commit_changes_files_outside_branch_scope"));
assert.deepEqual(extraFileResolution.extra_files, ["unrelated.js"]);

const wrongParentResolution = validateGithubMergeResolutionEvidence({
  expected_base_sha: "b".repeat(40),
  branch_changed_files: ["a.js"],
  resolution_commit: {
    tree: { sha: "c".repeat(40) },
    parents: [{ sha: "d".repeat(40) }],
  },
  resolution_compare: {
    status: "ahead",
    ahead_by: 1,
    behind_by: 0,
    files: [{ filename: "a.js" }],
  },
});
assert.equal(wrongParentResolution.ok, false);
assert(wrongParentResolution.reasons.includes("resolution_commit_must_have_expected_base_as_sole_parent"));

const oversizedResolution = validateGithubMergeResolutionEvidence({
  expected_base_sha: "b".repeat(40),
  branch_changed_files: Array.from({ length: 51 }, (_, index) => `file-${index}.js`),
  resolution_commit: { tree: { sha: "c".repeat(40) }, parents: [{ sha: "b".repeat(40) }] },
  resolution_compare: {
    status: "ahead", ahead_by: 1, behind_by: 0,
    files: Array.from({ length: 51 }, (_, index) => ({ filename: `file-${index}.js` })),
  },
});
assert.equal(oversizedResolution.ok, false);
assert(oversizedResolution.reasons.includes("resolution_commit_file_scope_exceeds_limit"));

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

assert.equal((source.match(/name: "github_branch_fast_forward_smoke"/g) || []).length, 1, "github_branch_fast_forward_smoke should be registered exactly once");
assert.equal((source.match(/name: "github_branch_fast_forward_to_base"/g) || []).length, 1, "github_branch_fast_forward_to_base should be registered exactly once");
assert.equal((source.match(/name: "github_branch_merge_commit_create"/g) || []).length, 1, "github_branch_merge_commit_create should be registered exactly once");
assert.match(source, /requireGithubBranchMergeCommitEnvelope/);
assert.match(source, /runGithubBranchMergeCommitCreate/);
assert.match(source, /CREATE_MERGE_COMMIT_<BRANCH_SLUG>/);
assert.match(source, /acceptedIntents: \["github_branch_merge_commit_create", "github_ref_update", "repo_mutation", "branch_merge_commit"\]/);
assert.match(source, /requireGithubBranchFastForwardEnvelope/);
assert.match(source, /runGithubBranchFastForwardSmoke/);
assert.match(source, /runGithubBranchFastForwardToBase/);
assert.match(source, /capability_envelope_id/);
assert.match(source, /acceptedIntents: \["github_branch_fast_forward_smoke", "github_branch_fast_forward_to_base"/);
assert.match(adapter, /export async function runGithubBranchFastForwardSmoke/);
assert.match(adapter, /export async function runGithubBranchFastForwardToBase/);
assert.match(adapter, /export async function runGithubBranchMergeCommitCreate/);
assert.match(adapter, /parents: \[expectedBranchSha, expectedBaseSha\]/);
assert.match(adapter, /body: \{ sha: mergeCommitSha, force: false \}/);
assert.match(adapter, /resolution_commit_changes_files_outside_branch_scope/);
assert.match(adapter, /github_branch_merge_commit_readback_failed/);
assert.match(adapter, /gpt\/fast-forward-smoke-/);
assert.match(adapter, /apiPath: "\/git\/refs"/);
assert.match(adapter, /method: "DELETE"/);
assert.match(adapter, /cleanup_in_finally|if \(result\) result\.cleanup = cleanup/);
assert.match(adapter, /expected_base_sha/);
assert.match(adapter, /expected_branch_sha/);
assert.match(adapter, /github_branch_fast_forward_stale_dry_run_evidence/);
assert.match(adapter, /body: \{ sha: baseSha, force: false \}/);
assert.match(adapter, /github_branch_fast_forward_readback_failed/);
assert.doesNotMatch(adapter, /force: true/);

const repoPatchTokenIndex = source.indexOf("const token = await getGitHubAppInstallationToken({});");
const envelopeGateIndex = source.lastIndexOf("await requireRepoPatchCapabilityEnvelope", repoPatchTokenIndex);
assert.ok(envelopeGateIndex > -1, "repo_patch_apply capability envelope gate must remain before direct GitHub token resolution");

const smokeIndex = source.indexOf("const result = await runGithubBranchFastForwardSmoke");
const smokeEnvelopeIndex = source.lastIndexOf("await requireGithubBranchFastForwardEnvelope", smokeIndex);
assert.ok(smokeEnvelopeIndex > -1, "github_branch_fast_forward_smoke must require a capability envelope before disposable ref mutation");
const fastForwardIndex = source.indexOf("const result = await runGithubBranchFastForwardToBase");
const fastForwardEnvelopeIndex = source.lastIndexOf("await requireGithubBranchFastForwardEnvelope", fastForwardIndex);
assert.ok(fastForwardEnvelopeIndex > -1, "github_branch_fast_forward_to_base must require a capability envelope before ref mutation");const mergeCommitIndex = source.indexOf("const result = await runGithubBranchMergeCommitCreate");
const mergeCommitEnvelopeIndex = source.lastIndexOf("await requireGithubBranchMergeCommitEnvelope", mergeCommitIndex);
assert.ok(mergeCommitEnvelopeIndex > -1, "github_branch_merge_commit_create must require a capability envelope before commit/ref mutation");

const migrationName = "236_sprint68_admin_branch_reconciliation_policy.sql";
const fastForwardMigrationName = "248_sprint68_github_branch_fast_forward_policy.sql";
const smokeMigrationName = "251_sprint68_github_branch_fast_forward_smoke_policy.sql";
const mergeCommitMigrationName = "1014_sprint69_github_branch_multi_parent_merge_commit_policy.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const fastForwardMigration = readFileSync(new URL(`./migrations/${fastForwardMigrationName}`, import.meta.url), "utf8");
const smokeMigration = readFileSync(new URL(`./migrations/${smokeMigrationName}`, import.meta.url), "utf8");
const mergeCommitMigration = readFileSync(new URL(`./migrations/${mergeCommitMigrationName}`, import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
assert.match(migration, /Admin Branch Reconciliation Adapter Contract/);
assert.match(migration, /admin_branch_reconcile_requires_dry_run_and_checkpoint/);
assert.match(migration, /admin-branch-reconciliation-v1/);
assert.match(migration, /force_push_or_force_ref_update',false/);
assert.match(migration, /secrets_included',false/);
assert.match(fastForwardMigration, /GitHub Branch Fast Forward To Base Recipe Contract/);
assert.match(fastForwardMigration, /github_branch_fast_forward_requires_dry_run_evidence_and_capability_envelope/);
assert.match(fastForwardMigration, /github_branch_fast_forward_to_base/);
assert.match(fastForwardMigration, /same_cycle_readback_required',true/);
assert.match(fastForwardMigration, /'force',false/);
assert.match(smokeMigration, /GitHub Branch Fast Forward Smoke Contract/);
assert.match(smokeMigration, /github_branch_fast_forward_smoke_requires_disposable_branch_cleanup_and_capability_envelope/);
assert.match(smokeMigration, /github_branch_fast_forward_smoke/);
assert.match(smokeMigration, /cleanup_in_finally',true/);
assert.match(smokeMigration, /'force',false/);
assert.match(mergeCommitMigration, /GitHub Branch Multi-Parent Merge Commit Recipe Contract/);
assert.match(mergeCommitMigration, /github_branch_merge_commit_create/);
assert.match(mergeCommitMigration, /CREATE_MERGE_COMMIT_<BRANCH_SLUG>/);
assert.match(mergeCommitMigration, /expected_branch_sha.*expected_base_sha/);
assert.match(mergeCommitMigration, /same_cycle_parent_readback_required',true/);
assert.match(mergeCommitMigration, /github_ref_update_force',false/);
assert.ok(runner.includes("234_sprint68_ticket_lifecycle_reconciliation_tool.sql"), "governed migration runner must retain main migration 234");
assert.ok(runner.includes("235_sprint67_capability_envelope_approval_tool.sql"), "governed migration runner must retain main migration 235");
assert.ok(runner.includes(migrationName), "governed migration runner must allow migration 236");
assert.ok(runner.includes(fastForwardMigrationName), "governed migration runner must allow branch fast-forward policy migration");
assert.ok(runner.includes(smokeMigrationName), "governed migration runner must allow branch fast-forward smoke policy migration");
assert.ok(runner.includes(mergeCommitMigrationName), "governed migration runner must allow branch merge-commit policy migration");
assert.ok(readiness.includes(migrationName), "release readiness must track migration 236");
assert.ok(readiness.includes(fastForwardMigrationName), "release readiness must track branch fast-forward policy migration");
assert.ok(readiness.includes(smokeMigrationName), "release readiness must track branch fast-forward smoke policy migration");
assert.ok(readiness.includes(mergeCommitMigrationName), "release readiness must track branch merge-commit policy migration");
assert.ok(!runner.includes("234_sprint68_admin_branch_reconcile_continuation_policy.sql"), "old migration 234 name must not stay allowlisted");
assert.ok(!runner.includes("235_sprint68_admin_branch_reconciliation_policy.sql"), "old migration 235 name must not stay allowlisted");

console.log("admin branch reconcile adapter tests passed");
