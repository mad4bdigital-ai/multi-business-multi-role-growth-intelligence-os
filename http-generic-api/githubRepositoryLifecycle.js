import { createHash } from "node:crypto";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod"]);
const DEFAULT_DISPOSABLE_BRANCH_PREFIXES = Object.freeze([
  "gpt/", "docs-agent/", "chore/", "docs/", "automation/", "feature/", "fix/", "hotfix/",
  "audit/", "surface-contract-auto/", "bugfix/", "ci/", "infra/", "refactor/", "security/",
  "perf/", "sync/", "platform/", "admin/", "task/", "work/", "migration/", "claude/",
  "codex/", "agent/", "backup/", "cleanup/", "patch/", "revert/",
]);
const DEFAULT_REQUIRED_CHECKS = Object.freeze([
  "Syntax Check",
  "Architecture Drift Detection",
  "Execution Resolver Gate",
  "Unit & Integration Tests",
]);

function lifecycleError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function encodeBranch(branch = "") {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

function normalizeSha(value = "") {
  const sha = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

function normalizeBranch(branch = "") {
  return String(branch || "").trim().replace(/^refs\/heads\//, "");
}

export function githubBranchDeleteConfirmation(branch = "") {
  const slug = normalizeBranch(branch)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `DELETE_BRANCH_${slug}`;
}

export async function resolveGithubLifecycleTarget(overrides = {}) {
  const explicitOwner = String(overrides.owner || "").trim();
  const explicitRepo = String(overrides.repo || "").trim();
  if (explicitOwner && explicitRepo) {
    return {
      owner: explicitOwner,
      repo: explicitRepo,
      defaultBranch: String(overrides.default_branch || overrides.defaultBranch || "main").trim() || "main",
    };
  }
  const cfg = await resolveActivationBootstrapConfig({});
  const owner = String(cfg?.config?.github_owner || "").trim();
  const repo = String(cfg?.config?.github_repo || "").trim();
  const defaultBranch = String(overrides.default_branch || overrides.defaultBranch || cfg?.config?.github_branch || "main").trim() || "main";
  if (!owner || !repo) {
    throw lifecycleError(500, "github_lifecycle_target_unresolved", "GitHub owner/repository could not be resolved from bootstrap authority.", {
      bootstrap_ok: cfg?.ok === true,
      secrets_included: false,
    });
  }
  return { owner, repo, defaultBranch };
}

function githubHeaders(token, method = "GET") {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mad4b-growth-os-github-lifecycle",
    ...(method === "GET" || method === "DELETE" ? {} : { "Content-Type": "application/json" }),
  };
}

export async function githubLifecycleRequest({ owner, repo, apiPath, method = "GET", body, token, fetchImpl = fetch, allowNotFound = false }) {
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${apiPath}`, {
    method,
    headers: githubHeaders(token, method),
    body: body === undefined || method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    throw lifecycleError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      response.status === 409 ? "github_lifecycle_conflict" : response.status === 422 ? "github_lifecycle_validation_failed" : "github_lifecycle_request_failed",
      payload?.message || `GitHub request failed with HTTP ${response.status}.`,
      { upstream_status: response.status, api_path: apiPath, github_error: payload || null, secrets_included: false }
    );
  }
  return { ok: response.ok, status: response.status, payload };
}

async function lifecycleContext(options = {}) {
  const target = await resolveGithubLifecycleTarget(options);
  const token = options.token || await getGitHubAppInstallationToken({});
  return { ...target, token };
}

function assertDeletableBranch({ branch, defaultBranch, allowedPrefixes = DEFAULT_DISPOSABLE_BRANCH_PREFIXES }) {
  const normalized = normalizeBranch(branch);
  const normalizedDefault = normalizeBranch(defaultBranch);
  if (!normalized) throw lifecycleError(400, "github_branch_required", "branch is required.");
  if (normalized === normalizedDefault || PROTECTED_BRANCHES.has(normalized)) {
    throw lifecycleError(403, "github_branch_delete_protected", `Refusing to delete protected/default branch '${normalized}'.`, { branch: normalized, default_branch: normalizedDefault || null });
  }
  if (Array.isArray(allowedPrefixes) && allowedPrefixes.length && !allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    throw lifecycleError(403, "github_branch_delete_prefix_blocked", "Branch deletion is restricted to governed disposable branch prefixes.", {
      branch: normalized,
      allowed_prefixes: allowedPrefixes,
    });
  }
  return normalized;
}

export async function deleteGithubBranchRef(options = {}) {
  const { owner, repo, defaultBranch: configuredDefaultBranch, token } = await lifecycleContext(options);
  const repository = await githubLifecycleRequest({ owner, repo, apiPath: "", token, fetchImpl: options.fetchImpl });
  const actualDefaultBranch = normalizeBranch(repository.payload?.default_branch || configuredDefaultBranch);
  if (!actualDefaultBranch) {
    throw lifecycleError(502, "github_default_branch_unresolved", "GitHub repository default branch could not be resolved.", {
      owner,
      repo,
      configured_default_branch: configuredDefaultBranch || null,
    });
  }
  const branch = assertDeletableBranch({
    branch: options.branch,
    defaultBranch: actualDefaultBranch,
    allowedPrefixes: options.allowed_prefixes || DEFAULT_DISPOSABLE_BRANCH_PREFIXES,
  });
  const expectedConfirm = githubBranchDeleteConfirmation(branch);
  if (String(options.confirm || "") !== expectedConfirm) {
    throw lifecycleError(400, "github_branch_delete_confirmation_required", `Branch deletion requires confirm=${expectedConfirm}.`, {
      branch,
      expected_confirm: expectedConfirm,
    });
  }
  const refPath = `/git/ref/heads/${encodeBranch(branch)}`;
  const ref = await githubLifecycleRequest({ owner, repo, apiPath: refPath, token, fetchImpl: options.fetchImpl, allowNotFound: true });
  if (ref.status === 404) {
    return { ok: true, branch, deleted: false, already_absent: true, verified_absent: true, default_branch: actualDefaultBranch, secrets_included: false };
  }
  const currentSha = normalizeSha(ref.payload?.object?.sha);
  const expectedHeadSha = normalizeSha(options.expected_head_sha || options.expectedHeadSha);
  if (!expectedHeadSha) {
    throw lifecycleError(400, "github_branch_delete_expected_sha_required", "expected_head_sha is required for branch deletion.", { branch, current_sha: currentSha || null });
  }
  if (currentSha !== expectedHeadSha) {
    throw lifecycleError(409, "github_branch_delete_sha_mismatch", "Branch head changed before deletion.", {
      branch,
      expected_head_sha: expectedHeadSha,
      current_head_sha: currentSha || null,
    });
  }
  const openPrs = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=10`,
    token,
    fetchImpl: options.fetchImpl,
  });
  if (Array.isArray(openPrs.payload) && openPrs.payload.length) {
    throw lifecycleError(409, "github_branch_delete_open_pr", "Branch still has an open pull request and cannot be deleted.", {
      branch,
      open_pull_requests: openPrs.payload.map((pr) => pr.number).filter(Boolean),
    });
  }

  let branchContentEvidence = { check: "merged_pull_request_cleanup", unique_commits: null, compare_status: null };
  if (options.merged_pull_request_cleanup !== true) {
    const compare = await githubLifecycleRequest({
      owner,
      repo,
      apiPath: `/compare/${encodeURIComponent(actualDefaultBranch)}...${encodeURIComponent(expectedHeadSha)}`,
      token,
      fetchImpl: options.fetchImpl,
    });
    const compareStatus = String(compare.payload?.status || "").toLowerCase();
    const aheadBy = Number(compare.payload?.ahead_by ?? -1);
    const noUniqueCommits = aheadBy === 0 && ["behind", "identical"].includes(compareStatus);
    branchContentEvidence = {
      check: "no_unique_commits_against_default_branch",
      unique_commits: aheadBy < 0 ? null : aheadBy,
      compare_status: compareStatus || null,
      behind_by: Number(compare.payload?.behind_by || 0),
      default_branch: actualDefaultBranch,
    };
    if (!noUniqueCommits) {
      throw lifecycleError(409, "github_branch_delete_contains_unique_commits", "Branch contains commits that are not present in the repository default branch.", {
        branch,
        expected_head_sha: expectedHeadSha,
        ...branchContentEvidence,
      });
    }
  }

  const preDeleteRef = await githubLifecycleRequest({ owner, repo, apiPath: refPath, token, fetchImpl: options.fetchImpl, allowNotFound: true });
  if (preDeleteRef.status === 404) {
    return { ok: true, branch, deleted: false, already_absent: true, verified_absent: true, default_branch: actualDefaultBranch, safety_evidence: branchContentEvidence, secrets_included: false };
  }
  const preDeleteSha = normalizeSha(preDeleteRef.payload?.object?.sha);
  if (preDeleteSha !== expectedHeadSha) {
    throw lifecycleError(409, "github_branch_delete_sha_mismatch", "Branch head changed after validation and before deletion.", {
      branch,
      expected_head_sha: expectedHeadSha,
      current_head_sha: preDeleteSha || null,
      validation_phase: "pre_delete_readback",
    });
  }
  await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/git/refs/heads/${encodeBranch(branch)}`,
    method: "DELETE",
    token,
    fetchImpl: options.fetchImpl,
  });
  const readback = await githubLifecycleRequest({ owner, repo, apiPath: refPath, token, fetchImpl: options.fetchImpl, allowNotFound: true });
  if (readback.status !== 404) {
    throw lifecycleError(502, "github_branch_delete_readback_failed", "GitHub branch delete returned success but the ref still exists on readback.", {
      branch,
      expected_head_sha: expectedHeadSha,
      readback_status: readback.status,
    });
  }
  return {
    ok: true,
    branch,
    default_branch: actualDefaultBranch,
    configured_default_branch: normalizeBranch(configuredDefaultBranch) || null,
    expected_head_sha: expectedHeadSha,
    deleted: true,
    already_absent: false,
    verified_absent: true,
    safety_evidence: branchContentEvidence,
    secrets_included: false,
  };
}

export async function closeGithubPullRequest(options = {}) {
  const { owner, repo, defaultBranch, token } = await lifecycleContext(options);
  const pullNumber = Number(options.pull_number || options.pullNumber);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw lifecycleError(400, "github_pull_number_invalid", "pull_number must be a positive integer.");
  }
  const prResponse = await githubLifecycleRequest({ owner, repo, apiPath: `/pulls/${pullNumber}`, token, fetchImpl: options.fetchImpl });
  const pr = prResponse.payload || {};
  const comment = String(options.comment || "").trim();
  if (comment) {
    await githubLifecycleRequest({ owner, repo, apiPath: `/issues/${pullNumber}/comments`, method: "POST", body: { body: comment }, token, fetchImpl: options.fetchImpl });
  }
  const closed = await githubLifecycleRequest({ owner, repo, apiPath: `/pulls/${pullNumber}`, method: "PATCH", body: { state: "closed" }, token, fetchImpl: options.fetchImpl });
  const result = {
    ok: true,
    status: "completed",
    pull_request: { number: pullNumber, state: closed.payload?.state || "closed", html_url: closed.payload?.html_url || pr.html_url || null },
    branch_cleanup: { requested: options.delete_branch === true || options.deleteBranch === true, deleted: false, verified_absent: false },
    secrets_included: false,
  };
  if (!result.branch_cleanup.requested) return result;
  const sameRepository = pr?.head?.repo?.full_name === `${owner}/${repo}`;
  if (!sameRepository || !pr?.head?.ref || !pr?.head?.sha) {
    return {
      ...result,
      ok: false,
      status: "partial_success",
      branch_cleanup: {
        requested: true,
        deleted: false,
        verified_absent: false,
        error: { code: "github_branch_cleanup_unavailable", message: "Pull request was closed, but its head branch is external or missing ref metadata." },
      },
    };
  }
  try {
    result.branch_cleanup = await deleteGithubBranchRef({
      owner,
      repo,
      defaultBranch,
      token,
      fetchImpl: options.fetchImpl,
      branch: pr.head.ref,
      expected_head_sha: options.expected_head_sha || pr.head.sha,
      confirm: options.confirm || githubBranchDeleteConfirmation(pr.head.ref),
      allowed_prefixes: options.allowed_prefixes || DEFAULT_DISPOSABLE_BRANCH_PREFIXES,
    });
    return result;
  } catch (error) {
    return {
      ...result,
      ok: false,
      status: "partial_success",
      branch_cleanup: {
        requested: true,
        deleted: false,
        verified_absent: false,
        branch: pr.head.ref,
        expected_head_sha: options.expected_head_sha || pr.head.sha,
        error: { code: error.code || "github_branch_cleanup_failed", message: error.message, details: error.details || null },
      },
    };
  }
}

function latestCheckByName(checkRuns = []) {
  const latest = new Map();
  for (const check of checkRuns) {
    const current = latest.get(check.name);
    const checkTime = Date.parse(check.completed_at || check.started_at || "") || 0;
    const currentTime = Date.parse(current?.completed_at || current?.started_at || "") || 0;
    if (!current || checkTime >= currentTime) latest.set(check.name, check);
  }
  return latest;
}

export async function getGithubPullRequestCiGate(options = {}) {
  const { owner, repo, token } = await lifecycleContext(options);
  const pullNumber = Number(options.pull_number || options.pullNumber);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) throw lifecycleError(400, "github_pull_number_invalid", "pull_number must be a positive integer.");
  const requiredChecks = Array.isArray(options.required_checks) && options.required_checks.length ? options.required_checks.map(String) : [...DEFAULT_REQUIRED_CHECKS];
  const pr = (await githubLifecycleRequest({ owner, repo, apiPath: `/pulls/${pullNumber}`, token, fetchImpl: options.fetchImpl })).payload;
  const headSha = normalizeSha(pr?.head?.sha);
  const baseRef = String(pr?.base?.ref || "main");
  const headRef = pr?.head?.repo?.full_name === `${owner}/${repo}` ? String(pr?.head?.ref || "") : `${pr?.head?.repo?.owner?.login}:${pr?.head?.ref}`;
  const compare = (await githubLifecycleRequest({ owner, repo, apiPath: `/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`, token, fetchImpl: options.fetchImpl })).payload;
  const checks = (await githubLifecycleRequest({ owner, repo, apiPath: `/commits/${headSha}/check-runs?per_page=100`, token, fetchImpl: options.fetchImpl })).payload;
  const byName = latestCheckByName(checks?.check_runs || []);
  const required = requiredChecks.map((name) => {
    const check = byName.get(name);
    return {
      name,
      present: Boolean(check),
      status: check?.status || "missing",
      conclusion: check?.conclusion || null,
      success: check?.status === "completed" && check?.conclusion === "success",
      html_url: check?.html_url || null,
    };
  });
  const missingChecks = required.filter((item) => !item.present).map((item) => item.name);
  const pendingChecks = required.filter((item) => item.present && item.status !== "completed").map((item) => item.name);
  const failedChecks = required.filter((item) => item.present && item.status === "completed" && item.conclusion !== "success").map((item) => item.name);
  const baseFresh = Number(compare?.behind_by || 0) === 0;
  const mergeable = pr?.mergeable !== false && String(pr?.mergeable_state || "").toLowerCase() !== "dirty";
  const gateStatus = baseFresh && mergeable && !missingChecks.length && !pendingChecks.length && !failedChecks.length ? "pass" : "blocked";
  return {
    ok: true,
    pull_number: pullNumber,
    gate_status: gateStatus,
    head_sha: headSha,
    base_ref: baseRef,
    base_sha: pr?.base?.sha || null,
    compare_status: compare?.status || null,
    ahead_by: Number(compare?.ahead_by || 0),
    behind_by: Number(compare?.behind_by || 0),
    base_is_fresh: baseFresh,
    mergeable,
    mergeable_state: pr?.mergeable_state || null,
    required_check_count: required.length,
    successful_check_count: required.filter((item) => item.success).length,
    missing_checks: missingChecks,
    pending_checks: pendingChecks,
    failed_checks: failedChecks,
    checks: required,
    secrets_included: false,
  };
}

export function githubPullRequestFinalizeConfirmation(pullNumber, headSha = "") {
  const number = Number(pullNumber);
  const sha = normalizeSha(headSha);
  if (!Number.isInteger(number) || number <= 0 || !sha) return "";
  return `FINALIZE_PR_${number}_${sha.slice(0, 12).toUpperCase()}`;
}

export async function finalizeGithubPullRequest(options = {}) {
  const { owner, repo, defaultBranch, token } = await lifecycleContext(options);
  const pullNumber = Number(options.pull_number || options.pullNumber);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw lifecycleError(400, "github_pull_number_invalid", "pull_number must be a positive integer.");
  }
  const expectedHeadSha = normalizeSha(options.expected_head_sha || options.expectedHeadSha);
  const expectedBaseSha = normalizeSha(options.expected_base_sha || options.expectedBaseSha);
  if (!expectedHeadSha || !expectedBaseSha) {
    throw lifecycleError(400, "github_pr_finalize_expected_sha_required", "expected_head_sha and expected_base_sha are required for PR finalization.");
  }
  const expectedConfirm = githubPullRequestFinalizeConfirmation(pullNumber, expectedHeadSha);
  if (String(options.confirm || "") !== expectedConfirm) {
    throw lifecycleError(400, "github_pr_finalize_confirmation_required", `PR finalization requires confirm=${expectedConfirm}.`, {
      pull_number: pullNumber,
      expected_confirm: expectedConfirm,
    });
  }
  const mergeMethod = String(options.merge_method || options.mergeMethod || "merge").trim().toLowerCase();
  if (!new Set(["merge", "squash", "rebase"]).has(mergeMethod)) {
    throw lifecycleError(400, "github_pr_finalize_merge_method_invalid", "merge_method must be merge, squash, or rebase.");
  }

  const gate = await getGithubPullRequestCiGate({ ...options, owner, repo, token, pull_number: pullNumber });
  if (gate.head_sha !== expectedHeadSha || normalizeSha(gate.base_sha) !== expectedBaseSha) {
    throw lifecycleError(409, "github_pr_finalize_sha_mismatch", "Pull request head or base changed after approval.", {
      pull_number: pullNumber,
      expected_head_sha: expectedHeadSha,
      current_head_sha: gate.head_sha || null,
      expected_base_sha: expectedBaseSha,
      current_base_sha: gate.base_sha || null,
    });
  }
  if (gate.gate_status !== "pass") {
    throw lifecycleError(409, "github_pr_finalize_gate_blocked", "Pull request CI/freshness gate is not ready for merge.", gate);
  }

  const pr = (await githubLifecycleRequest({ owner, repo, apiPath: `/pulls/${pullNumber}`, token, fetchImpl: options.fetchImpl })).payload;
  const merge = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/pulls/${pullNumber}/merge`,
    method: "PUT",
    body: {
      merge_method: mergeMethod,
      sha: expectedHeadSha,
      ...(options.commit_title ? { commit_title: String(options.commit_title) } : {}),
      ...(options.commit_message ? { commit_message: String(options.commit_message) } : {}),
    },
    token,
    fetchImpl: options.fetchImpl,
  });
  const mergeSha = normalizeSha(merge.payload?.sha);
  if (!merge.payload?.merged || !mergeSha) {
    throw lifecycleError(409, "github_pr_finalize_merge_not_confirmed", merge.payload?.message || "GitHub did not confirm the pull request merge.", {
      pull_number: pullNumber,
      github_response: merge.payload || null,
    });
  }

  const currentBase = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/git/ref/heads/${encodeBranch(pr?.base?.ref || defaultBranch)}`,
    token,
    fetchImpl: options.fetchImpl,
  });
  const currentBaseSha = normalizeSha(currentBase.payload?.object?.sha);
  const ancestry = await githubLifecycleRequest({ owner, repo, apiPath: `/compare/${mergeSha}...${currentBaseSha}`, token, fetchImpl: options.fetchImpl });
  const ancestryVerified = Number(ancestry.payload?.behind_by || 0) === 0
    && ["ahead", "identical"].includes(String(ancestry.payload?.status || "").toLowerCase());
  if (!ancestryVerified) {
    return {
      ok: false,
      status: "partial_success",
      pull_number: pullNumber,
      merged: true,
      merge_sha: mergeSha,
      merge_method: mergeMethod,
      ancestry_readback: {
        verified: false,
        base_ref: pr?.base?.ref || defaultBranch,
        base_sha: currentBaseSha || null,
        compare_status: ancestry.payload?.status || null,
        ahead_by: Number(ancestry.payload?.ahead_by || 0),
        behind_by: Number(ancestry.payload?.behind_by || 0),
      },
      branch_cleanup: { requested: options.delete_branch !== false, skipped: true, reason: "merge_ancestry_readback_failed" },
      secrets_included: false,
    };
  }

  let branchCleanup = { requested: options.delete_branch !== false, deleted: false, verified_absent: false };
  if (branchCleanup.requested) {
    const sameRepository = pr?.head?.repo?.full_name === `${owner}/${repo}`;
    if (!sameRepository || !pr?.head?.ref) {
      branchCleanup = {
        requested: true,
        deleted: false,
        verified_absent: false,
        error: { code: "github_branch_cleanup_unavailable", message: "PR merged, but its head branch is external or missing ref metadata." },
      };
    } else {
      try {
        branchCleanup = await deleteGithubBranchRef({
          owner,
          repo,
          defaultBranch: pr?.base?.ref || defaultBranch,
          token,
          fetchImpl: options.fetchImpl,
          branch: pr.head.ref,
          expected_head_sha: expectedHeadSha,
          confirm: githubBranchDeleteConfirmation(pr.head.ref),
          allowed_prefixes: options.allowed_prefixes || DEFAULT_DISPOSABLE_BRANCH_PREFIXES,
          merged_pull_request_cleanup: true,
        });
      } catch (error) {
        branchCleanup = {
          requested: true,
          branch: pr.head.ref,
          expected_head_sha: expectedHeadSha,
          deleted: false,
          verified_absent: false,
          error: { code: error.code || "github_branch_cleanup_failed", message: error.message, details: error.details || null },
        };
      }
    }
  }
  const completed = !branchCleanup.requested || branchCleanup.verified_absent === true;
  return {
    ok: completed,
    status: completed ? "completed" : "partial_success",
    pull_number: pullNumber,
    merged: true,
    merge_sha: mergeSha,
    merge_method: mergeMethod,
    ci_gate: gate,
    ancestry_readback: {
      verified: true,
      base_ref: pr?.base?.ref || defaultBranch,
      base_sha: currentBaseSha,
      compare_status: ancestry.payload?.status || null,
      ahead_by: Number(ancestry.payload?.ahead_by || 0),
      behind_by: Number(ancestry.payload?.behind_by || 0),
    },
    branch_cleanup: branchCleanup,
    secrets_included: false,
  };
}

function validateChangePath(value = "") {
  const path = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.includes("..") || path.split("/").some((part) => [".git", "node_modules", "secrets", "build", "dist", "coverage"].includes(part.toLowerCase()))) {
    throw lifecycleError(400, "github_change_set_path_invalid", "Change-set path is missing or blocked.", { path });
  }
  return path;
}

export async function applyGithubRepositoryChangeSet(options = {}) {
  const { owner, repo, defaultBranch, token } = await lifecycleContext(options);
  const branch = normalizeBranch(options.branch);
  const expectedBaseSha = normalizeSha(options.expected_base_sha || options.expectedBaseSha);
  const commitMessage = String(options.commit_message || options.commitMessage || "").trim();
  const changes = Array.isArray(options.changes) ? options.changes : [];
  if (!branch || branch === defaultBranch || PROTECTED_BRANCHES.has(branch)) throw lifecycleError(403, "github_change_set_branch_blocked", "A non-protected work branch is required.", { branch, default_branch: defaultBranch });
  if (!expectedBaseSha) throw lifecycleError(400, "github_change_set_expected_base_required", "expected_base_sha must be a 40-character SHA.");
  if (commitMessage.length < 5) throw lifecycleError(400, "github_change_set_message_required", "commit_message must be at least 5 characters.");
  if (!changes.length || changes.length > 50) throw lifecycleError(400, "github_change_set_items_invalid", "changes must contain between 1 and 50 items.");

  const baseRef = await githubLifecycleRequest({ owner, repo, apiPath: `/git/ref/heads/${encodeBranch(defaultBranch)}`, token, fetchImpl: options.fetchImpl });
  const currentBaseSha = normalizeSha(baseRef.payload?.object?.sha);
  if (currentBaseSha !== expectedBaseSha) {
    throw lifecycleError(409, "github_change_set_base_moved", "Default branch moved after the change set was prepared.", { expected_base_sha: expectedBaseSha, current_base_sha: currentBaseSha });
  }
  const branchRef = await githubLifecycleRequest({ owner, repo, apiPath: `/git/ref/heads/${encodeBranch(branch)}`, token, fetchImpl: options.fetchImpl, allowNotFound: true });
  const branchExists = branchRef.status !== 404;
  if (branchExists && normalizeSha(branchRef.payload?.object?.sha) !== expectedBaseSha) {
    throw lifecycleError(409, "github_change_set_branch_not_pristine", "Existing work branch is not pinned to expected_base_sha.", {
      branch,
      expected_base_sha: expectedBaseSha,
      current_branch_sha: branchRef.payload?.object?.sha || null,
    });
  }
  const baseCommit = await githubLifecycleRequest({ owner, repo, apiPath: `/git/commits/${expectedBaseSha}`, token, fetchImpl: options.fetchImpl });
  const tree = [];
  const itemReadback = [];
  for (const source of changes) {
    const path = validateChangePath(source.path);
    const action = String(source.action || "write_file");
    if (!new Set(["write_file", "delete_file"]).has(action)) throw lifecycleError(400, "github_change_set_action_invalid", "Each change action must be write_file or delete_file.", { path, action });
    if (action === "delete_file") {
      tree.push({ path, mode: "100644", type: "blob", sha: null });
      itemReadback.push({ path, action, content_sha256: null });
      continue;
    }
    const content = String(source.content ?? "");
    const blob = await githubLifecycleRequest({ owner, repo, apiPath: "/git/blobs", method: "POST", body: { content, encoding: "utf-8" }, token, fetchImpl: options.fetchImpl });
    tree.push({ path, mode: "100644", type: "blob", sha: blob.payload?.sha });
    itemReadback.push({ path, action, content_sha256: createHash("sha256").update(content).digest("hex"), blob_sha: blob.payload?.sha || null });
  }
  const newTree = await githubLifecycleRequest({ owner, repo, apiPath: "/git/trees", method: "POST", body: { base_tree: baseCommit.payload?.tree?.sha, tree }, token, fetchImpl: options.fetchImpl });
  const newCommit = await githubLifecycleRequest({ owner, repo, apiPath: "/git/commits", method: "POST", body: { message: commitMessage, tree: newTree.payload?.sha, parents: [expectedBaseSha] }, token, fetchImpl: options.fetchImpl });
  const newCommitSha = normalizeSha(newCommit.payload?.sha);
  if (branchExists) {
    await githubLifecycleRequest({ owner, repo, apiPath: `/git/refs/heads/${encodeBranch(branch)}`, method: "PATCH", body: { sha: newCommitSha, force: false }, token, fetchImpl: options.fetchImpl });
  } else {
    await githubLifecycleRequest({ owner, repo, apiPath: "/git/refs", method: "POST", body: { ref: `refs/heads/${branch}`, sha: newCommitSha }, token, fetchImpl: options.fetchImpl });
  }
  const readback = await githubLifecycleRequest({ owner, repo, apiPath: `/git/ref/heads/${encodeBranch(branch)}`, token, fetchImpl: options.fetchImpl });
  if (normalizeSha(readback.payload?.object?.sha) !== newCommitSha) {
    throw lifecycleError(502, "github_change_set_readback_failed", "Change-set commit was created but branch head readback did not match.", { branch, expected_commit_sha: newCommitSha, readback_sha: readback.payload?.object?.sha || null });
  }
  return {
    ok: true,
    branch,
    base_sha: expectedBaseSha,
    commit_sha: newCommitSha,
    change_count: changes.length,
    items: itemReadback,
    branch_created: !branchExists,
    readback_verified: true,
    secrets_included: false,
  };
}
