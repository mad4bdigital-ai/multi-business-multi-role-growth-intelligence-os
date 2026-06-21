import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { DEFAULT_DISPOSABLE_BRANCH_PREFIXES } from "./githubRepositoryLifecycle.js";
import { writeAuditLogAsync } from "./auditLogger.js";
import {
  createContinuationCheckpoint,
  planContinuationResume,
  sanitizeContinuationPayload,
} from "./sharedReconciliationEngine.js";

export const ADMIN_BRANCH_RECONCILIATION_ADAPTER_VERSION = "admin-branch-reconciliation-v1";

export const ADMIN_BRANCH_RECONCILIATION_SEQUENCE = Object.freeze([
  "load_repository_authority",
  "fetch_base_and_branch_refs",
  "compare_base_to_branch",
  "compare_branch_to_base",
  "classify_branch_drift",
  "build_no_secret_continuation_checkpoint",
  "dry_run_repair_plan",
  "verify_required_checks",
  "apply_only_after_explicit_confirmation",
  "audit_and_resume_original_operation",
]);

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod", "staging", "release"]);
const ALLOWED_BRANCH_PREFIXES = Object.freeze([...DEFAULT_DISPOSABLE_BRANCH_PREFIXES]);
const MAX_BRANCH_MERGE_RESOLUTION_FILES = 50;

function encodeRef(ref = "") {
  return String(ref || "").split("/").map(encodeURIComponent).join("/");
}

function encodeCompareRef(ref = "") {
  return encodeURIComponent(String(ref || "").trim());
}

export function normalizeBranchReconcileMode(value = "dry_run") {
  const mode = String(value || "dry_run").trim().toLowerCase();
  return mode === "apply" ? "apply" : "dry_run";
}

export function branchReconcileConfirmation(branch = "") {
  return `RECONCILE_BRANCH_${String(branch || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
}

export function branchMergeCommitConfirmation(branch = "") {
  return `CREATE_MERGE_COMMIT_${String(branch || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
}

export function assertAdminBranchReconcileTarget({ branch, default_branch: defaultBranch = "main", mode = "dry_run", confirm = "" } = {}) {
  const targetBranch = String(branch || "").trim();
  const baseBranch = String(defaultBranch || "main").trim() || "main";
  if (!targetBranch) {
    const err = new Error("branch is required for admin branch reconciliation.");
    err.status = 400;
    err.code = "admin_branch_reconcile_branch_required";
    throw err;
  }
  if (targetBranch === baseBranch || PROTECTED_BRANCHES.has(targetBranch)) {
    const err = new Error("admin_branch_reconcile blocks protected/default branch targets.");
    err.status = 403;
    err.code = "admin_branch_reconcile_protected_branch";
    err.details = { branch: targetBranch, default_branch: baseBranch };
    throw err;
  }
  if (!ALLOWED_BRANCH_PREFIXES.some((prefix) => targetBranch.startsWith(prefix))) {
    const err = new Error("admin_branch_reconcile only allows governed work-branch prefixes.");
    err.status = 403;
    err.code = "admin_branch_reconcile_branch_prefix_blocked";
    err.details = { branch: targetBranch, allowed_prefixes: ALLOWED_BRANCH_PREFIXES };
    throw err;
  }
  const normalizedMode = normalizeBranchReconcileMode(mode);
  const requiredConfirm = branchReconcileConfirmation(targetBranch);
  if (normalizedMode === "apply" && String(confirm || "") !== requiredConfirm) {
    const err = new Error(`apply mode requires confirm=${requiredConfirm}.`);
    err.status = 400;
    err.code = "admin_branch_reconcile_confirmation_required";
    err.details = { branch: targetBranch, expected_confirm: requiredConfirm };
    throw err;
  }
  return { branch: targetBranch, default_branch: baseBranch, mode: normalizedMode, required_confirm: requiredConfirm };
}

function fileList(comparePayload = {}) {
  return Array.from(new Set((comparePayload.files || []).map((file) => file?.filename).filter(Boolean))).sort();
}

function intersection(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

export function classifyBranchReconciliation({ branch, default_branch: defaultBranch = "main", base_to_branch = {}, branch_to_base = {}, working_tree_dirty = false } = {}) {
  assertAdminBranchReconcileTarget({ branch, default_branch: defaultBranch, mode: "dry_run" });
  const aheadBy = Number(base_to_branch.ahead_by || 0);
  const behindBy = Number(base_to_branch.behind_by || 0);
  const baseFiles = fileList(branch_to_base);
  const branchFiles = fileList(base_to_branch);
  const overlappingFiles = intersection(branchFiles, baseFiles);
  const status = String(base_to_branch.status || "").trim().toLowerCase();

  if (working_tree_dirty) {
    return { classification: "unsafe_dirty_tree", risk: "blocked", reason_code: "working_tree_dirty", apply_allowed: false, resume_allowed: false, ahead_by: aheadBy, behind_by: behindBy, changed_files: branchFiles, base_changed_files: baseFiles, overlapping_files: overlappingFiles };
  }
  if (status === "identical" || (aheadBy === 0 && behindBy === 0)) {
    return { classification: "up_to_date", risk: "clean", reason_code: "branch_matches_default_head", apply_allowed: false, resume_allowed: true, ahead_by: aheadBy, behind_by: behindBy, changed_files: branchFiles, base_changed_files: baseFiles, overlapping_files: overlappingFiles };
  }
  if (aheadBy === 0 && behindBy > 0) {
    return { classification: "behind_only", risk: "low", reason_code: "branch_can_fast_forward_to_default", apply_allowed: true, resume_allowed: false, ahead_by: aheadBy, behind_by: behindBy, changed_files: branchFiles, base_changed_files: baseFiles, overlapping_files: overlappingFiles };
  }
  if (aheadBy > 0 && behindBy === 0) {
    return { classification: "ahead_only", risk: "clean", reason_code: "branch_is_ahead_of_default_without_drift", apply_allowed: false, resume_allowed: true, ahead_by: aheadBy, behind_by: behindBy, changed_files: branchFiles, base_changed_files: baseFiles, overlapping_files: overlappingFiles };
  }
  if (overlappingFiles.length > 0) {
    return { classification: "diverged_same_files", risk: "high", reason_code: "branch_and_default_changed_same_files", apply_allowed: false, resume_allowed: false, ahead_by: aheadBy, behind_by: behindBy, changed_files: branchFiles, base_changed_files: baseFiles, overlapping_files: overlappingFiles };
  }
  return { classification: "diverged_no_overlap", risk: "medium", reason_code: "branch_and_default_diverged_without_file_overlap", apply_allowed: true, resume_allowed: false, ahead_by: aheadBy, behind_by: behindBy, changed_files: branchFiles, base_changed_files: baseFiles, overlapping_files: overlappingFiles };
}

export function buildBranchReconcileDryRunPlan({ owner, repo, branch, default_branch: defaultBranch, base_ref = {}, branch_ref = {}, base_to_branch = {}, branch_to_base = {}, classification = {}, mode = "dry_run", confirm = "" } = {}) {
  const target = assertAdminBranchReconcileTarget({ branch, default_branch: defaultBranch, mode, confirm });
  const safeState = sanitizeContinuationPayload({
    owner,
    repo,
    branch: target.branch,
    default_branch: target.default_branch,
    base_head_sha: base_ref?.object?.sha || base_ref?.sha || null,
    branch_head_sha: branch_ref?.object?.sha || branch_ref?.sha || null,
    compare_status: base_to_branch?.status || null,
    ahead_by: Number(base_to_branch?.ahead_by || 0),
    behind_by: Number(base_to_branch?.behind_by || 0),
    classification: classification?.classification || null,
    risk: classification?.risk || null,
    changed_files: classification?.changed_files || [],
    base_changed_files: classification?.base_changed_files || [],
    overlapping_files: classification?.overlapping_files || [],
  });

  const checkpoint = createContinuationCheckpoint({
    operation_key: `admin_branch_reconcile:${owner}/${repo}:${target.branch}`,
    resource_type: "admin_branch_reconciliation",
    actor_context: { actor_type: "admin" },
    resource_scope: { scope_type: "repository", provider: "github", owner, repo, branch: target.branch, default_branch: target.default_branch },
    resource_state: safeState,
    interruption_signal: "branch_diverged",
    stage: classification?.classification === "up_to_date" || classification?.classification === "ahead_only" ? "resume_original_operation" : "dry_run_repair",
    metadata: { adapter: "admin_branch_reconcile", version: ADMIN_BRANCH_RECONCILIATION_ADAPTER_VERSION, required_confirmation: target.required_confirm, sequence: ADMIN_BRANCH_RECONCILIATION_SEQUENCE },
  });

  const dryRunOk = !String(classification?.classification || "").startsWith("unsafe") && classification?.classification !== "diverged_same_files";
  const verifyOk = classification?.classification === "up_to_date" || classification?.classification === "ahead_only";
  const resume_plan = planContinuationResume({
    checkpoint,
    actor_context: { actor_type: "admin" },
    resource_scope: checkpoint.resource_scope,
    current_resource_state: safeState,
    dry_run_result: { ok: dryRunOk, classification: classification?.classification || null, required_confirmation: target.required_confirm, sequence: ADMIN_BRANCH_RECONCILIATION_SEQUENCE },
    verify_result: { ok: verifyOk, reason_code: classification?.reason_code || null },
    apply_requested: target.mode === "apply",
  });

  const recommendedSteps = [];
  if (classification?.classification === "behind_only") {
    recommendedSteps.push("update_work_branch_to_default_head_after_explicit_confirmation", "run_targeted_tests_for_changed_surfaces", "verify_branch_head_and_resume_original_operation");
  } else if (classification?.classification === "diverged_no_overlap") {
    recommendedSteps.push("create_temporary_reconciliation_worktree_or_branch", "merge_or_rebase_default_into_work_branch_in_dry_run", "run_tests_covering_changed_surfaces_before_apply");
  } else if (classification?.classification === "diverged_same_files") {
    recommendedSteps.push("manual_conflict_resolution_required_before_apply", "do_not_force_update_branch_until_same_file_conflicts_are_resolved");
  } else if (classification?.classification === "ahead_only") {
    recommendedSteps.push("no_reconciliation_required_continue_ci_or_pr_flow");
  } else if (classification?.classification === "up_to_date") {
    recommendedSteps.push("resume_original_operation");
  }

  return {
    ok: true,
    adapter: ADMIN_BRANCH_RECONCILIATION_ADAPTER_VERSION,
    mode: target.mode,
    target: { owner, repo, branch: target.branch, default_branch: target.default_branch },
    classification,
    dry_run: { ok: dryRunOk, apply_supported: false, apply_blocked_reason: "adapter_v1_is_plan_only_use_explicit_github_branch_update_after_review", required_confirm_for_future_apply: target.required_confirm, recommended_steps: recommendedSteps, secrets_included: false },
    evidence: { base_ref_sha: safeState.base_head_sha, branch_ref_sha: safeState.branch_head_sha, compare_status: safeState.compare_status, ahead_by: safeState.ahead_by, behind_by: safeState.behind_by, changed_files_count: safeState.changed_files.length, base_changed_files_count: safeState.base_changed_files.length, overlapping_files_count: safeState.overlapping_files.length, secrets_included: false },
    continuation: { checkpoint, resume_plan, secrets_included: false },
    required_sequence: ADMIN_BRANCH_RECONCILIATION_SEQUENCE,
    secrets_included: false,
  };
}

async function githubJson({ owner, repo, apiPath, token, method = "GET", body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-admin-branch-reconcile",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.message || `GitHub request failed with HTTP ${response.status}.`);
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    err.code = response.status === 404 ? "github_branch_reconcile_not_found" : "github_branch_reconcile_request_failed";
    err.details = { status: response.status, apiPath, github_error: payload || null };
    throw err;
  }
  return payload;
}

async function resolveBranchReconcileTarget(args = {}) {
  const cfg = await resolveActivationBootstrapConfig({});
  const owner = String(args.owner || cfg?.config?.github_owner || "").trim();
  const repo = String(args.repo || cfg?.config?.github_repo || "").trim();
  const defaultBranch = String(args.default_branch || args.base_branch || cfg?.config?.github_branch || "main").trim() || "main";
  const branch = String(args.branch || "").trim();
  if (!owner || !repo) {
    const err = new Error("github owner/repo are required for admin_branch_reconcile.");
    err.status = 400;
    err.code = "admin_branch_reconcile_repo_required";
    throw err;
  }
  const target = assertAdminBranchReconcileTarget({ branch, default_branch: defaultBranch, mode: args.mode || "dry_run", confirm: args.confirm || "" });
  return { owner, repo, branch: target.branch, default_branch: target.default_branch, mode: target.mode, required_confirm: target.required_confirm };
}

async function loadBranchReconcileEvidence({ target, token, fetchImpl }) {
  const [baseRef, branchRef] = await Promise.all([
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/git/ref/heads/${encodeRef(target.default_branch)}`, token, fetchImpl }),
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/git/ref/heads/${encodeRef(target.branch)}`, token, fetchImpl }),
  ]);
  const [baseToBranch, branchToBase] = await Promise.all([
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/compare/${encodeCompareRef(target.default_branch)}...${encodeCompareRef(target.branch)}`, token, fetchImpl }),
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/compare/${encodeCompareRef(target.branch)}...${encodeCompareRef(target.default_branch)}`, token, fetchImpl }),
  ]);
  const classification = classifyBranchReconciliation({ branch: target.branch, default_branch: target.default_branch, base_to_branch: baseToBranch, branch_to_base: branchToBase, working_tree_dirty: false });
  const plan = buildBranchReconcileDryRunPlan({ owner: target.owner, repo: target.repo, branch: target.branch, default_branch: target.default_branch, base_ref: baseRef, branch_ref: branchRef, base_to_branch: baseToBranch, branch_to_base: branchToBase, classification, mode: target.mode, confirm: target.confirm || "" });
  return { baseRef, branchRef, baseToBranch, branchToBase, classification, plan };
}

export async function runAdminBranchReconcile(args = {}, deps = {}) {
  const target = await resolveBranchReconcileTarget(args);
  const token = deps.token || await getGitHubAppInstallationToken({});
  const fetchImpl = deps.fetchImpl || fetch;
  return (await loadBranchReconcileEvidence({ target: { ...target, confirm: args.confirm || "" }, token, fetchImpl })).plan;
}

function requireExpectedDryRunSha(value, field) {
  const sha = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    const err = new Error(`${field} from a same-cycle admin_branch_reconcile dry-run is required.`);
    err.status = 400;
    err.code = "github_branch_fast_forward_dry_run_evidence_required";
    err.details = { field, secrets_included: false };
    throw err;
  }
  return sha.toLowerCase();
}

function assertExpectedDryRunEvidence({ expectedBaseSha, expectedBranchSha, baseRef, branchRef }) {
  const currentBaseSha = String(baseRef?.object?.sha || baseRef?.sha || "").trim().toLowerCase();
  const currentBranchSha = String(branchRef?.object?.sha || branchRef?.sha || "").trim().toLowerCase();
  if (currentBaseSha !== expectedBaseSha || currentBranchSha !== expectedBranchSha) {
    const err = new Error("GitHub branch fast-forward requires fresh dry-run evidence; current refs differ from expected refs.");
    err.status = 409;
    err.code = "github_branch_fast_forward_stale_dry_run_evidence";
    err.details = {
      expected_base_sha: expectedBaseSha,
      current_base_sha: currentBaseSha || null,
      expected_branch_sha: expectedBranchSha,
      current_branch_sha: currentBranchSha || null,
      secrets_included: false,
    };
    throw err;
  }
}

export async function runGithubBranchFastForwardToBase(args = {}, deps = {}) {
  const expectedBaseSha = requireExpectedDryRunSha(args.expected_base_sha || args.base_ref_sha, "expected_base_sha");
  const expectedBranchSha = requireExpectedDryRunSha(args.expected_branch_sha || args.branch_ref_sha, "expected_branch_sha");
  const target = await resolveBranchReconcileTarget({ ...args, mode: "apply" });
  const token = deps.token || await getGitHubAppInstallationToken({});
  const fetchImpl = deps.fetchImpl || fetch;
  const before = await loadBranchReconcileEvidence({ target: { ...target, confirm: args.confirm || "" }, token, fetchImpl });
  assertExpectedDryRunEvidence({ expectedBaseSha, expectedBranchSha, baseRef: before.baseRef, branchRef: before.branchRef });
  if (before.classification?.classification !== "behind_only") {
    const err = new Error("GitHub branch fast-forward only supports behind_only branches.");
    err.status = 409;
    err.code = "github_branch_fast_forward_classification_blocked";
    err.details = { classification: before.classification, dry_run: before.plan?.dry_run, evidence: before.plan?.evidence, secrets_included: false };
    throw err;
  }
  const baseSha = String(before.baseRef?.object?.sha || "").trim();
  const update = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: `/git/refs/heads/${encodeRef(target.branch)}`,
    method: "PATCH",
    token,
    fetchImpl,
    body: { sha: baseSha, force: false },
  });
  const after = await loadBranchReconcileEvidence({ target: { ...target, mode: "dry_run", confirm: "" }, token, fetchImpl });
  const readbackOk = after.classification?.classification === "up_to_date";
  const result = {
    ok: readbackOk,
    adapter: ADMIN_BRANCH_RECONCILIATION_ADAPTER_VERSION,
    recipe_key: "github.branch.fast_forward_to_base",
    action: "github_branch_fast_forward_to_base",
    mode: "apply",
    target: { owner: target.owner, repo: target.repo, branch: target.branch, default_branch: target.default_branch },
    before: { classification: before.classification, evidence: before.plan?.evidence, dry_run: before.plan?.dry_run, secrets_included: false },
    update: { ref: update?.ref || null, branch_sha: update?.object?.sha || null, forced: false, secrets_included: false },
    after: { classification: after.classification, evidence: after.plan?.evidence, secrets_included: false },
    verification: { ok: readbackOk, expected_classification: "up_to_date", actual_classification: after.classification?.classification || null, secrets_included: false },
    capability_envelope_id: args.capability_envelope_id || null,
    secrets_included: false,
  };
  writeAuditLogAsync({
    action: "github_branch_fast_forward_to_base",
    resource_type: "github_branch",
    resource_id: `${target.owner}/${target.repo}:${target.branch}`,
    payload: {
      target: result.target,
      before: result.before,
      update: result.update,
      after: result.after,
      verification: result.verification,
      capability_envelope_id: args.capability_envelope_id || null,
      principal: deps?.auth?.user_id || deps?.auth?.mode || "admin",
      secrets_included: false,
    },
  });
  if (!readbackOk) {
    const err = new Error("GitHub branch fast-forward applied but readback verification did not reach up_to_date.");
    err.status = 502;
    err.code = "github_branch_fast_forward_readback_failed";
    err.details = result;
    throw err;
  }
  return result;
}

function requireMergeCommitSha(value, field) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    const err = new Error(`${field} must be a 40-character Git commit SHA.`);
    err.status = 400;
    err.code = "github_branch_merge_commit_sha_required";
    err.details = { field, secrets_included: false };
    throw err;
  }
  return sha;
}

function sortedUnique(values = []) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))).sort();
}

export function validateGithubMergeResolutionEvidence({
  resolution_commit: resolutionCommit = {},
  resolution_compare: resolutionCompare = {},
  expected_base_sha: expectedBaseSha = "",
  branch_changed_files: branchChangedFiles = [],
} = {}) {
  const expectedBase = String(expectedBaseSha || "").trim().toLowerCase();
  const parents = (resolutionCommit.parents || []).map((parent) => String(parent?.sha || "").trim().toLowerCase()).filter(Boolean);
  const treeSha = String(resolutionCommit?.tree?.sha || "").trim().toLowerCase();
  const branchFiles = sortedUnique(branchChangedFiles);
  const resolutionFiles = fileList(resolutionCompare);
  const branchSet = new Set(branchFiles);
  const resolutionSet = new Set(resolutionFiles);
  const missingFiles = branchFiles.filter((file) => !resolutionSet.has(file));
  const extraFiles = resolutionFiles.filter((file) => !branchSet.has(file));
  const reasons = [];

  if (branchFiles.length === 0) reasons.push("branch_changed_files_empty");
  if (branchFiles.length > MAX_BRANCH_MERGE_RESOLUTION_FILES || resolutionFiles.length > MAX_BRANCH_MERGE_RESOLUTION_FILES) {
    reasons.push("resolution_commit_file_scope_exceeds_limit");
  }

  if (parents.length !== 1 || parents[0] !== expectedBase) reasons.push("resolution_commit_must_have_expected_base_as_sole_parent");
  if (!/^[0-9a-f]{40}$/.test(treeSha)) reasons.push("resolution_commit_tree_missing");
  if (String(resolutionCompare.status || "").toLowerCase() !== "ahead") reasons.push("resolution_commit_must_be_ahead_of_expected_base");
  if (Number(resolutionCompare.behind_by || 0) !== 0) reasons.push("resolution_commit_must_not_be_behind_expected_base");
  if (missingFiles.length > 0) reasons.push("resolution_commit_missing_branch_changed_files");
  if (extraFiles.length > 0) reasons.push("resolution_commit_changes_files_outside_branch_scope");

  return {
    ok: reasons.length === 0,
    reasons,
    tree_sha: treeSha || null,
    expected_base_sha: expectedBase || null,
    resolution_parent_shas: parents,
    branch_changed_files: branchFiles,
    resolution_changed_files: resolutionFiles,
    missing_files: missingFiles,
    extra_files: extraFiles,
    secrets_included: false,
  };
}

export async function runGithubBranchMergeCommitCreate(args = {}, deps = {}) {
  const expectedBaseSha = requireMergeCommitSha(args.expected_base_sha || args.base_ref_sha, "expected_base_sha");
  const expectedBranchSha = requireMergeCommitSha(args.expected_branch_sha || args.branch_ref_sha, "expected_branch_sha");
  const resolutionCommitSha = requireMergeCommitSha(args.resolution_commit_sha, "resolution_commit_sha");
  const target = await resolveBranchReconcileTarget({ ...args, mode: "dry_run", confirm: "" });
  const requiredConfirm = branchMergeCommitConfirmation(target.branch);
  if (String(args.confirm || "") !== requiredConfirm) {
    const err = new Error(`GitHub branch merge commit creation requires confirm=${requiredConfirm}.`);
    err.status = 400;
    err.code = "github_branch_merge_commit_confirmation_required";
    err.details = { branch: target.branch, expected_confirm: requiredConfirm, secrets_included: false };
    throw err;
  }

  const token = deps.token || await getGitHubAppInstallationToken({});
  const fetchImpl = deps.fetchImpl || fetch;
  const before = await loadBranchReconcileEvidence({ target: { ...target, mode: "dry_run", confirm: "" }, token, fetchImpl });
  const currentBaseSha = String(before.baseRef?.object?.sha || before.baseRef?.sha || "").trim().toLowerCase();
  const currentBranchSha = String(before.branchRef?.object?.sha || before.branchRef?.sha || "").trim().toLowerCase();
  if (currentBaseSha !== expectedBaseSha || currentBranchSha !== expectedBranchSha) {
    const err = new Error("GitHub branch merge commit creation requires fresh same-cycle ref evidence.");
    err.status = 409;
    err.code = "github_branch_merge_commit_stale_dry_run_evidence";
    err.details = {
      expected_base_sha: expectedBaseSha,
      current_base_sha: currentBaseSha || null,
      expected_branch_sha: expectedBranchSha,
      current_branch_sha: currentBranchSha || null,
      secrets_included: false,
    };
    throw err;
  }

  const classification = before.classification?.classification || null;
  if (!["diverged_no_overlap", "diverged_same_files"].includes(classification)) {
    const err = new Error("GitHub branch merge commit creation only supports diverged work branches with an explicit resolution commit.");
    err.status = 409;
    err.code = "github_branch_merge_commit_classification_blocked";
    err.details = { classification: before.classification, evidence: before.plan?.evidence, secrets_included: false };
    throw err;
  }

  const resolutionCommit = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: `/git/commits/${encodeURIComponent(resolutionCommitSha)}`,
    token,
    fetchImpl,
  });
  const resolutionCompare = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: `/compare/${encodeCompareRef(expectedBaseSha)}...${encodeCompareRef(resolutionCommitSha)}`,
    token,
    fetchImpl,
  });
  const resolution = validateGithubMergeResolutionEvidence({
    resolution_commit: resolutionCommit,
    resolution_compare: resolutionCompare,
    expected_base_sha: expectedBaseSha,
    branch_changed_files: before.classification?.changed_files || [],
  });
  if (!resolution.ok) {
    const err = new Error("Resolution commit failed governed merge-tree validation.");
    err.status = 409;
    err.code = "github_branch_merge_commit_resolution_invalid";
    err.details = resolution;
    throw err;
  }

  const commitMessage = String(args.commit_message || `Merge ${target.default_branch} into ${target.branch} using governed resolution ${resolutionCommitSha.slice(0, 12)}`).trim();
  if (commitMessage.length < 5 || commitMessage.length > 5000) {
    const err = new Error("commit_message must contain 5 to 5000 characters.");
    err.status = 400;
    err.code = "github_branch_merge_commit_message_invalid";
    throw err;
  }

  const created = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: "/git/commits",
    method: "POST",
    token,
    fetchImpl,
    body: {
      message: commitMessage,
      tree: resolution.tree_sha,
      parents: [expectedBranchSha, expectedBaseSha],
    },
  });
  const mergeCommitSha = requireMergeCommitSha(created?.sha, "created_merge_commit_sha");
  const update = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: `/git/refs/heads/${encodeRef(target.branch)}`,
    method: "PATCH",
    token,
    fetchImpl,
    body: { sha: mergeCommitSha, force: false },
  });

  const [readbackRef, readbackCommit, after] = await Promise.all([
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/git/ref/heads/${encodeRef(target.branch)}`, token, fetchImpl }),
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/git/commits/${encodeURIComponent(mergeCommitSha)}`, token, fetchImpl }),
    loadBranchReconcileEvidence({ target: { ...target, mode: "dry_run", confirm: "" }, token, fetchImpl }),
  ]);
  const readbackParents = (readbackCommit.parents || []).map((parent) => String(parent?.sha || "").trim().toLowerCase());
  const readbackTreeSha = String(readbackCommit?.tree?.sha || "").trim().toLowerCase();
  const refSha = String(readbackRef?.object?.sha || "").trim().toLowerCase();
  const ancestryOk = readbackParents.length === 2
    && readbackParents[0] === expectedBranchSha
    && readbackParents[1] === expectedBaseSha;
  const readbackOk = refSha === mergeCommitSha
    && ancestryOk
    && readbackTreeSha === resolution.tree_sha
    && after.classification?.classification === "ahead_only"
    && Number(after.classification?.behind_by || 0) === 0;

  const result = {
    ok: readbackOk,
    adapter: ADMIN_BRANCH_RECONCILIATION_ADAPTER_VERSION,
    recipe_key: "github.branch.create_multi_parent_merge_commit",
    action: "github_branch_merge_commit_create",
    mode: "apply",
    target: { owner: target.owner, repo: target.repo, branch: target.branch, default_branch: target.default_branch },
    before: { classification: before.classification, evidence: before.plan?.evidence, secrets_included: false },
    resolution: { commit_sha: resolutionCommitSha, ...resolution },
    commit: {
      sha: mergeCommitSha,
      tree_sha: resolution.tree_sha,
      parent_shas: [expectedBranchSha, expectedBaseSha],
      message: commitMessage,
      secrets_included: false,
    },
    update: { ref: update?.ref || null, branch_sha: update?.object?.sha || null, forced: false, secrets_included: false },
    after: { classification: after.classification, evidence: after.plan?.evidence, secrets_included: false },
    verification: {
      ok: readbackOk,
      ref_sha_matches: refSha === mergeCommitSha,
      parent_order_matches: ancestryOk,
      tree_sha_matches: readbackTreeSha === resolution.tree_sha,
      branch_classification: after.classification?.classification || null,
      behind_by: Number(after.classification?.behind_by || 0),
      secrets_included: false,
    },
    capability_envelope_id: args.capability_envelope_id || null,
    secrets_included: false,
  };

  writeAuditLogAsync({
    action: "github_branch_merge_commit_create",
    resource_type: "github_branch",
    resource_id: `${target.owner}/${target.repo}:${target.branch}`,
    payload: {
      target: result.target,
      before: result.before,
      resolution: result.resolution,
      commit: result.commit,
      update: result.update,
      after: result.after,
      verification: result.verification,
      capability_envelope_id: args.capability_envelope_id || null,
      principal: deps?.auth?.user_id || deps?.auth?.mode || "admin",
      secrets_included: false,
    },
  });

  if (!readbackOk) {
    const err = new Error("GitHub multi-parent merge commit was created or applied, but same-cycle ancestry/readback verification failed.");
    err.status = 502;
    err.code = "github_branch_merge_commit_readback_failed";
    err.details = result;
    throw err;
  }
  return result;
}

function smokeBranchName(seed = "") {
  const safeSeed = String(seed || Date.now())
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || String(Date.now());
  return `gpt/fast-forward-smoke-${safeSeed}`;
}

async function deleteGithubBranchRef({ owner, repo, branch, token, fetchImpl }) {
  try {
    await githubJson({ owner, repo, apiPath: `/git/refs/heads/${encodeRef(branch)}`, method: "DELETE", token, fetchImpl });
    return { ok: true, deleted: true, branch, secrets_included: false };
  } catch (err) {
    if (err?.status === 404) return { ok: true, deleted: false, already_missing: true, branch, secrets_included: false };
    return { ok: false, deleted: false, branch, error: { code: err?.code || "github_branch_smoke_cleanup_failed", message: err?.message || "Smoke branch cleanup failed.", details: err?.details }, secrets_included: false };
  }
}

export async function runGithubBranchFastForwardSmoke(args = {}, deps = {}) {
  const cfg = await resolveActivationBootstrapConfig({});
  const owner = String(args.owner || cfg?.config?.github_owner || "").trim();
  const repo = String(args.repo || cfg?.config?.github_repo || "").trim();
  const defaultBranch = String(args.default_branch || args.base_branch || cfg?.config?.github_branch || "main").trim() || "main";
  if (!owner || !repo) {
    const err = new Error("github owner/repo are required for github_branch_fast_forward_smoke.");
    err.status = 400;
    err.code = "github_branch_smoke_repo_required";
    throw err;
  }
  const branch = smokeBranchName(args.smoke_id || args.seed || "");
  const token = deps.token || await getGitHubAppInstallationToken({});
  const fetchImpl = deps.fetchImpl || fetch;
  let cleanup = { ok: true, deleted: false, branch, secrets_included: false };
  let createdRef = null;
  let result = null;
  try {
    const baseRef = await githubJson({ owner, repo, apiPath: `/git/ref/heads/${encodeRef(defaultBranch)}`, token, fetchImpl });
    const baseSha = String(baseRef?.object?.sha || "").trim();
    const baseCommit = await githubJson({ owner, repo, apiPath: `/commits/${encodeURIComponent(baseSha)}`, token, fetchImpl });
    const parentSha = String(baseCommit?.parents?.[0]?.sha || "").trim();
    if (!/^[0-9a-f]{40}$/i.test(parentSha)) {
      const err = new Error("Default branch parent commit was not available for smoke setup.");
      err.status = 409;
      err.code = "github_branch_smoke_parent_unavailable";
      err.details = { default_branch: defaultBranch, base_sha: baseSha || null, secrets_included: false };
      throw err;
    }
    createdRef = await githubJson({
      owner,
      repo,
      apiPath: "/git/refs",
      method: "POST",
      token,
      fetchImpl,
      body: { ref: `refs/heads/${branch}`, sha: parentSha },
    });
    const dryRun = await runAdminBranchReconcile({ owner, repo, branch, default_branch: defaultBranch, mode: "dry_run" }, { ...deps, token, fetchImpl });
    if (dryRun?.classification?.classification !== "behind_only") {
      const err = new Error("Smoke branch did not classify as behind_only after setup.");
      err.status = 409;
      err.code = "github_branch_smoke_unexpected_classification";
      err.details = { classification: dryRun?.classification || null, evidence: dryRun?.evidence || null, secrets_included: false };
      throw err;
    }
    const apply = await runGithubBranchFastForwardToBase({
      owner,
      repo,
      branch,
      default_branch: defaultBranch,
      expected_base_sha: dryRun?.evidence?.base_ref_sha,
      expected_branch_sha: dryRun?.evidence?.branch_ref_sha,
      confirm: dryRun?.dry_run?.required_confirm_for_future_apply || branchReconcileConfirmation(branch),
      capability_envelope_id: args.capability_envelope_id || null,
    }, { ...deps, token, fetchImpl });
    result = {
      ok: apply?.verification?.ok === true,
      adapter: ADMIN_BRANCH_RECONCILIATION_ADAPTER_VERSION,
      recipe_key: "github.branch.fast_forward_smoke",
      action: "github_branch_fast_forward_smoke",
      target: { owner, repo, default_branch: defaultBranch, branch },
      setup: { created_ref: createdRef?.ref || null, base_sha: baseSha, parent_sha: parentSha, secrets_included: false },
      dry_run: { classification: dryRun?.classification, evidence: dryRun?.evidence, secrets_included: false },
      apply,
      cleanup: { pending: true, branch, secrets_included: false },
      capability_envelope_id: args.capability_envelope_id || null,
      secrets_included: false,
    };
    return result;
  } finally {
    cleanup = await deleteGithubBranchRef({ owner, repo, branch, token, fetchImpl });
    if (result) result.cleanup = cleanup;
    writeAuditLogAsync({
      action: "github_branch_fast_forward_smoke",
      resource_type: "github_branch",
      resource_id: `${owner}/${repo}:${branch}`,
      payload: {
        branch,
        default_branch: defaultBranch,
        created_ref: createdRef?.ref || null,
        result_ok: result?.ok || false,
        cleanup,
        capability_envelope_id: args.capability_envelope_id || null,
        principal: deps?.auth?.user_id || deps?.auth?.mode || "admin",
        secrets_included: false,
      },
    });
  }
}
