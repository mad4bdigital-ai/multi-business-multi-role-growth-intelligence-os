import { createHash } from "node:crypto";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import {
  DEFAULT_DISPOSABLE_BRANCH_PREFIXES,
  deleteGithubBranchRef,
  githubBranchDeleteConfirmation,
  githubLifecycleRequest,
  resolveGithubLifecycleTarget,
} from "./githubRepositoryLifecycle.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod", "staging", "release"]);

function sweepError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeSha(value = "") {
  const sha = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

function normalizeBranch(value = "") {
  return String(value || "").trim().replace(/^refs\/heads\//, "");
}

function boundedInteger(value, fallback, { min, max, field }) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw sweepError(400, "github_branch_cleanup_sweep_input_invalid", `${field} must be an integer between ${min} and ${max}.`, {
      field,
      value: value ?? null,
      min,
      max,
    });
  }
  return parsed;
}

function normalizePrefixes(value) {
  if (value === undefined || value === null) return [...DEFAULT_DISPOSABLE_BRANCH_PREFIXES];
  if (!Array.isArray(value) || value.length < 1 || value.length > DEFAULT_DISPOSABLE_BRANCH_PREFIXES.length) {
    throw sweepError(400, "github_branch_cleanup_sweep_prefixes_invalid", "branch_prefixes must be a non-empty subset of the governed disposable prefixes.");
  }
  const allowed = new Set(DEFAULT_DISPOSABLE_BRANCH_PREFIXES);
  const prefixes = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].sort();
  const invalid = prefixes.filter((prefix) => !allowed.has(prefix));
  if (!prefixes.length || invalid.length) {
    throw sweepError(400, "github_branch_cleanup_sweep_prefixes_invalid", "branch_prefixes contains an unapproved prefix.", {
      invalid_prefixes: invalid,
      allowed_prefixes: [...DEFAULT_DISPOSABLE_BRANCH_PREFIXES],
    });
  }
  return prefixes;
}

function branchMatchesPrefix(branch, prefixes) {
  return prefixes.some((prefix) => branch.startsWith(prefix));
}

function stableFingerprint(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function githubBranchCleanupSweepConfirmation(baseSha = "", fingerprint = "") {
  const normalizedBase = normalizeSha(baseSha);
  const normalizedFingerprint = String(fingerprint || "").trim().toLowerCase();
  if (!normalizedBase || !/^[0-9a-f]{64}$/.test(normalizedFingerprint)) return "";
  return `APPLY_GITHUB_BRANCH_CLEANUP_SWEEP_${normalizedBase.slice(0, 12).toUpperCase()}_${normalizedFingerprint.slice(0, 12).toUpperCase()}`;
}

async function listOpenPullRequestHeads({ owner, repo, token, fetchImpl }) {
  const heads = new Set();
  for (let page = 1; page <= 20; page += 1) {
    const response = await githubLifecycleRequest({
      owner,
      repo,
      apiPath: `/pulls?state=open&per_page=100&page=${page}`,
      token,
      fetchImpl,
    });
    const rows = Array.isArray(response.payload) ? response.payload : [];
    for (const pr of rows) {
      const ref = normalizeBranch(pr?.head?.ref);
      const fullName = String(pr?.head?.repo?.full_name || "").trim();
      if (ref && (!fullName || fullName === `${owner}/${repo}`)) heads.add(ref);
    }
    if (rows.length < 100) break;
  }
  return heads;
}

async function listBranchWindow({ owner, repo, token, fetchImpl, page, maxPages, scanLimit }) {
  const branches = [];
  let pagesFetched = 0;
  let lastPageFull = false;
  for (let currentPage = page; currentPage < page + maxPages && branches.length < scanLimit; currentPage += 1) {
    const response = await githubLifecycleRequest({
      owner,
      repo,
      apiPath: `/branches?per_page=100&page=${currentPage}`,
      token,
      fetchImpl,
    });
    const rows = Array.isArray(response.payload) ? response.payload : [];
    pagesFetched += 1;
    lastPageFull = rows.length === 100;
    for (const row of rows) {
      if (branches.length >= scanLimit) break;
      branches.push(row);
    }
    if (rows.length < 100) break;
  }
  return {
    branches,
    pagesFetched,
    hasMore: lastPageFull,
    nextPage: lastPageFull ? page + pagesFetched : null,
  };
}

async function buildCleanupPlan(options = {}) {
  const target = await resolveGithubLifecycleTarget(options);
  const token = options.token || await getGitHubAppInstallationToken({});
  const fetchImpl = options.fetchImpl || fetch;
  const page = boundedInteger(options.page, 1, { min: 1, max: 10000, field: "page" });
  const maxPages = boundedInteger(options.max_pages, 1, { min: 1, max: 3, field: "max_pages" });
  const scanLimit = boundedInteger(options.scan_limit, 100, { min: 1, max: 300, field: "scan_limit" });
  const maxDeletes = boundedInteger(options.max_deletes, 10, { min: 1, max: 25, field: "max_deletes" });
  const minAgeDays = boundedInteger(options.min_age_days, 7, { min: 1, max: 3650, field: "min_age_days" });
  const prefixes = normalizePrefixes(options.branch_prefixes);
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw sweepError(400, "github_branch_cleanup_sweep_now_invalid", "now must be a valid timestamp when provided.");
  }

  const repository = await githubLifecycleRequest({
    owner: target.owner,
    repo: target.repo,
    apiPath: "",
    token,
    fetchImpl,
  });
  const actualDefaultBranch = normalizeBranch(repository.payload?.default_branch || target.defaultBranch);
  if (!actualDefaultBranch) {
    throw sweepError(502, "github_branch_cleanup_sweep_default_branch_unresolved", "GitHub repository default branch could not be resolved.");
  }
  const baseRef = await githubLifecycleRequest({
    owner: target.owner,
    repo: target.repo,
    apiPath: `/git/ref/heads/${actualDefaultBranch.split("/").map(encodeURIComponent).join("/")}`,
    token,
    fetchImpl,
  });
  const baseSha = normalizeSha(baseRef.payload?.object?.sha);
  if (!baseSha) {
    throw sweepError(502, "github_branch_cleanup_sweep_base_sha_unresolved", "GitHub default branch head SHA could not be resolved.", {
      default_branch: actualDefaultBranch,
    });
  }

  const openPrHeads = await listOpenPullRequestHeads({ owner: target.owner, repo: target.repo, token, fetchImpl });
  const window = await listBranchWindow({
    owner: target.owner,
    repo: target.repo,
    token,
    fetchImpl,
    page,
    maxPages,
    scanLimit,
  });

  const eligible = [];
  const review = [];
  const excludedCounts = {
    protected_or_default: 0,
    prefix_not_allowed: 0,
    open_pull_request: 0,
    contains_unique_commits: 0,
    recent_branch: 0,
    invalid_branch_metadata: 0,
    comparison_error: 0,
  };

  for (const row of window.branches) {
    const branch = normalizeBranch(row?.name);
    const headSha = normalizeSha(row?.commit?.sha);
    if (!branch || !headSha) {
      excludedCounts.invalid_branch_metadata += 1;
      review.push({ branch: branch || null, head_sha: headSha || null, reason: "invalid_branch_metadata" });
      continue;
    }
    if (branch === actualDefaultBranch || PROTECTED_BRANCHES.has(branch) || row?.protected === true) {
      excludedCounts.protected_or_default += 1;
      continue;
    }
    if (!branchMatchesPrefix(branch, prefixes)) {
      excludedCounts.prefix_not_allowed += 1;
      continue;
    }
    if (openPrHeads.has(branch)) {
      excludedCounts.open_pull_request += 1;
      review.push({ branch, head_sha: headSha, reason: "open_pull_request" });
      continue;
    }

    let compare;
    try {
      compare = await githubLifecycleRequest({
        owner: target.owner,
        repo: target.repo,
        apiPath: `/compare/${encodeURIComponent(actualDefaultBranch)}...${encodeURIComponent(headSha)}`,
        token,
        fetchImpl,
      });
    } catch (error) {
      excludedCounts.comparison_error += 1;
      review.push({ branch, head_sha: headSha, reason: "comparison_error", error_code: error?.code || "github_compare_failed" });
      continue;
    }
    const compareStatus = String(compare.payload?.status || "").toLowerCase();
    const aheadBy = Number(compare.payload?.ahead_by ?? -1);
    const behindBy = Number(compare.payload?.behind_by || 0);
    if (aheadBy !== 0 || !["behind", "identical"].includes(compareStatus)) {
      excludedCounts.contains_unique_commits += 1;
      review.push({ branch, head_sha: headSha, reason: "contains_unique_commits", ahead_by: aheadBy, behind_by: behindBy, compare_status: compareStatus || null });
      continue;
    }

    const commit = await githubLifecycleRequest({
      owner: target.owner,
      repo: target.repo,
      apiPath: `/commits/${encodeURIComponent(headSha)}`,
      token,
      fetchImpl,
    });
    const committedAt = String(commit.payload?.commit?.committer?.date || commit.payload?.commit?.author?.date || "").trim();
    const committedMs = Date.parse(committedAt);
    if (!committedAt || Number.isNaN(committedMs)) {
      excludedCounts.invalid_branch_metadata += 1;
      review.push({ branch, head_sha: headSha, reason: "commit_timestamp_unresolved" });
      continue;
    }
    const ageDays = Math.floor((now.getTime() - committedMs) / DAY_MS);
    if (ageDays < minAgeDays) {
      excludedCounts.recent_branch += 1;
      review.push({ branch, head_sha: headSha, reason: "recent_branch", committed_at: committedAt, age_days: ageDays });
      continue;
    }

    eligible.push({
      branch,
      head_sha: headSha,
      committed_at: committedAt,
      age_days: ageDays,
      compare_status: compareStatus,
      ahead_by: aheadBy,
      behind_by: behindBy,
    });
  }

  eligible.sort((left, right) => {
    const dateOrder = Date.parse(left.committed_at) - Date.parse(right.committed_at);
    return dateOrder || left.branch.localeCompare(right.branch);
  });
  const deletionPlan = eligible.slice(0, maxDeletes);
  const fingerprintPayload = {
    owner: target.owner,
    repo: target.repo,
    default_branch: actualDefaultBranch,
    base_sha: baseSha,
    page,
    max_pages: maxPages,
    scan_limit: scanLimit,
    max_deletes: maxDeletes,
    min_age_days: minAgeDays,
    branch_prefixes: prefixes,
    candidates: eligible.map((item) => [item.branch, item.head_sha, item.committed_at, item.behind_by]),
  };
  const evidenceFingerprint = stableFingerprint(fingerprintPayload);

  return {
    target,
    token,
    fetchImpl,
    plan: {
      ok: true,
      mode: "dry_run",
      owner: target.owner,
      repo: target.repo,
      default_branch: actualDefaultBranch,
      base_sha: baseSha,
      scan: {
        page,
        pages_fetched: window.pagesFetched,
        scan_limit: scanLimit,
        scanned_branch_count: window.branches.length,
        has_more: window.hasMore,
        next_page: window.nextPage,
      },
      policy: {
        min_age_days: minAgeDays,
        max_deletes: maxDeletes,
        branch_prefixes: prefixes,
        protected_branches: [...PROTECTED_BRANCHES],
        open_pull_requests_blocked: true,
        unique_commits_blocked: true,
        force_delete_allowed: false,
      },
      summary: {
        eligible_count: eligible.length,
        planned_delete_count: deletionPlan.length,
        review_count: review.length,
        excluded_counts: excludedCounts,
      },
      candidates: eligible,
      deletion_plan: deletionPlan,
      review: review.slice(0, 100),
      evidence_fingerprint: evidenceFingerprint,
      expected_confirm: githubBranchCleanupSweepConfirmation(baseSha, evidenceFingerprint),
      secrets_included: false,
    },
  };
}

export async function runGithubBranchCleanupSweep(options = {}) {
  const mode = String(options.mode || "dry_run").trim().toLowerCase();
  if (!new Set(["dry_run", "apply"]).has(mode)) {
    throw sweepError(400, "github_branch_cleanup_sweep_mode_invalid", "mode must be dry_run or apply.");
  }
  const { target, token, fetchImpl, plan } = await buildCleanupPlan(options);
  if (mode === "dry_run") return plan;

  const expectedBaseSha = normalizeSha(options.expected_base_sha);
  const expectedFingerprint = String(options.expected_evidence_fingerprint || "").trim().toLowerCase();
  if (!expectedBaseSha || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw sweepError(400, "github_branch_cleanup_sweep_evidence_required", "apply requires expected_base_sha and expected_evidence_fingerprint from a dry-run.");
  }
  if (plan.base_sha !== expectedBaseSha || plan.evidence_fingerprint !== expectedFingerprint) {
    throw sweepError(409, "github_branch_cleanup_sweep_evidence_mismatch", "Branch cleanup sweep evidence changed after review.", {
      expected_base_sha: expectedBaseSha,
      current_base_sha: plan.base_sha,
      expected_evidence_fingerprint: expectedFingerprint,
      current_evidence_fingerprint: plan.evidence_fingerprint,
    });
  }
  const expectedConfirm = githubBranchCleanupSweepConfirmation(plan.base_sha, plan.evidence_fingerprint);
  if (String(options.confirm || "") !== expectedConfirm) {
    throw sweepError(400, "github_branch_cleanup_sweep_confirmation_required", `Branch cleanup sweep requires confirm=${expectedConfirm}.`, {
      expected_confirm: expectedConfirm,
    });
  }

  const deletions = [];
  const failures = [];
  for (const candidate of plan.deletion_plan) {
    try {
      const result = await deleteGithubBranchRef({
        owner: target.owner,
        repo: target.repo,
        default_branch: plan.default_branch,
        token,
        fetchImpl,
        branch: candidate.branch,
        expected_head_sha: candidate.head_sha,
        confirm: githubBranchDeleteConfirmation(candidate.branch),
        allowed_prefixes: plan.policy.branch_prefixes,
      });
      deletions.push(result);
    } catch (error) {
      failures.push({
        branch: candidate.branch,
        expected_head_sha: candidate.head_sha,
        error: {
          code: error?.code || "github_branch_cleanup_sweep_delete_failed",
          message: error?.message || "Branch deletion failed.",
          details: error?.details || null,
        },
      });
      break;
    }
  }

  const completed = failures.length === 0;
  return {
    ...plan,
    ok: completed,
    mode: "apply",
    status: completed ? (deletions.length ? "completed" : "no_op") : "partial_success",
    applied_delete_count: deletions.filter((item) => item.deleted || item.already_absent).length,
    deletions,
    failures,
    stopped_on_first_failure: failures.length > 0,
    secrets_included: false,
  };
}
