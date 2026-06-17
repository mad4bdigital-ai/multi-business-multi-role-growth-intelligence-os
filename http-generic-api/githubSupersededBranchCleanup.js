import { createHash } from "node:crypto";
import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { writeAuditLog } from "./auditLogger.js";
import { getPool } from "./db.js";
import { assertAdminBranchReconcileTarget } from "./adminBranchReconciliationAdapter.js";

export const GITHUB_SUPERSEDED_BRANCH_CLEANUP_VERSION = "github-superseded-branch-cleanup-v1";
const POLICY_GROUP = "Repository Mutation Governance";
const POLICY_KEY = "Stale Duplicate Branch Merge Guard";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function encodeRef(ref = "") {
  return String(ref || "").split("/").map(encodeURIComponent).join("/");
}

function encodeCompareRef(ref = "") {
  return encodeURIComponent(String(ref || "").trim());
}

function fileList(payload = {}) {
  return uniqueStrings((payload.files || []).map((file) => file?.filename)).sort();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function supersededBranchCleanupFingerprint(value = {}) {
  return createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex");
}

export function supersededBranchCleanupConfirmation(branch = "", fingerprint = "") {
  const slug = String(branch || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `DELETE_SUPERSEDED_BRANCH_${slug}_${String(fingerprint || "").slice(0, 12).toUpperCase()}`;
}

async function loadCleanupPolicy(deps = {}, { allowOrphanBranch = false } = {}) {
  if (deps.policy) return deps.policy;
  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    `SELECT policy_value, active, blocking FROM execution_policies
      WHERE policy_group = ? AND policy_key = ? LIMIT 1`,
    [POLICY_GROUP, POLICY_KEY]
  );
  const row = rows?.[0];
  const policy = parseJson(row?.policy_value);
  const required = [
    "allow_superseded_closed_pr_branch_delete",
    "superseded_branch_delete_requires_closed_pr",
    "superseded_branch_delete_requires_no_open_pr",
    "superseded_branch_delete_requires_main_ancestor_replacement",
    "superseded_branch_delete_requires_changed_file_coverage",
    "superseded_branch_delete_requires_fresh_sha_evidence",
    "superseded_branch_delete_requires_capability_envelope",
    "superseded_branch_delete_requires_same_cycle_readback",
  ];
  if (allowOrphanBranch) {
    required.push(
      "allow_superseded_orphan_branch_delete",
      "superseded_orphan_branch_requires_no_matching_pr",
      "superseded_orphan_branch_requires_main_ancestor_replacement",
      "superseded_orphan_branch_requires_changed_file_coverage",
      "superseded_orphan_branch_requires_content_equivalence",
      "superseded_orphan_branch_requires_fresh_sha_evidence",
      "superseded_orphan_branch_requires_capability_envelope",
      "superseded_orphan_branch_requires_same_cycle_readback"
    );
  }
  const missing = required.filter((key) => !bool(policy[key]));
  if (!row || !bool(row.active) || !bool(row.blocking) || missing.length) {
    const err = new Error("Superseded branch cleanup policy is unavailable or incomplete.");
    err.status = 503;
    err.code = "superseded_branch_cleanup_policy_unavailable";
    err.details = { missing_policy_flags: missing, secrets_included: false };
    throw err;
  }
  return policy;
}

async function githubJson({ owner, repo, apiPath, token, method = "GET", body, fetchImpl = fetch, allowNotFound = false }) {
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-superseded-branch-cleanup",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.message || `GitHub request failed with HTTP ${response.status}.`);
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    err.code = response.status === 404 ? "github_superseded_branch_not_found" : "github_superseded_branch_request_failed";
    err.details = { status: response.status, apiPath, github_error: payload || null, secrets_included: false };
    throw err;
  }
  return payload;
}

async function resolveTarget(args = {}) {
  const cfg = args.owner && args.repo ? null : await resolveActivationBootstrapConfig({});
  const owner = String(args.owner || cfg?.config?.github_owner || "").trim();
  const repo = String(args.repo || cfg?.config?.github_repo || "").trim();
  const defaultBranch = String(args.default_branch || cfg?.config?.github_branch || "main").trim() || "main";
  const branch = String(args.branch || "").trim();
  if (!owner || !repo) {
    const err = new Error("GitHub owner/repo are required for superseded branch cleanup.");
    err.status = 400;
    err.code = "github_superseded_branch_repo_required";
    throw err;
  }
  assertAdminBranchReconcileTarget({ branch, default_branch: defaultBranch, mode: "dry_run" });
  return { owner, repo, branch, default_branch: defaultBranch };
}

function normalizeSupersedingCommits(values = [], maxCommits = 20) {
  const commits = uniqueStrings(values);
  if (!commits.length || commits.length > maxCommits || commits.some((sha) => !SHA_PATTERN.test(sha))) {
    const err = new Error(`superseding_commits must contain 1-${maxCommits} full commit SHAs.`);
    err.status = 400;
    err.code = "github_superseded_branch_commits_invalid";
    throw err;
  }
  return commits.map((sha) => sha.toLowerCase());
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function resolveBranchAheadLimit(policy = {}, branch = "", branchSha = "", nowValue = Date.now()) {
  const globalMaxAhead = boundedInteger(policy.superseded_branch_delete_max_ahead_commits, 20, 1, 100);
  const overrides = parseJson(policy.superseded_branch_delete_branch_overrides);
  const raw = overrides && typeof overrides === "object" ? overrides[branch] : null;
  const nowMs = typeof nowValue === "function" ? Number(nowValue()) : Number(nowValue);
  const evidence = {
    configured: Boolean(raw && typeof raw === "object"),
    applied: false,
    branch,
    global_max_ahead_commits: globalMaxAhead,
    effective_max_ahead_commits: globalMaxAhead,
    expected_branch_sha: null,
    expires_at: null,
    reason: null,
    validation_failures: [],
    secrets_included: false,
  };
  if (!evidence.configured) return evidence;

  const requestedMaxAhead = boundedInteger(raw.max_ahead_commits, globalMaxAhead, 1, 100);
  const expectedBranchSha = String(raw.expected_branch_sha || "").trim().toLowerCase();
  const expiresAt = String(raw.expires_at || "").trim();
  const expiresAtMs = Date.parse(expiresAt);
  const reason = String(raw.reason || "").trim();
  evidence.requested_max_ahead_commits = requestedMaxAhead;
  evidence.expected_branch_sha = expectedBranchSha || null;
  evidence.expires_at = expiresAt || null;
  evidence.reason = reason || null;

  if (requestedMaxAhead <= globalMaxAhead) evidence.validation_failures.push("override_limit_must_exceed_global_limit");
  if (!SHA_PATTERN.test(expectedBranchSha) || expectedBranchSha !== String(branchSha || "").toLowerCase()) {
    evidence.validation_failures.push("override_branch_sha_mismatch");
  }
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) evidence.validation_failures.push("override_expired_or_invalid");
  if (reason.length < 20) evidence.validation_failures.push("override_reason_too_short");

  if (!evidence.validation_failures.length) {
    evidence.applied = true;
    evidence.effective_max_ahead_commits = requestedMaxAhead;
  }
  return evidence;
}
export async function buildSupersededBranchCleanupEvidence(args = {}, deps = {}) {
  const allowOrphanBranch = bool(args.allow_orphan_branch);
  const policy = await loadCleanupPolicy(deps, { allowOrphanBranch });
  const target = await resolveTarget(args);
  const maxCommits = Math.max(1, Math.min(Number(policy.superseded_branch_delete_max_replacement_commits || 20), 50));
  const maxFiles = Math.max(1, Math.min(Number(policy.superseded_branch_delete_max_changed_files || 100), 300));
  const requiredLabel = String(policy.superseded_branch_delete_required_label || "superseded").trim().toLowerCase();
  const commits = normalizeSupersedingCommits(args.superseding_commits, maxCommits);
  const token = deps.token || await getGitHubAppInstallationToken({});
  const fetchImpl = deps.fetchImpl || fetch;
  const query = new URLSearchParams({ state: "all", base: target.default_branch, head: `${target.owner}:${target.branch}`, per_page: "20" });
  const [baseRef, branchRef, baseToBranch, pulls] = await Promise.all([
    githubJson({ ...target, apiPath: `/git/ref/heads/${encodeRef(target.default_branch)}`, token, fetchImpl }),
    githubJson({ ...target, apiPath: `/git/ref/heads/${encodeRef(target.branch)}`, token, fetchImpl }),
    githubJson({ ...target, apiPath: `/compare/${encodeCompareRef(target.default_branch)}...${encodeCompareRef(target.branch)}`, token, fetchImpl }),
    githubJson({ ...target, apiPath: `/pulls?${query}`, token, fetchImpl }),
  ]);
  const replacementEvidence = await Promise.all(commits.map(async (sha) => {
    const [commit, ancestry] = await Promise.all([
      githubJson({ ...target, apiPath: `/commits/${encodeURIComponent(sha)}`, token, fetchImpl }),
      githubJson({ ...target, apiPath: `/compare/${encodeCompareRef(sha)}...${encodeCompareRef(target.default_branch)}`, token, fetchImpl }),
    ]);
    return {
      sha,
      resolved_sha: String(commit?.sha || "").toLowerCase(),
      on_default_branch: Number(ancestry?.behind_by || 0) === 0 && ["ahead", "identical"].includes(String(ancestry?.status || "").toLowerCase()),
      files: fileList(commit),
    };
  }));
  const exactPulls = (Array.isArray(pulls) ? pulls : []).filter((pr) =>
    pr?.head?.ref === target.branch && pr?.base?.ref === target.default_branch && pr?.head?.repo?.full_name === `${target.owner}/${target.repo}`
  );
  const openPulls = exactPulls.filter((pr) => pr?.state === "open");
  const closedPulls = exactPulls.filter((pr) => pr?.state === "closed");
  const labeledClosedPulls = closedPulls.filter((pr) => (pr?.labels || []).some((label) => String(label?.name || label || "").trim().toLowerCase() === requiredLabel));
  const branchRefSha = String(branchRef?.object?.sha || "").toLowerCase();
  const branchLimitEvidence = resolveBranchAheadLimit(policy, target.branch, branchRefSha, deps.now || Date.now());
  const maxAhead = branchLimitEvidence.effective_max_ahead_commits;
  const branchFiles = fileList(baseToBranch);
  const replacementFiles = uniqueStrings(replacementEvidence.flatMap((item) => item.files)).sort();
  const generatedPrefixes = uniqueStrings(policy.superseded_branch_delete_generated_path_prefixes || []);
  const generatedFiles = branchFiles.filter((file) => generatedPrefixes.some((prefix) => file.startsWith(prefix)));
  const coveredFiles = branchFiles.filter((file) => replacementFiles.includes(file));
  const uncoveredFiles = branchFiles.filter((file) => !coveredFiles.includes(file) && !generatedFiles.includes(file));
  const orphanContentEvidence = allowOrphanBranch
    ? await Promise.all(branchFiles.filter((file) => !generatedFiles.includes(file)).map(async (file) => {
        const contentPath = `/contents/${encodeRef(file)}`;
        const [branchContent, defaultContent] = await Promise.all([
          githubJson({ ...target, apiPath: `${contentPath}?ref=${encodeURIComponent(branchRefSha)}`, token, fetchImpl, allowNotFound: true }),
          githubJson({ ...target, apiPath: `${contentPath}?ref=${encodeURIComponent(String(baseRef?.object?.sha || ""))}`, token, fetchImpl, allowNotFound: true }),
        ]);
        const branchBlobSha = String(branchContent?.sha || "").toLowerCase() || null;
        const defaultBlobSha = String(defaultContent?.sha || "").toLowerCase() || null;
        return {
          file,
          branch_blob_sha: branchBlobSha,
          default_blob_sha: defaultBlobSha,
          content_equivalent: branchBlobSha === defaultBlobSha
            && String(branchContent?.type || "file") === String(defaultContent?.type || "file"),
        };
      }))
    : [];
  const orphanContentMismatches = orphanContentEvidence.filter((item) => !item.content_equivalent).map((item) => item.file);
  const blockers = [];
  if (branchFiles.length > maxFiles) blockers.push("changed_file_limit_exceeded");
  if (Number(baseToBranch?.ahead_by || 0) > maxAhead) blockers.push("ahead_commit_limit_exceeded");
  if (allowOrphanBranch) {
    if (exactPulls.length) blockers.push("orphan_branch_requires_no_matching_pull_request");
  } else {
    if (!closedPulls.length) blockers.push("closed_pull_request_required");
    if (!labeledClosedPulls.length) blockers.push("superseded_pull_request_label_required");
  }
  if (openPulls.length) blockers.push("open_pull_request_exists");
  if (replacementEvidence.some((item) => item.resolved_sha !== item.sha)) blockers.push("superseding_commit_resolution_mismatch");
  if (replacementEvidence.some((item) => !item.on_default_branch)) blockers.push("superseding_commit_not_on_default_branch");
  if (uncoveredFiles.length) blockers.push("changed_file_coverage_incomplete");
  if (allowOrphanBranch && orphanContentMismatches.length) blockers.push("orphan_branch_content_not_equivalent_to_default");
  if (!branchFiles.length || Number(baseToBranch?.ahead_by || 0) < 1) blockers.push("branch_has_no_unmerged_changes");
  const fingerprintInput = {
    owner: target.owner, repo: target.repo, branch: target.branch, default_branch: target.default_branch,
    base_ref_sha: String(baseRef?.object?.sha || "").toLowerCase(),
    branch_ref_sha: String(branchRef?.object?.sha || "").toLowerCase(),
    compare_status: baseToBranch?.status || null,
    ahead_by: Number(baseToBranch?.ahead_by || 0), behind_by: Number(baseToBranch?.behind_by || 0),
    lifecycle_mode: allowOrphanBranch ? "orphan_branch" : "closed_pr",
    allow_orphan_branch: allowOrphanBranch,
    closed_pr_numbers: closedPulls.map((pr) => Number(pr.number)).sort((a, b) => a - b),
    labeled_closed_pr_numbers: labeledClosedPulls.map((pr) => Number(pr.number)).sort((a, b) => a - b),
    required_label: requiredLabel,
    superseding_commits: commits, branch_changed_files: branchFiles, replacement_files: replacementFiles,
    generated_files: generatedFiles, uncovered_files: uncoveredFiles,
    orphan_content_mismatches: orphanContentMismatches, orphan_content_evidence: orphanContentEvidence,
    branch_limit_evidence: branchLimitEvidence,
  };
  const evidenceFingerprint = supersededBranchCleanupFingerprint(fingerprintInput);
  const requiredConfirmation = supersededBranchCleanupConfirmation(target.branch, evidenceFingerprint);
  return {
    ok: true, adapter: GITHUB_SUPERSEDED_BRANCH_CLEANUP_VERSION,
    mode: String(args.mode || "dry_run").toLowerCase() === "apply" ? "apply" : "dry_run",
    ready: blockers.length === 0, target,
    pull_request_evidence: { lifecycle_mode: fingerprintInput.lifecycle_mode, allow_orphan_branch: allowOrphanBranch, matching_count: exactPulls.length, open_pr_numbers: openPulls.map((pr) => Number(pr.number)), closed_pr_numbers: closedPulls.map((pr) => Number(pr.number)), labeled_closed_pr_numbers: labeledClosedPulls.map((pr) => Number(pr.number)), required_label: requiredLabel },
    replacement_evidence: replacementEvidence,
    policy_evidence: { branch_limit: branchLimitEvidence, secrets_included: false },
    branch_evidence: {
      base_ref_sha: fingerprintInput.base_ref_sha, branch_ref_sha: fingerprintInput.branch_ref_sha,
      compare_status: fingerprintInput.compare_status, ahead_by: fingerprintInput.ahead_by, behind_by: fingerprintInput.behind_by,
      changed_files: branchFiles, covered_files: coveredFiles, generated_files: generatedFiles, uncovered_files: uncoveredFiles,
      content_equivalence_evidence: orphanContentEvidence, content_mismatches: orphanContentMismatches,
    },
    blockers, evidence_fingerprint: evidenceFingerprint, required_confirmation: requiredConfirmation,
    applies_ref_delete: false, secrets_included: false,
  };
}
function requireApplyEvidence(args, evidence) {
  const expectedBase = String(args.expected_base_sha || "").toLowerCase();
  const expectedBranch = String(args.expected_branch_sha || "").toLowerCase();
  const expectedFingerprint = String(args.expected_evidence_fingerprint || "").toLowerCase();
  if (!SHA_PATTERN.test(expectedBase) || !SHA_PATTERN.test(expectedBranch) || !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    const err = new Error("Fresh base SHA, branch SHA, and evidence fingerprint are required for apply.");
    err.status = 400;
    err.code = "github_superseded_branch_fresh_evidence_required";
    throw err;
  }
  if (expectedBase !== evidence.branch_evidence.base_ref_sha || expectedBranch !== evidence.branch_evidence.branch_ref_sha || expectedFingerprint !== evidence.evidence_fingerprint) {
    const err = new Error("Superseded branch cleanup evidence is stale.");
    err.status = 409;
    err.code = "github_superseded_branch_stale_evidence";
    err.details = {
      expected_base_sha: expectedBase, current_base_sha: evidence.branch_evidence.base_ref_sha,
      expected_branch_sha: expectedBranch, current_branch_sha: evidence.branch_evidence.branch_ref_sha,
      expected_evidence_fingerprint: expectedFingerprint, current_evidence_fingerprint: evidence.evidence_fingerprint,
      secrets_included: false,
    };
    throw err;
  }
  if (!String(args.capability_envelope_id || "").trim()) {
    const err = new Error("capability_envelope_id is required for apply.");
    err.status = 400;
    err.code = "github_superseded_branch_capability_envelope_required";
    throw err;
  }
  if (String(args.confirm || "") !== evidence.required_confirmation) {
    const err = new Error(`Apply requires confirm=${evidence.required_confirmation}.`);
    err.status = 400;
    err.code = "github_superseded_branch_confirmation_required";
    throw err;
  }
  if (String(args.reason || "").trim().length < 20) {
    const err = new Error("A cleanup reason of at least 20 characters is required.");
    err.status = 400;
    err.code = "github_superseded_branch_reason_required";
    throw err;
  }
}

export async function runGithubSupersededBranchCleanup(args = {}, deps = {}) {
  const evidence = await buildSupersededBranchCleanupEvidence(args, deps);
  if (evidence.mode !== "apply") return evidence;
  if (!evidence.ready) {
    const err = new Error("Superseded branch cleanup is blocked by evidence requirements.");
    err.status = 409;
    err.code = "github_superseded_branch_cleanup_blocked";
    err.details = { blockers: evidence.blockers, branch_evidence: evidence.branch_evidence, secrets_included: false };
    throw err;
  }
  requireApplyEvidence(args, evidence);
  const token = deps.token || await getGitHubAppInstallationToken({});
  const fetchImpl = deps.fetchImpl || fetch;
  const auditWrite = deps.writeAuditLog || writeAuditLog;
  const principal = deps?.auth?.user_id || deps?.auth?.mode || "admin";
  const auditBase = {
    actor_id: principal,
    actor_type: deps?.auth?.user_id ? "user" : "service",
    user_id: deps?.auth?.user_id || null,
    correlation_id: evidence.evidence_fingerprint,
    resource_type: "github_branch",
    resource_id: `${evidence.target.owner}/${evidence.target.repo}:${evidence.target.branch}`,
    service_mode: "managed",
  };
  const auditContext = {
    target: evidence.target,
    pull_request_evidence: evidence.pull_request_evidence,
    replacement_evidence: evidence.replacement_evidence,
    branch_evidence: evidence.branch_evidence,
    evidence_fingerprint: evidence.evidence_fingerprint,
    reason: String(args.reason || "").trim(),
    capability_envelope_id: args.capability_envelope_id || null,
    secrets_included: false,
  };

  const intentAuditId = await auditWrite({
    ...auditBase,
    action: "github_superseded_branch_cleanup_intent",
    execution_context_json: { ...auditContext, phase: "pre_delete", outcome: "authorized", secrets_included: false },
    outcome: "authorized",
  });

  let readback;
  try {
    await githubJson({ ...evidence.target, apiPath: `/git/refs/heads/${encodeRef(evidence.target.branch)}`, method: "DELETE", token, fetchImpl });
    readback = await githubJson({ ...evidence.target, apiPath: `/git/ref/heads/${encodeRef(evidence.target.branch)}`, token, fetchImpl, allowNotFound: true });
    if (readback !== null) {
      const err = new Error("Branch deletion was requested but the branch still exists on readback.");
      err.status = 502;
      err.code = "github_superseded_branch_delete_readback_failed";
      throw err;
    }
  } catch (error) {
    await auditWrite({
      ...auditBase,
      action: "github_superseded_branch_cleanup_failed",
      execution_context_json: { ...auditContext, phase: "delete_or_readback", outcome: "failed", secrets_included: false },
      after_json: { deleted: false, error_code: error?.code || "github_request_failed", secrets_included: false },
      outcome: "failed",
    });
    throw error;
  }

  const result = {
    ...evidence,
    ok: true,
    deleted: true,
    applies_ref_delete: true,
    reason: auditContext.reason,
    capability_envelope_id: auditContext.capability_envelope_id,
    readback: { branch_missing: true, verified: true, secrets_included: false },
    audit: { intent_audit_id: intentAuditId || null, completion_audit_id: null, completed: false },
    secrets_included: false,
  };
  const completionAuditId = await auditWrite({
    ...auditBase,
    action: "github_superseded_branch_cleanup_completed",
    execution_context_json: { ...auditContext, phase: "post_delete_readback", outcome: "success", readback: result.readback, secrets_included: false },
    after_json: { deleted: true, readback: result.readback, secrets_included: false },
    outcome: "success",
  });
  result.audit = {
    intent_audit_id: intentAuditId || null,
    completion_audit_id: completionAuditId || null,
    completed: true,
  };
  return result;
}