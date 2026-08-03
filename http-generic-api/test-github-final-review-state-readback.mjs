import assert from "node:assert/strict";
import {
  finalizeGithubPullRequest,
  githubPullRequestFinalizeConfirmation,
} from "./githubRepositoryLifecycle.js";

const OWNER = "mad4bdigital-ai";
const REPO = "growth-os";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);
const STALE_SHA = "d".repeat(40);

function response(status, payload = {}) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function queuedFetch(entries, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    const next = entries.shift();
    assert(next, `Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    return response(next.status, next.payload);
  };
}

function checks() {
  return ["Syntax Check", "Architecture Drift Detection", "Execution Resolver Gate", "Unit & Integration Tests"].map((name, index) => ({
    name,
    status: "completed",
    conclusion: "success",
    completed_at: `2026-08-04T00:0${index}:00Z`,
  }));
}

function gate(pullNumber) {
  return [
    { status: 200, payload: { number: pullNumber, draft: false, mergeable: true, mergeable_state: "clean", base: { ref: "main", sha: BASE_SHA }, head: { ref: "gpt/final-review", sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
    { status: 200, payload: { status: "ahead", ahead_by: 1, behind_by: 0 } },
    { status: 200, payload: { total_count: 4, check_runs: checks() } },
  ];
}

function pr(pullNumber) {
  return { status: 200, payload: { number: pullNumber, state: "open", draft: false, user: { login: "author", type: "User" }, base: { ref: "main", sha: BASE_SHA }, head: { ref: "gpt/final-review", sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } };
}

function review(id, state, login, commitId = HEAD_SHA, submittedAt = "2026-08-04T00:10:00Z") {
  return { id, state, commit_id: commitId, submitted_at: submittedAt, user: { login, type: "User" } };
}

function options(pullNumber, calls, entries, extra = {}) {
  return {
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    token: "test-token",
    pull_number: pullNumber,
    expected_head_sha: HEAD_SHA,
    expected_base_sha: BASE_SHA,
    confirm: githubPullRequestFinalizeConfirmation(pullNumber, HEAD_SHA),
    delete_branch: false,
    fetchImpl: queuedFetch(entries, calls),
    ...extra,
  };
}

function mergeReached(calls) {
  return calls.some((call) => call.method === "PUT" && /\/merge$/.test(call.url));
}

{
  const pullNumber = 58720;
  const calls = [];
  const result = await finalizeGithubPullRequest(options(pullNumber, calls, [
    ...gate(pullNumber),
    pr(pullNumber),
    { status: 200, payload: [review(1, "APPROVED", "reviewer-a")] },
    pr(pullNumber),
    { status: 200, payload: [review(2, "APPROVED", "reviewer-a", HEAD_SHA, "2026-08-04T00:11:00Z")] },
    { status: 200, payload: { merged: true, sha: MERGE_SHA, message: "merged" } },
    { status: 200, payload: { object: { sha: MERGE_SHA } } },
    { status: 200, payload: { status: "identical", ahead_by: 0, behind_by: 0 } },
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.approval_evidence.approved_reviewers[0].review_id, 2);
  assert.equal(calls.filter((call) => call.url.includes("/reviews?per_page=100")).length, 2);
  assert.equal(mergeReached(calls), true);
}

{
  const pullNumber = 58721;
  const calls = [];
  await assert.rejects(
    () => finalizeGithubPullRequest(options(pullNumber, calls, [
      ...gate(pullNumber),
      pr(pullNumber),
      { status: 200, payload: [review(10, "APPROVED", "reviewer-a")] },
      pr(pullNumber),
      { status: 200, payload: [
        review(10, "APPROVED", "reviewer-a"),
        review(11, "DISMISSED", "reviewer-a", HEAD_SHA, "2026-08-04T00:12:00Z"),
      ] },
    ])),
    (error) => error.code === "github_pr_finalize_approval_required"
      && error.details?.validation_phase === "final_pre_merge_review_readback"
      && error.details?.ignored?.dismissed === 1,
  );
  assert.equal(mergeReached(calls), false);
}

{
  const pullNumber = 58722;
  const calls = [];
  await assert.rejects(
    () => finalizeGithubPullRequest(options(pullNumber, calls, [
      ...gate(pullNumber),
      pr(pullNumber),
      { status: 200, payload: [review(20, "APPROVED", "reviewer-a")] },
      pr(pullNumber),
      { status: 200, payload: [
        review(20, "APPROVED", "reviewer-a"),
        review(21, "CHANGES_REQUESTED", "reviewer-b", HEAD_SHA, "2026-08-04T00:13:00Z"),
      ] },
    ])),
    (error) => error.code === "github_pr_finalize_changes_requested"
      && error.details?.validation_phase === "final_pre_merge_review_readback",
  );
  assert.equal(mergeReached(calls), false);
}

{
  const pullNumber = 58723;
  const calls = [];
  await assert.rejects(
    () => finalizeGithubPullRequest(options(pullNumber, calls, [
      ...gate(pullNumber),
      pr(pullNumber),
      { status: 200, payload: [review(30, "APPROVED", "reviewer-a"), review(31, "APPROVED", "reviewer-b")] },
      pr(pullNumber),
      { status: 200, payload: [
        review(30, "APPROVED", "reviewer-a"),
        review(31, "DISMISSED", "reviewer-b", HEAD_SHA, "2026-08-04T00:14:00Z"),
        review(32, "APPROVED", "reviewer-c", STALE_SHA, "2026-08-04T00:15:00Z"),
      ] },
    ], { required_approvals: 2 })),
    (error) => error.code === "github_pr_finalize_approval_required"
      && error.details?.validation_phase === "final_pre_merge_review_readback"
      && error.details?.exact_head_approval_count === 1
      && error.details?.ignored?.stale_head === 1,
  );
  assert.equal(mergeReached(calls), false);
}

{
  const pullNumber = 58724;
  const calls = [];
  const unbounded = Array.from({ length: 100 }, (_, index) => review(1000 + index, "APPROVED", `reviewer-${index}`));
  await assert.rejects(
    () => finalizeGithubPullRequest(options(pullNumber, calls, [
      ...gate(pullNumber),
      pr(pullNumber),
      { status: 200, payload: [review(40, "APPROVED", "reviewer-a")] },
      pr(pullNumber),
      { status: 200, payload: unbounded },
    ])),
    (error) => error.code === "github_pr_finalize_review_set_unbounded"
      && error.details?.validation_phase === "final_pre_merge_review_readback"
      && error.details?.returned_review_count === 100,
  );
  assert.equal(mergeReached(calls), false);
}

console.log("github final review-state readback tests passed");
