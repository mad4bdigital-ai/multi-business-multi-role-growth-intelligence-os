import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { writeAuditLogAsync } from "./auditLogger.js";
import {
  assertAdminBranchReconcileTarget,
  assertRepositoryReconciliationMergeLease,
  runAdminBranchReconcile,
  validateGithubMergeResolutionEvidence,
} from "./adminBranchReconciliationAdapter.js";

export const REPOSITORY_DETACHED_RESOLUTION_BUILDER_VERSION = "repository-detached-resolution-builder-v1";
const MAX_RESOLUTION_FILES = 50;
const ALLOWED_BLOB_MODES = new Set(["100644", "100755"]);

function fail(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function requireSha(value, field) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw fail("github_detached_resolution_sha_required", `${field} must be a 40-character Git SHA.`, 400, { field });
  }
  return sha;
}

function safePath(value) {
  const path = String(value || "").trim();
  if (!path || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return false;
  return true;
}

function sortedUnique(values = []) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))).sort();
}

export function branchDetachedResolutionCommitConfirmation(branch = "") {
  return `CREATE_DETACHED_RESOLUTION_COMMIT_${String(branch || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()}`;
}

export function validateDetachedResolutionEntries({ entries = [], branch_changed_files: branchChangedFiles = [] } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw fail("github_detached_resolution_entries_required", "At least one detached resolution tree entry is required.");
  }
  if (entries.length > MAX_RESOLUTION_FILES) {
    throw fail("github_detached_resolution_scope_exceeds_limit", `Detached resolution entries may contain at most ${MAX_RESOLUTION_FILES} files.`, 400, { count: entries.length });
  }

  const normalized = entries.map((entry, index) => {
    const path = String(entry?.path || "").trim();
    const mode = String(entry?.mode || "").trim();
    const type = String(entry?.type || "blob").trim().toLowerCase();
    const sha = String(entry?.sha || "").trim().toLowerCase();
    if (!safePath(path)) throw fail("github_detached_resolution_path_invalid", "Detached resolution entry path is invalid.", 400, { index, path: path || null });
    if (!ALLOWED_BLOB_MODES.has(mode)) throw fail("github_detached_resolution_mode_invalid", "Detached resolution entry mode must be 100644 or 100755.", 400, { index, path, mode: mode || null });
    if (type !== "blob") throw fail("github_detached_resolution_type_invalid", "Detached resolution entries must be Git blobs.", 400, { index, path, type });
    if (!/^[0-9a-f]{40}$/.test(sha)) throw fail("github_detached_resolution_blob_sha_invalid", "Detached resolution entry sha must be a 40-character Git blob SHA.", 400, { index, path });
    return { path, mode, type: "blob", sha };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const paths = normalized.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) {
    throw fail("github_detached_resolution_duplicate_path", "Detached resolution entries must contain unique paths.");
  }

  const expectedFiles = sortedUnique(branchChangedFiles);
  if (expectedFiles.length > 0) {
    const actualFiles = [...paths].sort();
    const expectedSet = new Set(expectedFiles);
    const actualSet = new Set(actualFiles);
    const missingFiles = expectedFiles.filter((path) => !actualSet.has(path));
    const extraFiles = actualFiles.filter((path) => !expectedSet.has(path));
    if (missingFiles.length || extraFiles.length) {
      throw fail("github_detached_resolution_file_scope_mismatch", "Detached resolution entries must exactly match the work-branch changed-file set.", 409, {
        expected_files: expectedFiles,
        actual_files: actualFiles,
        missing_files: missingFiles,
        extra_files: extraFiles,
      });
    }
  }
  return normalized;
}

async function githubJson({ owner, repo, apiPath, token, method = "GET", body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "mad4b-repository-detached-resolution-builder",
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw fail("github_detached_resolution_provider_request_failed", payload?.message || `GitHub request failed with HTTP ${response.status}.`, response.status >= 400 && response.status < 500 ? response.status : 502, {
      provider_status: response.status,
      api_path: apiPath,
    });
  }
  return payload;
}

async function resolveTarget(args = {}) {
  let owner = String(args.owner || "").trim();
  let repo = String(args.repo || "").trim();
  let defaultBranch = String(args.default_branch || args.base_branch || "").trim();
  if (!owner || !repo || !defaultBranch) {
    const cfg = await resolveActivationBootstrapConfig({});
    owner ||= String(cfg?.config?.github_owner || "").trim();
    repo ||= String(cfg?.config?.github_repo || "").trim();
    defaultBranch ||= String(cfg?.config?.github_branch || "main").trim();
  }
  defaultBranch ||= "main";
  if (!owner || !repo) throw fail("github_detached_resolution_repo_required", "github owner/repo are required for detached resolution construction.");
  const guarded = assertAdminBranchReconcileTarget({ branch: args.branch, default_branch: defaultBranch, mode: "dry_run" });
  return { owner, repo, branch: guarded.branch, default_branch: guarded.default_branch };
}

function exactBeforeEvidence(before = {}, expectedBaseSha, expectedBranchSha) {
  const currentBaseSha = String(before?.evidence?.base_ref_sha || "").trim().toLowerCase();
  const currentBranchSha = String(before?.evidence?.branch_ref_sha || "").trim().toLowerCase();
  if (currentBaseSha !== expectedBaseSha || currentBranchSha !== expectedBranchSha) {
    throw fail("github_detached_resolution_stale_ref_evidence", "Detached resolution construction requires fresh same-cycle base/head evidence.", 409, {
      expected_base_sha: expectedBaseSha,
      current_base_sha: currentBaseSha || null,
      expected_branch_sha: expectedBranchSha,
      current_branch_sha: currentBranchSha || null,
    });
  }
}

export async function runGithubDetachedResolutionCommitCreate(args = {}, deps = {}) {
  const repositoryLease = await assertRepositoryReconciliationMergeLease(args, deps);
  const expectedBaseSha = requireSha(args.expected_base_sha || args.base_ref_sha, "expected_base_sha");
  const expectedBranchSha = requireSha(args.expected_branch_sha || args.branch_ref_sha, "expected_branch_sha");
  if (args.force === true || args.force_push === true || args.force_ref_update === true) {
    throw fail("github_detached_resolution_force_forbidden", "Detached resolution construction forbids force and ref-update flags.", 403);
  }

  const target = await resolveTarget(args);
  const requiredConfirm = branchDetachedResolutionCommitConfirmation(target.branch);
  if (String(args.confirm || "") !== requiredConfirm) {
    throw fail("github_detached_resolution_confirmation_required", `Detached resolution construction requires confirm=${requiredConfirm}.`, 400, {
      branch: target.branch,
      expected_confirm: requiredConfirm,
    });
  }
  const requestedEntries = validateDetachedResolutionEntries({ entries: args.entries || args.resolution_entries || [] });

  const token = deps.token || await getGitHubAppInstallationToken({});
  const fetchImpl = deps.fetchImpl || fetch;
  const before = await runAdminBranchReconcile({
    owner: target.owner,
    repo: target.repo,
    branch: target.branch,
    default_branch: target.default_branch,
    mode: "dry_run",
  }, { ...deps, token, fetchImpl });
  exactBeforeEvidence(before, expectedBaseSha, expectedBranchSha);

  const classification = before?.classification?.classification || null;
  if (!["diverged_no_overlap", "diverged_same_files"].includes(classification)) {
    throw fail("github_detached_resolution_classification_blocked", "Detached resolution construction only supports diverged governed work branches.", 409, {
      classification: before?.classification || null,
    });
  }
  const entries = validateDetachedResolutionEntries({
    entries: requestedEntries,
    branch_changed_files: before?.classification?.changed_files || [],
  });

  const baseCommit = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: `/git/commits/${encodeURIComponent(expectedBaseSha)}`,
    token,
    fetchImpl,
  });
  const baseTreeSha = requireSha(baseCommit?.tree?.sha, "base_tree_sha");
  const createdTree = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: "/git/trees",
    method: "POST",
    token,
    fetchImpl,
    body: { base_tree: baseTreeSha, tree: entries },
  });
  const treeSha = requireSha(createdTree?.sha, "created_tree_sha");
  const commitMessage = String(args.commit_message || `Build detached reconciliation resolution for ${target.branch}`).trim();
  if (commitMessage.length < 5 || commitMessage.length > 5000) {
    throw fail("github_detached_resolution_message_invalid", "commit_message must contain 5 to 5000 characters.");
  }
  const createdCommit = await githubJson({
    owner: target.owner,
    repo: target.repo,
    apiPath: "/git/commits",
    method: "POST",
    token,
    fetchImpl,
    body: { message: commitMessage, tree: treeSha, parents: [expectedBaseSha] },
  });
  const resolutionCommitSha = requireSha(createdCommit?.sha, "created_resolution_commit_sha");

  const [readbackCommit, resolutionCompare, after] = await Promise.all([
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/git/commits/${encodeURIComponent(resolutionCommitSha)}`, token, fetchImpl }),
    githubJson({ owner: target.owner, repo: target.repo, apiPath: `/compare/${encodeURIComponent(expectedBaseSha)}...${encodeURIComponent(resolutionCommitSha)}`, token, fetchImpl }),
    runAdminBranchReconcile({ owner: target.owner, repo: target.repo, branch: target.branch, default_branch: target.default_branch, mode: "dry_run" }, { ...deps, token, fetchImpl }),
  ]);
  const resolution = validateGithubMergeResolutionEvidence({
    resolution_commit: readbackCommit,
    resolution_compare: resolutionCompare,
    expected_base_sha: expectedBaseSha,
    branch_changed_files: before?.classification?.changed_files || [],
  });
  const readbackParents = (readbackCommit?.parents || []).map((parent) => String(parent?.sha || "").trim().toLowerCase());
  const readbackTreeSha = String(readbackCommit?.tree?.sha || "").trim().toLowerCase();
  const afterBaseSha = String(after?.evidence?.base_ref_sha || "").trim().toLowerCase();
  const afterBranchSha = String(after?.evidence?.branch_ref_sha || "").trim().toLowerCase();
  const baseRefUnchanged = afterBaseSha === expectedBaseSha;
  const branchRefUnchanged = afterBranchSha === expectedBranchSha;
  const readbackOk = resolution.ok
    && readbackParents.length === 1
    && readbackParents[0] === expectedBaseSha
    && readbackTreeSha === treeSha
    && baseRefUnchanged
    && branchRefUnchanged;

  const result = {
    ok: readbackOk,
    version: REPOSITORY_DETACHED_RESOLUTION_BUILDER_VERSION,
    recipe_key: "repo.pr.reconcile_and_finalize",
    action: "github_detached_resolution_commit_create",
    mode: "apply",
    detached: true,
    target,
    before: { classification: before?.classification || null, evidence: before?.evidence || null, secrets_included: false },
    resolution: {
      commit_sha: resolutionCommitSha,
      tree_sha: treeSha,
      parent_shas: readbackParents,
      changed_files: resolution.resolution_changed_files,
      validation: resolution,
      secrets_included: false,
    },
    verification: {
      ok: readbackOk,
      resolution_valid: resolution.ok,
      sole_parent_matches_base: readbackParents.length === 1 && readbackParents[0] === expectedBaseSha,
      tree_sha_matches: readbackTreeSha === treeSha,
      base_ref_unchanged: baseRefUnchanged,
      branch_ref_unchanged: branchRefUnchanged,
      ref_update_attempted: false,
      force_push_allowed: false,
      secrets_included: false,
    },
    repository_lease: {
      lease_id: repositoryLease.lease_id,
      holder_run_id: repositoryLease.holder_run_id,
      resource_fingerprint: repositoryLease.resource_fingerprint,
      lease_status: repositoryLease.lease_status,
      secrets_included: false,
    },
    capability_envelope_id: args.capability_envelope_id || null,
    secrets_included: false,
  };

  writeAuditLogAsync({
    action: "github_detached_resolution_commit_create",
    resource_type: "github_repository_git_object",
    resource_id: `${target.owner}/${target.repo}:${resolutionCommitSha}`,
    payload: {
      target,
      resolution: result.resolution,
      verification: result.verification,
      repository_lease: result.repository_lease,
      capability_envelope_id: args.capability_envelope_id || null,
      principal: deps?.auth?.user_id || deps?.auth?.mode || "admin",
      secrets_included: false,
    },
  });

  if (!readbackOk) {
    const error = fail("github_detached_resolution_commit_readback_failed", "Detached resolution Git objects were created, but same-cycle validation failed. No repository ref was updated by this operation.", 502, {
      result,
      detached_object_may_exist: true,
      ref_update_attempted: false,
    });
    throw error;
  }
  return result;
}
