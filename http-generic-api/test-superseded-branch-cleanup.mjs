import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GITHUB_SUPERSEDED_BRANCH_CLEANUP_VERSION,
  buildSupersededBranchCleanupEvidence,
  runGithubSupersededBranchCleanup,
  supersededBranchCleanupConfirmation,
  supersededBranchCleanupFingerprint,
} from "./githubSupersededBranchCleanup.js";

const owner = "mad4bdigital-ai";
const repo = "multi-business-multi-role-growth-intelligence-os";
const branch = "gpt/migration-245-collation-immutability-20260614";
const baseSha = "b".repeat(40);
const branchSha = "a".repeat(40);
const migrationCommit = "1".repeat(40);
const testCommit = "2".repeat(40);
const migrationFile = "http-generic-api/migrations/245_sprint68_agent_governance_runtime.sql";
const testFile = "http-generic-api/test-agent-governance-runtime.mjs";
const generatedFile = "docs/auto-docs-agent/pr-1579.md";
const policy = {
  allow_superseded_closed_pr_branch_delete: true,
  superseded_branch_delete_requires_closed_pr: true,
  superseded_branch_delete_requires_no_open_pr: true,
  superseded_branch_delete_requires_main_ancestor_replacement: true,
  superseded_branch_delete_requires_changed_file_coverage: true,
  superseded_branch_delete_requires_fresh_sha_evidence: true,
  superseded_branch_delete_requires_capability_envelope: true,
  superseded_branch_delete_requires_same_cycle_readback: true,
  superseded_branch_delete_generated_path_prefixes: ["docs/auto-docs-agent/"],
  superseded_branch_delete_required_label: "superseded",
  superseded_branch_delete_max_ahead_commits: 20,
  superseded_branch_delete_max_replacement_commits: 20,
  superseded_branch_delete_max_changed_files: 100,
};

let deleted = false;
let deleteCalls = 0;
let auditCalls = 0;
const auditActions = [];
const response = (status, payload = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return payload; },
});
const fetchImpl = async (url, options = {}) => {
  const parsed = new URL(url);
  const apiPath = `${parsed.pathname}${parsed.search}`;
  if (options.method === "DELETE" && apiPath.includes(`/git/refs/heads/${branch}`)) {
    assert.equal(options.body, undefined, "DELETE ref request must not send a synthetic JSON body");
    deleteCalls += 1;
    deleted = true;
    return response(204, {});
  }
  if (apiPath.includes("/git/ref/heads/main")) return response(200, { object: { sha: baseSha } });
  if (apiPath.includes(`/git/ref/heads/${branch}`)) return deleted ? response(404, { message: "Not Found" }) : response(200, { object: { sha: branchSha } });
  if (apiPath.includes(`/compare/main...${encodeURIComponent(branch)}`)) {
    return response(200, {
      status: "diverged",
      ahead_by: 3,
      behind_by: 70,
      files: [{ filename: migrationFile }, { filename: testFile }, { filename: generatedFile }],
    });
  }
  if (apiPath.includes("/pulls?")) {
    return response(200, [{
      number: 1579,
      state: "closed",
      head: { ref: branch, repo: { full_name: `${owner}/${repo}` } },
      base: { ref: "main" },
      labels: [{ name: "superseded" }],
    }]);
  }
  if (apiPath.includes(`/commits/${migrationCommit}`)) return response(200, { sha: migrationCommit, files: [{ filename: migrationFile }] });
  if (apiPath.includes(`/commits/${testCommit}`)) return response(200, { sha: testCommit, files: [{ filename: testFile }] });
  if (apiPath.includes(`/compare/${migrationCommit}...main`) || apiPath.includes(`/compare/${testCommit}...main`)) {
    return response(200, { status: "ahead", ahead_by: 5, behind_by: 0 });
  }
  throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${apiPath}`);
};

const args = {
  owner,
  repo,
  branch,
  default_branch: "main",
  superseding_commits: [migrationCommit, testCommit],
};
const deps = {
  token: "test-token",
  policy,
  fetchImpl,
  async writeAuditLog(payload) {
    auditCalls += 1;
    auditActions.push(payload.action);
    assert.equal(payload.execution_context_json.secrets_included, false);
    assert.equal(payload.correlation_id.length, 64);
    return `audit-${auditCalls}`;
  },
};

const dryRun = await buildSupersededBranchCleanupEvidence(args, deps);
assert.equal(dryRun.adapter, GITHUB_SUPERSEDED_BRANCH_CLEANUP_VERSION);
assert.equal(dryRun.ready, true);
assert.deepEqual(dryRun.blockers, []);
assert.deepEqual(dryRun.pull_request_evidence.closed_pr_numbers, [1579]);
assert.deepEqual(dryRun.pull_request_evidence.open_pr_numbers, []);
assert.deepEqual(dryRun.pull_request_evidence.labeled_closed_pr_numbers, [1579]);
assert.equal(dryRun.pull_request_evidence.required_label, "superseded");
assert.deepEqual(dryRun.branch_evidence.uncovered_files, []);
assert.deepEqual(dryRun.branch_evidence.generated_files, [generatedFile]);
assert.equal(dryRun.applies_ref_delete, false);
assert.equal(deleteCalls, 0);
assert.equal(
  dryRun.required_confirmation,
  supersededBranchCleanupConfirmation(branch, dryRun.evidence_fingerprint)
);
assert.equal(dryRun.evidence_fingerprint.length, 64);
assert.equal(supersededBranchCleanupFingerprint({ b: 1, a: 2 }), supersededBranchCleanupFingerprint({ a: 2, b: 1 }));

const highAheadFetch = async (url, options = {}) => {
  const apiPath = `${new URL(url).pathname}${new URL(url).search}`;
  if (apiPath.includes(`/compare/main...${encodeURIComponent(branch)}`)) {
    return response(200, {
      status: "diverged",
      ahead_by: 53,
      behind_by: 70,
      files: [{ filename: migrationFile }, { filename: testFile }, { filename: generatedFile }],
    });
  }
  return fetchImpl(url, options);
};
const fixedNow = Date.parse("2026-06-17T10:00:00.000Z");
const validOverride = {
  ...policy,
  superseded_branch_delete_branch_overrides: {
    [branch]: {
      max_ahead_commits: 60,
      expected_branch_sha: branchSha,
      expires_at: "2026-06-17T11:00:00.000Z",
      reason: "One-time cleanup of a fully covered superseded branch.",
    },
  },
};
const highAheadAllowed = await buildSupersededBranchCleanupEvidence(args, {
  ...deps,
  policy: validOverride,
  fetchImpl: highAheadFetch,
  now: fixedNow,
});
assert.equal(highAheadAllowed.ready, true);
assert.equal(highAheadAllowed.policy_evidence.branch_limit.applied, true);
assert.equal(highAheadAllowed.policy_evidence.branch_limit.global_max_ahead_commits, 20);
assert.equal(highAheadAllowed.policy_evidence.branch_limit.effective_max_ahead_commits, 60);
assert.deepEqual(highAheadAllowed.policy_evidence.branch_limit.validation_failures, []);

const expiredOverride = {
  ...validOverride,
  superseded_branch_delete_branch_overrides: {
    [branch]: {
      ...validOverride.superseded_branch_delete_branch_overrides[branch],
      expires_at: "2026-06-17T09:00:00.000Z",
    },
  },
};
const highAheadExpired = await buildSupersededBranchCleanupEvidence(args, {
  ...deps,
  policy: expiredOverride,
  fetchImpl: highAheadFetch,
  now: fixedNow,
});
assert.equal(highAheadExpired.ready, false);
assert(highAheadExpired.blockers.includes("ahead_commit_limit_exceeded"));
assert(highAheadExpired.policy_evidence.branch_limit.validation_failures.includes("override_expired_or_invalid"));

const mismatchedShaOverride = {
  ...validOverride,
  superseded_branch_delete_branch_overrides: {
    [branch]: {
      ...validOverride.superseded_branch_delete_branch_overrides[branch],
      expected_branch_sha: "c".repeat(40),
    },
  },
};
const highAheadShaMismatch = await buildSupersededBranchCleanupEvidence(args, {
  ...deps,
  policy: mismatchedShaOverride,
  fetchImpl: highAheadFetch,
  now: fixedNow,
});
assert.equal(highAheadShaMismatch.ready, false);
assert(highAheadShaMismatch.blockers.includes("ahead_commit_limit_exceeded"));
assert(highAheadShaMismatch.policy_evidence.branch_limit.validation_failures.includes("override_branch_sha_mismatch"));

await assert.rejects(
  () => buildSupersededBranchCleanupEvidence({ ...args, branch: "main" }, deps),
  (error) => error?.code === "admin_branch_reconcile_protected_branch"
);

const missingLabelFetch = async (url, options = {}) => {
  const apiPath = `${new URL(url).pathname}${new URL(url).search}`;
  if (apiPath.includes("/pulls?")) {
    return response(200, [{
      number: 1579,
      state: "closed",
      head: { ref: branch, repo: { full_name: `${owner}/${repo}` } },
      base: { ref: "main" },
      labels: [],
    }]);
  }
  return fetchImpl(url, options);
};
const missingLabel = await buildSupersededBranchCleanupEvidence(args, { ...deps, fetchImpl: missingLabelFetch });
assert.equal(missingLabel.ready, false);
assert(missingLabel.blockers.includes("superseded_pull_request_label_required"));
assert.equal(deleteCalls, 0);

const incompleteCoverageFetch = async (url, options = {}) => {
  const apiPath = `${new URL(url).pathname}${new URL(url).search}`;
  if (apiPath.includes(`/commits/${testCommit}`)) return response(200, { sha: testCommit, files: [] });
  return fetchImpl(url, options);
};
const incompleteCoverage = await buildSupersededBranchCleanupEvidence(args, { ...deps, fetchImpl: incompleteCoverageFetch });
assert.equal(incompleteCoverage.ready, false);
assert(incompleteCoverage.blockers.includes("changed_file_coverage_incomplete"));
assert.deepEqual(incompleteCoverage.branch_evidence.uncovered_files, [testFile]);
assert.equal(deleteCalls, 0);

await assert.rejects(
  () => runGithubSupersededBranchCleanup({
    ...args,
    mode: "apply",
    expected_base_sha: dryRun.branch_evidence.base_ref_sha,
    expected_branch_sha: dryRun.branch_evidence.branch_ref_sha,
    expected_evidence_fingerprint: dryRun.evidence_fingerprint,
    confirm: dryRun.required_confirmation,
    reason: "Superseded by verified commits on main.",
  }, deps),
  (error) => error?.code === "github_superseded_branch_capability_envelope_required"
);
assert.equal(deleteCalls, 0);

await assert.rejects(
  () => runGithubSupersededBranchCleanup({
    ...args,
    mode: "apply",
    expected_base_sha: baseSha,
    expected_branch_sha: branchSha,
    expected_evidence_fingerprint: "f".repeat(64),
    confirm: dryRun.required_confirmation,
    reason: "Superseded by verified commits on main.",
    capability_envelope_id: "env-test",
  }, deps),
  (error) => error?.code === "github_superseded_branch_stale_evidence"
);
assert.equal(deleteCalls, 0);
assert.equal(auditCalls, 0);

const applied = await runGithubSupersededBranchCleanup({
  ...args,
  mode: "apply",
  expected_base_sha: dryRun.branch_evidence.base_ref_sha,
  expected_branch_sha: dryRun.branch_evidence.branch_ref_sha,
  expected_evidence_fingerprint: dryRun.evidence_fingerprint,
  confirm: dryRun.required_confirmation,
  reason: "Superseded by verified commits already on main.",
  capability_envelope_id: "env-test",
}, deps);
assert.equal(applied.deleted, true);
assert.equal(applied.readback.branch_missing, true);
assert.equal(applied.applies_ref_delete, true);
assert.equal(deleteCalls, 1);
assert.equal(auditCalls, 2);
assert.deepEqual(auditActions, [
  "github_superseded_branch_cleanup_intent",
  "github_superseded_branch_cleanup_completed",
]);
assert.equal(applied.audit.intent_audit_id, "audit-1");
assert.equal(applied.audit.completion_audit_id, "audit-2");
assert.equal(applied.audit.completed, true);

const routes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/311_sprint69_superseded_closed_pr_branch_cleanup.sql", import.meta.url), "utf8");
assert.equal((routes.match(/name: "github_superseded_branch_cleanup"/g) || []).length, 1);
assert.match(routes, /requireGithubSupersededBranchCleanupEnvelope/);
assert.match(routes, /acceptedIntents: \["github_superseded_branch_cleanup", "github_branch_delete", "branch_cleanup", "repo_mutation"\]/);
assert.match(routes, /runGithubSupersededBranchCleanup/);
assert.match(migration, /allow_superseded_closed_pr_branch_delete/);
assert.match(migration, /superseded_branch_delete_requires_changed_file_coverage/);
assert.match(migration, /superseded_branch_delete_requires_same_cycle_readback/);
assert.match(migration, /superseded_branch_delete_required_label/);
assert.match(migration, /superseded_branch_delete_max_ahead_commits/);
assert.match(migration, /superseded_branch_delete_force_allowed', false/);
assert.match(migration, /generic_fallback_allowed', false/);
assert.match(migration, /311_sprint69_superseded_closed_pr_branch_cleanup\.sql/);

console.log("superseded branch cleanup tests passed");