import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  githubBranchCleanupSweepConfirmation,
  runGithubBranchCleanupSweep,
} from "./githubBranchCleanupSweep.js";

const OWNER = "mad4bdigital-ai";
const REPO = "growth-os";
const BASE_SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);
const UNIQUE_SHA = "c".repeat(40);
const OPEN_SHA = "d".repeat(40);
const RECENT_SHA = "e".repeat(40);
const UNMANAGED_SHA = "f".repeat(40);
const NOW = "2026-06-20T12:00:00.000Z";

function response(status, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function queuedFetch(entries, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    const next = entries.shift();
    assert(next, `Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    return response(next.status, next.payload);
  };
}

function planningResponses() {
  return [
    { status: 200, payload: { default_branch: "main" } },
    { status: 200, payload: { object: { sha: BASE_SHA } } },
    { status: 200, payload: [{ number: 77, head: { ref: "gpt/open-pr", repo: { full_name: `${OWNER}/${REPO}` } } }] },
    {
      status: 200,
      payload: [
        { name: "main", protected: true, commit: { sha: BASE_SHA } },
        { name: "gpt/old-safe", protected: false, commit: { sha: OLD_SHA } },
        { name: "gpt/unique-work", protected: false, commit: { sha: UNIQUE_SHA } },
        { name: "gpt/open-pr", protected: false, commit: { sha: OPEN_SHA } },
        { name: "gpt/recent-safe", protected: false, commit: { sha: RECENT_SHA } },
        { name: "unmanaged/old", protected: false, commit: { sha: UNMANAGED_SHA } },
      ],
    },
    { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 20 } },
    { status: 200, payload: { commit: { committer: { date: "2026-05-01T00:00:00.000Z" } } } },
    { status: 200, payload: { status: "diverged", ahead_by: 2, behind_by: 18 } },
    { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 1 } },
    { status: 200, payload: { commit: { committer: { date: "2026-06-19T12:00:00.000Z" } } } },
  ];
}

const dryRunCalls = [];
const dryRun = await runGithubBranchCleanupSweep({
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  token: "test-token",
  mode: "dry_run",
  page: 1,
  max_pages: 1,
  scan_limit: 100,
  max_deletes: 10,
  min_age_days: 7,
  now: NOW,
  fetchImpl: queuedFetch(planningResponses(), dryRunCalls),
});

assert.equal(dryRun.mode, "dry_run");
assert.equal(dryRun.base_sha, BASE_SHA);
assert.equal(dryRun.summary.eligible_count, 1);
assert.equal(dryRun.summary.planned_delete_count, 1);
assert.deepEqual(dryRun.deletion_plan.map((item) => item.branch), ["gpt/old-safe"]);
assert.equal(dryRun.summary.excluded_counts.protected_or_default, 1);
assert.equal(dryRun.summary.excluded_counts.prefix_not_allowed, 1);
assert.equal(dryRun.summary.excluded_counts.open_pull_request, 1);
assert.equal(dryRun.summary.excluded_counts.contains_unique_commits, 1);
assert.equal(dryRun.summary.excluded_counts.recent_branch, 1);
assert.equal(dryRun.expected_confirm, githubBranchCleanupSweepConfirmation(BASE_SHA, dryRun.evidence_fingerprint));
assert.match(dryRun.expected_confirm, /^APPLY_GITHUB_BRANCH_CLEANUP_SWEEP_[A-F0-9]{12}_[A-F0-9]{12}$/);
assert.equal(dryRun.secrets_included, false);
assert.equal(dryRunCalls.some((call) => call.method === "DELETE"), false, "dry-run must not delete refs");

const applyCalls = [];
const apply = await runGithubBranchCleanupSweep({
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  token: "test-token",
  mode: "apply",
  page: 1,
  max_pages: 1,
  scan_limit: 100,
  max_deletes: 10,
  min_age_days: 7,
  now: NOW,
  expected_base_sha: dryRun.base_sha,
  expected_evidence_fingerprint: dryRun.evidence_fingerprint,
  confirm: dryRun.expected_confirm,
  fetchImpl: queuedFetch([
    ...planningResponses(),
    { status: 200, payload: { default_branch: "main" } },
    { status: 200, payload: { object: { sha: OLD_SHA } } },
    { status: 200, payload: [] },
    { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 20 } },
    { status: 200, payload: { object: { sha: OLD_SHA } } },
    { status: 204, payload: {} },
    { status: 404, payload: { message: "Not Found" } },
  ], applyCalls),
});

assert.equal(apply.ok, true);
assert.equal(apply.status, "completed");
assert.equal(apply.applied_delete_count, 1);
assert.equal(apply.deletions[0].branch, "gpt/old-safe");
assert.equal(apply.deletions[0].verified_absent, true);
assert.equal(apply.failures.length, 0);
assert.equal(applyCalls.filter((call) => call.method === "DELETE").length, 1);

const routes = readFileSync("routes/gptToolsRoutes.js", "utf8");
const migration = readFileSync("migrations/1019_sprint69_github_branch_cleanup_sweep.sql", "utf8");
assert.equal((routes.match(/name: "github_branch_cleanup_sweep"/g) || []).length, 1, "cleanup sweep must be registered once");
assert.match(routes, /mode === "apply"/);
assert.match(routes, /requireGithubBranchCleanupSweepEnvelope/);
assert.match(routes, /acceptedIntents: \["github_branch_cleanup_sweep", "github_branch_delete", "github_repo_cleanup"/);
assert.match(routes, /runGithubBranchCleanupSweep\(args \|\| \{\}\)/);
assert.match(migration, /github_branch_cleanup_sweep/);
assert.match(migration, /github_list_branches/);
assert.match(migration, /github_list_pull_requests/);
assert.match(migration, /github_compare_commits/);
assert.match(migration, /github_delete_reference/);
assert.match(migration, /max_deletes/);
assert.match(migration, /force_delete_allowed/);

console.log("github branch cleanup sweep guard passed");
