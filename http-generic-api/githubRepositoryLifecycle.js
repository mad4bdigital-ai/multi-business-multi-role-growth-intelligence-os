import { createHash } from "node:crypto";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { applyUnifiedDiffToText } from "./unifiedDiff.js";
import { attachRepositoryMutationCoordination, evaluateRepositoryMutationCoordination } from "./repositoryMutationCoordinationTelemetry.js";

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod"]);
export const DEFAULT_DISPOSABLE_BRANCH_PREFIXES = Object.freeze([
  "gpt/", "docs-agent/", "chore/", "docs/", "automation/", "feature/", "feat/", "fix/", "hotfix/",
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
const DEFAULT_BRANCH_DELETE_READBACK_ATTEMPTS = 3;
const DEFAULT_BRANCH_DELETE_READBACK_DELAY_MS = 150;

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

function boundedRequiredApprovals(value = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

function reviewOrder(review = {}, index = 0) {
  const timestamp = Date.parse(review?.submitted_at || review?.submittedAt || "") || 0;
  return { timestamp, id: Number(review?.id || 0), index };
}

function laterReview(left, right) {
  if (!left) return right;
  if (right.order.timestamp !== left.order.timestamp) {
    return right.order.timestamp > left.order.timestamp ? right : left;
  }
  if (right.order.id !== left.order.id) return right.order.id > left.order.id ? right : left;
  return right.order.index > left.order.index ? right : left;
}

export function summarizeGithubPullRequestApprovals(reviews = [], {
  expectedHeadSha = "",
  authorLogin = "",
  requiredApprovals = 1,
} = {}) {
  const expected = normalizeSha(expectedHeadSha);
  const author = String(authorLogin || "").trim().toLowerCase();
  const required = boundedRequiredApprovals(requiredApprovals);
  const latestByReviewer = new Map();
  const ignored = {
    non_decisive: 0,
    invalid_reviewer: 0,
    bot: 0,
    author: 0,
    stale_head: 0,
    dismissed: 0,
  };

  for (const [index, review] of (Array.isArray(reviews) ? reviews : []).entries()) {
    const state = String(review?.state || "").trim().toUpperCase();
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state)) {
      ignored.non_decisive += 1;
      continue;
    }
    const login = String(review?.user?.login || "").trim().toLowerCase();
    if (!login) {
      ignored.invalid_reviewer += 1;
      continue;
    }
    const candidate = { review, state, login, order: reviewOrder(review, index) };
    latestByReviewer.set(login, laterReview(latestByReviewer.get(login), candidate));
  }

  const approvedReviewers = [];
  const changesRequestedReviewers = [];
  for (const item of latestByReviewer.values()) {
    const { review, state, login } = item;
    const userType = String(review?.user?.type || "").trim().toLowerCase();
    if (userType !== "user" || login.endsWith("[bot]")) {
      ignored.bot += 1;
      continue;
    }
    if (author && login == author) {
      ignored.author += 1;
      continue;
    }
    if (state === "DISMISSED") {
      ignored.dismissed += 1;
      continue;
    }
    if (normalizeSha(review?.commit_id || review?.commitId) !== expected) {
      ignored.stale_head += 1;
      continue;
    }
    const projection = {
      login,
      review_id: Number(review?.id || 0) || null,
      commit_id: expected,
      submitted_at: review?.submitted_at || review?.submittedAt || null,
    };
    if (state === "APPROVED") approvedReviewers.push(projection);
    if (state === "CHANGES_REQUESTED") changesRequestedReviewers.push(projection);
  }

  approvedReviewers.sort((a, b) => a.login.localeCompare(b.login));
  changesRequestedReviewers.sort((a, b) => a.login.localeCompare(b.login));
  return {
    required_approval_count: required,
    exact_head_approval_count: approvedReviewers.length,
    approved_reviewers: approvedReviewers,
    changes_requested_reviewers: changesRequestedReviewers,
    has_changes_requested: changesRequestedReviewers.length > 0,
    quorum_satisfied: approvedReviewers.length >= required && changesRequestedReviewers.length === 0,
    review_count: Array.isArray(reviews) ? reviews.length : 0,
    ignored,
    expected_head_sha: expected || null,
    secrets_included: false,
  };
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
  const readbackAttempts = Math.max(1, Math.min(5, Math.trunc(Number(options.branch_delete_readback_attempts ?? DEFAULT_BRANCH_DELETE_READBACK_ATTEMPTS)) || DEFAULT_BRANCH_DELETE_READBACK_ATTEMPTS));
  const readbackDelayMs = Math.max(0, Math.min(2000, Math.trunc(Number(options.branch_delete_readback_delay_ms ?? DEFAULT_BRANCH_DELETE_READBACK_DELAY_MS)) || 0));
  const sleepImpl = typeof options.sleep_impl === "function"
    ? options.sleep_impl
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  let readback = null;
  let readbackAttempt = 0;
  for (let attempt = 1; attempt <= readbackAttempts; attempt += 1) {
    readbackAttempt = attempt;
    readback = await githubLifecycleRequest({ owner, repo, apiPath: refPath, token, fetchImpl: options.fetchImpl, allowNotFound: true });
    if (readback.status === 404) break;
    if (attempt < readbackAttempts && readbackDelayMs > 0) await sleepImpl(readbackDelayMs * attempt);
  }
  if (readback?.status !== 404) {
    throw lifecycleError(502, "github_branch_delete_readback_failed", "GitHub branch delete returned success but the ref still exists after bounded readback retries.", {
      branch,
      expected_head_sha: expectedHeadSha,
      readback_status: readback?.status || null,
      readback_attempts: readbackAttempt,
      max_readback_attempts: readbackAttempts,
      readback_delay_ms: readbackDelayMs,
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
    readback_attempts: readbackAttempt,
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
  const isDraft = pr?.draft === true;
  const gateStatus = baseFresh && mergeable && !isDraft && !missingChecks.length && !pendingChecks.length && !failedChecks.length ? "pass" : "blocked";
  return {
    ok: true,
    pull_number: pullNumber,
    gate_status: gateStatus,
    is_draft: isDraft,
    ready_for_merge: !isDraft,
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
  const finalState = String(pr?.state || "").trim().toLowerCase();
  if (finalState !== "open") {
    throw lifecycleError(409, "github_pr_finalize_state_blocked", "Only open pull requests can be finalized.", {
      pull_number: pullNumber,
      current_state: finalState || null,
      secrets_included: false,
    });
  }
  if (pr?.draft === true) {
    throw lifecycleError(409, "github_pr_finalize_draft_blocked", "Draft pull requests cannot be finalized or merged.", {
      pull_number: pullNumber,
      expected_head_sha: expectedHeadSha,
      expected_base_sha: expectedBaseSha,
      is_draft: true,
      secrets_included: false,
    });
  }
  const finalHeadSha = normalizeSha(pr?.head?.sha);
  const finalBaseSha = normalizeSha(pr?.base?.sha);
  if (finalHeadSha !== expectedHeadSha || finalBaseSha !== expectedBaseSha) {
    throw lifecycleError(409, "github_pr_finalize_final_identity_mismatch", "Pull request head or base changed immediately before merge.", {
      pull_number: pullNumber,
      expected_head_sha: expectedHeadSha,
      current_head_sha: finalHeadSha || null,
      expected_base_sha: expectedBaseSha,
      current_base_sha: finalBaseSha || null,
      validation_phase: "final_pre_merge_readback",
      secrets_included: false,
    });
  }
  const reviewsResponse = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/pulls/${pullNumber}/reviews?per_page=100`,
    token,
    fetchImpl: options.fetchImpl,
  });
  const reviews = Array.isArray(reviewsResponse.payload) ? reviewsResponse.payload : [];
  if (!Array.isArray(reviewsResponse.payload) || reviews.length >= 100) {
    throw lifecycleError(409, "github_pr_finalize_review_set_unbounded", "Exact-head review evidence could not be bounded to one complete page.", {
      pull_number: pullNumber,
      returned_review_count: reviews.length,
      per_page: 100,
      secrets_included: false,
    });
  }
  const approvalEvidence = summarizeGithubPullRequestApprovals(reviews, {
    expectedHeadSha,
    authorLogin: pr?.user?.login,
    requiredApprovals: options.required_approvals || options.requiredApprovals || 1,
  });
  if (approvalEvidence.has_changes_requested) {
    throw lifecycleError(409, "github_pr_finalize_changes_requested", "Exact-head review evidence contains an active changes-requested decision.", approvalEvidence);
  }
  if (!approvalEvidence.quorum_satisfied) {
    throw lifecycleError(409, "github_pr_finalize_approval_required", "Exact-head human approval quorum is not satisfied.", approvalEvidence);
  }
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
      approval_evidence: approvalEvidence,
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
    approval_evidence: approvalEvidence,
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

function encodeRepositoryPath(filePath = "") {
  return String(filePath).split("/").map(encodeURIComponent).join("/");
}

async function readGithubTextAtCommit({ owner, repo, commitSha, filePath, token, fetchImpl }) {
  const contents = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/contents/${encodeRepositoryPath(filePath)}?ref=${encodeURIComponent(commitSha)}`,
    token,
    fetchImpl,
    allowNotFound: true,
  });
  if (contents.status === 404) {
    throw lifecycleError(409, "github_change_set_patch_target_missing", "Unified diff target does not exist at expected_base_sha.", {
      path: filePath,
      expected_base_sha: commitSha,
      secrets_included: false,
    });
  }
  const payload = contents.payload || {};
  if (payload.type && payload.type !== "file") {
    throw lifecycleError(400, "github_change_set_patch_target_not_file", "Unified diff target must resolve to a file.", {
      path: filePath,
      target_type: payload.type,
      secrets_included: false,
    });
  }
  let content = null;
  if (typeof payload.content === "string") {
    content = Buffer.from(payload.content.replace(/\s/g, ""), payload.encoding || "base64").toString("utf8");
  } else if (normalizeSha(payload.sha)) {
    const blob = await githubLifecycleRequest({
      owner,
      repo,
      apiPath: `/git/blobs/${encodeURIComponent(payload.sha)}`,
      token,
      fetchImpl,
    });
    if (typeof blob.payload?.content === "string") {
      content = Buffer.from(blob.payload.content.replace(/\s/g, ""), blob.payload.encoding || "base64").toString("utf8");
    }
  }
  if (content === null) {
    throw lifecycleError(502, "github_change_set_patch_target_read_failed", "Unified diff target content could not be read from GitHub.", {
      path: filePath,
      blob_sha: payload.sha || null,
      secrets_included: false,
    });
  }
  if (content.includes("\u0000")) {
    throw lifecycleError(400, "github_change_set_patch_target_binary", "Unified diff supports UTF-8 text files only.", {
      path: filePath,
      secrets_included: false,
    });
  }
  return { content, blob_sha: normalizeSha(payload.sha) || null };
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function changedPathOverlaps(changePath, movedPath) {
  const left = String(changePath || "").replace(/\/+/g, "/");
  const right = String(movedPath || "").replace(/\/+/g, "/");
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

async function compareGithubCommitFiles({ owner, repo, baseSha, headSha, token, fetchImpl }) {
  const base = normalizeSha(baseSha);
  const head = normalizeSha(headSha);
  if (!base || !head || base === head) {
    return { status: base === head ? "identical" : "unavailable", ahead_by: 0, behind_by: 0, changed_paths: [], files_truncated: false };
  }
  const compare = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    token,
    fetchImpl,
  });
  const files = Array.isArray(compare.payload?.files) ? compare.payload.files : [];
  return {
    status: String(compare.payload?.status || ""),
    ahead_by: Number(compare.payload?.ahead_by || 0),
    behind_by: Number(compare.payload?.behind_by || 0),
    changed_paths: uniqueSorted(files.flatMap((file) => [file?.filename, file?.previous_filename])),
    files_truncated: Number(compare.payload?.total_commits || 0) > 250 && files.length >= 300,
  };
}

export async function applyGithubRepositoryChangeSet(options = {}) {
  const { owner, repo, defaultBranch, token } = await lifecycleContext(options);
  const branch = normalizeBranch(options.branch);
  const expectedBaseSha = normalizeSha(options.expected_base_sha || options.expectedBaseSha);
  const expectedBranchSha = normalizeSha(options.expected_branch_sha || options.expectedBranchSha);
  const allowSameBranchContinuation = options.allow_same_branch_continuation === true
    || options.allowSameBranchContinuation === true
    || Boolean(expectedBranchSha);
  const commitMessage = String(options.commit_message || options.commitMessage || "").trim();
  const changes = Array.isArray(options.changes) ? options.changes : [];
  if (!branch || branch === defaultBranch || PROTECTED_BRANCHES.has(branch)) throw lifecycleError(403, "github_change_set_branch_blocked", "A non-protected work branch is required.", { branch, default_branch: defaultBranch });
  if (!expectedBaseSha) throw lifecycleError(400, "github_change_set_expected_base_required", "expected_base_sha must be a 40-character SHA.");
  if (commitMessage.length < 5) throw lifecycleError(400, "github_change_set_message_required", "commit_message must be at least 5 characters.");
  if (!changes.length || changes.length > 50) throw lifecycleError(400, "github_change_set_items_invalid", "changes must contain between 1 and 50 items.");

  const seenPaths = new Set();
  const normalizedChanges = changes.map((source) => {
    const path = validateChangePath(source.path);
    if (seenPaths.has(path)) {
      throw lifecycleError(400, "github_change_set_duplicate_path", "Each change path must be unique.", { path });
    }
    seenPaths.add(path);
    const action = String(source.action || "write_file");
    if (!new Set(["write_file", "delete_file", "apply_unified_diff"]).has(action)) {
      throw lifecycleError(400, "github_change_set_action_invalid", "Each change action must be write_file, delete_file, or apply_unified_diff.", { path, action });
    }
    if (action === "apply_unified_diff" && !String(source.diff || "").trim()) {
      throw lifecycleError(400, "github_change_set_diff_required", "diff is required for apply_unified_diff.", { path });
    }
    return { ...source, path, action };
  });

  const baseRef = await githubLifecycleRequest({ owner, repo, apiPath: `/git/ref/heads/${encodeBranch(defaultBranch)}`, token, fetchImpl: options.fetchImpl });
  const currentBaseSha = normalizeSha(baseRef.payload?.object?.sha);
  const defaultBranchMoved = currentBaseSha !== expectedBaseSha;
  let defaultBranchDrift = { status: "identical", ahead_by: 0, behind_by: 0, changed_paths: [], files_truncated: false, overlapping_paths: [] };
  if (defaultBranchMoved && !allowSameBranchContinuation) {
    throw lifecycleError(409, "github_change_set_base_moved", "Default branch moved after the change set was prepared.", { expected_base_sha: expectedBaseSha, current_base_sha: currentBaseSha });
  }
  if (defaultBranchMoved) {
    defaultBranchDrift = await compareGithubCommitFiles({ owner, repo, baseSha: expectedBaseSha, headSha: currentBaseSha, token, fetchImpl: options.fetchImpl });
    const changePaths = normalizedChanges.map((change) => change.path);
    const overlappingPaths = uniqueSorted(changePaths.filter((changePath) => defaultBranchDrift.changed_paths.some((changedPath) => changedPathOverlaps(changePath, changedPath))));
    defaultBranchDrift = { ...defaultBranchDrift, overlapping_paths: overlappingPaths };
    if (defaultBranchDrift.files_truncated) {
      throw lifecycleError(409, "github_change_set_default_branch_compare_truncated", "Default branch moved and changed-file evidence is truncated; refusing same-branch continuation.", {
        expected_base_sha: expectedBaseSha,
        current_base_sha: currentBaseSha,
        compare_status: defaultBranchDrift.status,
        files_truncated: true,
      });
    }
    if (overlappingPaths.length) {
      throw lifecycleError(409, "github_change_set_default_branch_overlap", "Default branch moved and changed one or more requested patch paths.", {
        expected_base_sha: expectedBaseSha,
        current_base_sha: currentBaseSha,
        overlapping_paths: overlappingPaths,
        changed_paths: defaultBranchDrift.changed_paths.slice(0, 100),
      });
    }
  }
  const branchRef = await githubLifecycleRequest({ owner, repo, apiPath: `/git/ref/heads/${encodeBranch(branch)}`, token, fetchImpl: options.fetchImpl, allowNotFound: true });
  const branchExists = branchRef.status !== 404;
  const currentBranchSha = branchExists ? normalizeSha(branchRef.payload?.object?.sha) : "";
  const repositoryCoordination = evaluateRepositoryMutationCoordination("repo_patch_batch_apply", {
    ...options,
    branch,
    expected_base_sha: expectedBaseSha,
    expected_branch_sha: expectedBranchSha,
    changes: normalizedChanges,
    repository_current_state: {
      ...(options.repository_current_state || {}),
      base_sha: currentBaseSha,
      branch_sha: currentBranchSha || "",
      unknown_provider_outcome: options.unknown_provider_outcome === true,
      same_cycle_readback_verified: options.same_cycle_readback_verified === true,
    },
  });
  let commitParentSha = expectedBaseSha;
  if (branchExists && currentBranchSha === expectedBaseSha && defaultBranchMoved) {
    commitParentSha = currentBaseSha;
  } else if (branchExists && currentBranchSha === expectedBaseSha) {
    commitParentSha = expectedBaseSha;
  } else if (branchExists && allowSameBranchContinuation && expectedBranchSha && currentBranchSha === expectedBranchSha) {
    commitParentSha = currentBranchSha;
  } else if (branchExists) {
    throw lifecycleError(409, "github_change_set_branch_not_pristine", "Existing work branch head does not match expected_base_sha or expected_branch_sha.", {
      branch,
      expected_base_sha: expectedBaseSha,
      expected_branch_sha: expectedBranchSha || null,
      current_branch_sha: currentBranchSha || null,
      same_branch_continuation_allowed: allowSameBranchContinuation,
    });
  }
  if (!branchExists && defaultBranchMoved) commitParentSha = currentBaseSha;
  const baseCommit = await githubLifecycleRequest({ owner, repo, apiPath: `/git/commits/${commitParentSha}`, token, fetchImpl: options.fetchImpl });

  // Validate every hunk before creating any Git blob, tree, commit, or ref.
  const preparedChanges = [];
  for (const source of normalizedChanges) {
    if (source.action === "delete_file") {
      preparedChanges.push({ ...source, content: null, base_blob_sha: null });
      continue;
    }
    if (source.action === "write_file") {
      preparedChanges.push({ ...source, content: String(source.content ?? ""), base_blob_sha: null });
      continue;
    }
    const current = await readGithubTextAtCommit({
      owner,
      repo,
      commitSha: commitParentSha,
      filePath: source.path,
      token,
      fetchImpl: options.fetchImpl,
    });
    const patchedContent = applyUnifiedDiffToText(current.content, source.diff);
    if (patchedContent === current.content) {
      throw lifecycleError(409, "github_change_set_patch_noop", "Unified diff produced no content change; refusing no-op patch item.", {
        path: source.path,
        parent_sha: commitParentSha,
        base_blob_sha: current.blob_sha,
        patch_sha256: createHash("sha256").update(String(source.diff)).digest("hex"),
        secrets_included: false,
      });
    }
    preparedChanges.push({
      ...source,
      content: patchedContent,
      base_blob_sha: current.blob_sha,
    });
  }

  const tree = [];
  const itemReadback = [];
  for (const source of preparedChanges) {
    if (source.action === "delete_file") {
      tree.push({ path: source.path, mode: "100644", type: "blob", sha: null });
      itemReadback.push({ path: source.path, action: source.action, content_sha256: null });
      continue;
    }
    const blob = await githubLifecycleRequest({ owner, repo, apiPath: "/git/blobs", method: "POST", body: { content: source.content, encoding: "utf-8" }, token, fetchImpl: options.fetchImpl });
    tree.push({ path: source.path, mode: "100644", type: "blob", sha: blob.payload?.sha });
    itemReadback.push({
      path: source.path,
      action: source.action,
      content_sha256: createHash("sha256").update(source.content).digest("hex"),
      blob_sha: blob.payload?.sha || null,
      ...(source.action === "apply_unified_diff" ? {
        patch_sha256: createHash("sha256").update(String(source.diff)).digest("hex"),
        base_blob_sha: source.base_blob_sha,
      } : {}),
    });
  }
  const newTree = await githubLifecycleRequest({ owner, repo, apiPath: "/git/trees", method: "POST", body: { base_tree: baseCommit.payload?.tree?.sha, tree }, token, fetchImpl: options.fetchImpl });
  const newTreeSha = normalizeSha(newTree.payload?.sha);
  const parentTreeSha = normalizeSha(baseCommit.payload?.tree?.sha);
  if (!newTreeSha) {
    throw lifecycleError(502, "github_change_set_tree_readback_missing", "GitHub created-tree response did not include a valid tree SHA.", {
      branch,
      parent_sha: commitParentSha,
      change_count: changes.length,
      secrets_included: false,
    });
  }
  if (newTreeSha === parentTreeSha) {
    throw lifecycleError(409, "github_change_set_empty_tree", "Change set produced no tree changes; refusing to create an empty commit.", {
      branch,
      parent_sha: commitParentSha,
      parent_tree_sha: parentTreeSha,
      change_count: changes.length,
      changed_paths: normalizedChanges.map((change) => change.path),
      secrets_included: false,
    });
  }
  const newCommit = await githubLifecycleRequest({ owner, repo, apiPath: "/git/commits", method: "POST", body: { message: commitMessage, tree: newTreeSha, parents: [commitParentSha] }, token, fetchImpl: options.fetchImpl });
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
    parent_sha: commitParentSha,
    current_default_sha: currentBaseSha,
    default_branch_moved: defaultBranchMoved,
    same_branch_continuation_used: branchExists && commitParentSha !== expectedBaseSha,
    default_branch_drift: {
      status: defaultBranchDrift.status,
      ahead_by: defaultBranchDrift.ahead_by,
      behind_by: defaultBranchDrift.behind_by,
      changed_path_count: defaultBranchDrift.changed_paths.length,
      overlapping_paths: defaultBranchDrift.overlapping_paths,
    },
    commit_sha: newCommitSha,
    change_count: changes.length,
    items: itemReadback,
    branch_created: !branchExists,
    readback_verified: true,
    secrets_included: false,
  };
}
async function readGithubBlobShaAtPath({ owner, repo, treeSha, filePath, token, fetchImpl }) {
  const parts = validateChangePath(filePath).split("/");
  let currentTreeSha = normalizeSha(treeSha);
  if (!currentTreeSha) {
    throw lifecycleError(502, "github_existing_blob_readback_tree_missing", "Created Git tree SHA is missing or invalid.", {
      path: filePath,
      tree_sha: treeSha || null,
      secrets_included: false,
    });
  }
  for (let index = 0; index < parts.length; index += 1) {
    const treeResponse = await githubLifecycleRequest({
      owner,
      repo,
      apiPath: "/git/trees/" + encodeURIComponent(currentTreeSha),
      token,
      fetchImpl,
    });
    const entries = Array.isArray(treeResponse.payload?.tree) ? treeResponse.payload.tree : [];
    const entry = entries.find((candidate) => candidate?.path === parts[index]);
    if (!entry) {
      throw lifecycleError(502, "github_existing_blob_readback_path_missing", "Committed path is missing from Git tree readback.", {
        path: filePath,
        missing_segment: parts[index],
        tree_sha: currentTreeSha,
        secrets_included: false,
      });
    }
    const entrySha = normalizeSha(entry.sha);
    const finalSegment = index === parts.length - 1;
    if (finalSegment) {
      if (entry.type !== "blob" || !entrySha) {
        throw lifecycleError(502, "github_existing_blob_readback_type_mismatch", "Committed path does not resolve to a valid Git blob.", {
          path: filePath,
          entry_type: entry.type || null,
          entry_sha: entry.sha || null,
          secrets_included: false,
        });
      }
      return entrySha;
    }
    if (entry.type !== "tree" || !entrySha) {
      throw lifecycleError(502, "github_existing_blob_readback_tree_mismatch", "Intermediate committed path segment is not a valid Git tree.", {
        path: filePath,
        segment: parts[index],
        entry_type: entry.type || null,
        entry_sha: entry.sha || null,
        secrets_included: false,
      });
    }
    currentTreeSha = entrySha;
  }
  return "";
}

export async function applyGithubExistingBlobChangeSet(options = {}) {
  const { owner, repo, defaultBranch, token } = await lifecycleContext(options);
  const branch = normalizeBranch(options.branch);
  const expectedHeadSha = normalizeSha(options.expected_head_sha || options.expectedHeadSha);
  const commitMessage = String(options.commit_message || options.commitMessage || "").trim();
  const changes = Array.isArray(options.changes) ? options.changes : [];
  if (!branch || branch === defaultBranch || PROTECTED_BRANCHES.has(branch)) {
    throw lifecycleError(403, "github_existing_blob_branch_blocked", "A non-protected existing work branch is required.", {
      branch,
      default_branch: defaultBranch,
    });
  }
  if (!expectedHeadSha) {
    throw lifecycleError(400, "github_existing_blob_expected_head_required", "expected_head_sha must be a 40-character SHA.");
  }
  if (commitMessage.length < 5) {
    throw lifecycleError(400, "github_existing_blob_message_required", "commit_message must be at least 5 characters.");
  }
  if (!changes.length || changes.length > 50) {
    throw lifecycleError(400, "github_existing_blob_items_invalid", "changes must contain between 1 and 50 items.");
  }

  const seenPaths = new Set();
  const treeEntries = changes.map((source) => {
    const filePath = validateChangePath(source.path);
    if (seenPaths.has(filePath)) {
      throw lifecycleError(400, "github_existing_blob_duplicate_path", "Each change path must be unique.", { path: filePath });
    }
    seenPaths.add(filePath);
    const blobSha = normalizeSha(source.blob_sha || source.blobSha);
    if (!blobSha) {
      throw lifecycleError(400, "github_existing_blob_sha_invalid", "Each change must include a valid 40-character blob_sha.", { path: filePath });
    }
    const mode = String(source.mode || "100644");
    if (!new Set(["100644", "100755"]).has(mode)) {
      throw lifecycleError(400, "github_existing_blob_mode_invalid", "mode must be 100644 or 100755.", { path: filePath, mode });
    }
    return { path: filePath, mode, type: "blob", sha: blobSha };
  });

  const refPath = "/git/ref/heads/" + encodeBranch(branch);
  const branchRef = await githubLifecycleRequest({ owner, repo, apiPath: refPath, token, fetchImpl: options.fetchImpl, allowNotFound: true });
  if (branchRef.status === 404) {
    throw lifecycleError(404, "github_existing_blob_branch_missing", "Target work branch does not exist.", { branch });
  }
  const currentHeadSha = normalizeSha(branchRef.payload?.object?.sha);
  if (currentHeadSha !== expectedHeadSha) {
    throw lifecycleError(409, "github_existing_blob_head_mismatch", "Branch head changed before existing-blob commit preparation.", {
      branch,
      expected_head_sha: expectedHeadSha,
      current_head_sha: currentHeadSha || null,
    });
  }

  const baseCommit = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: "/git/commits/" + encodeURIComponent(expectedHeadSha),
    token,
    fetchImpl: options.fetchImpl,
  });
  const baseTreeSha = normalizeSha(baseCommit.payload?.tree?.sha);
  if (!baseTreeSha) {
    throw lifecycleError(502, "github_existing_blob_base_tree_missing", "Branch head commit does not expose a valid base tree SHA.", {
      branch,
      expected_head_sha: expectedHeadSha,
    });
  }

  const newTree = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: "/git/trees",
    method: "POST",
    body: { base_tree: baseTreeSha, tree: treeEntries },
    token,
    fetchImpl: options.fetchImpl,
  });
  const newTreeSha = normalizeSha(newTree.payload?.sha);
  if (!newTreeSha) {
    throw lifecycleError(502, "github_existing_blob_tree_create_failed", "GitHub did not return a valid tree SHA.", { branch });
  }

  const newCommit = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: "/git/commits",
    method: "POST",
    body: { message: commitMessage, tree: newTreeSha, parents: [expectedHeadSha] },
    token,
    fetchImpl: options.fetchImpl,
  });
  const newCommitSha = normalizeSha(newCommit.payload?.sha);
  if (!newCommitSha) {
    throw lifecycleError(502, "github_existing_blob_commit_create_failed", "GitHub did not return a valid commit SHA.", { branch });
  }

  const preUpdateRef = await githubLifecycleRequest({ owner, repo, apiPath: refPath, token, fetchImpl: options.fetchImpl });
  const preUpdateHeadSha = normalizeSha(preUpdateRef.payload?.object?.sha);
  if (preUpdateHeadSha !== expectedHeadSha) {
    throw lifecycleError(409, "github_existing_blob_head_moved", "Branch head changed after tree creation and before ref update.", {
      branch,
      expected_head_sha: expectedHeadSha,
      current_head_sha: preUpdateHeadSha || null,
    });
  }

  await githubLifecycleRequest({
    owner,
    repo,
    apiPath: "/git/refs/heads/" + encodeBranch(branch),
    method: "PATCH",
    body: { sha: newCommitSha, force: false },
    token,
    fetchImpl: options.fetchImpl,
  });
  const refReadback = await githubLifecycleRequest({ owner, repo, apiPath: refPath, token, fetchImpl: options.fetchImpl });
  const readbackHeadSha = normalizeSha(refReadback.payload?.object?.sha);
  if (readbackHeadSha !== newCommitSha) {
    throw lifecycleError(502, "github_existing_blob_ref_readback_failed", "Branch head readback did not match the created commit.", {
      branch,
      expected_commit_sha: newCommitSha,
      readback_sha: readbackHeadSha || null,
    });
  }

  const items = [];
  for (const entry of treeEntries) {
    const readbackBlobSha = await readGithubBlobShaAtPath({
      owner,
      repo,
      treeSha: newTreeSha,
      filePath: entry.path,
      token,
      fetchImpl: options.fetchImpl,
    });
    if (readbackBlobSha !== entry.sha) {
      throw lifecycleError(502, "github_existing_blob_path_readback_failed", "Committed path blob SHA did not match the requested blob SHA.", {
        path: entry.path,
        expected_blob_sha: entry.sha,
        readback_blob_sha: readbackBlobSha || null,
      });
    }
    items.push({ path: entry.path, mode: entry.mode, blob_sha: entry.sha, readback_blob_sha: readbackBlobSha, readback_verified: true });
  }

  return {
    ok: true,
    branch,
    previous_head_sha: expectedHeadSha,
    commit_sha: newCommitSha,
    tree_sha: newTreeSha,
    change_count: items.length,
    items,
    force_used: false,
    ref_readback_verified: true,
    path_readback_verified: true,
    secrets_included: false,
  };
}
