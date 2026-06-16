import assert from "node:assert/strict";
import {
  applyGithubRepositoryChangeSet,
  closeGithubPullRequest,
  deleteGithubBranchRef,
  finalizeGithubPullRequest,
  getGithubPullRequestCiGate,
  githubBranchDeleteConfirmation,
  githubPullRequestFinalizeConfirmation,
} from "./githubRepositoryLifecycle.js";

const OWNER = "mad4bdigital-ai";
const REPO = "growth-os";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const COMMIT_SHA = "c".repeat(40);
const TREE_SHA = "d".repeat(40);
const BLOB_SHA = "e".repeat(40);

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

{
  const calls = [];
  const branch = "gpt/closed-pr-cleanup";
  const result = await deleteGithubBranchRef({
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    token: "test-token",
    branch,
    expected_head_sha: HEAD_SHA,
    confirm: githubBranchDeleteConfirmation(branch),
    fetchImpl: queuedFetch([
      { status: 200, payload: { default_branch: "main" } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: [] },
      { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 4 } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 204, payload: {} },
      { status: 404, payload: { message: "Not Found" } },
    ], calls),
  });
  assert.equal(result.deleted, true);
  assert.equal(result.verified_absent, true);
  assert.equal(result.default_branch, "main");
  assert.equal(result.safety_evidence.unique_commits, 0);
  assert.equal(calls[5].method, "DELETE");
  assert.match(calls[5].url, /git\/refs\/heads\/gpt\/closed-pr-cleanup/);
}

{
  await assert.rejects(
    () => deleteGithubBranchRef({
      owner: OWNER,
      repo: REPO,
      token: "test-token",
      branch: "gpt/changed",
      expected_head_sha: HEAD_SHA,
      confirm: githubBranchDeleteConfirmation("gpt/changed"),
      fetchImpl: queuedFetch([
        { status: 200, payload: { default_branch: "main" } },
        { status: 200, payload: { object: { sha: BASE_SHA } } },
      ]),
    }),
    (error) => error.code === "github_branch_delete_sha_mismatch"
  );
}

{
  await assert.rejects(
    () => deleteGithubBranchRef({
      owner: OWNER,
      repo: REPO,
      token: "test-token",
      branch: "main",
      expected_head_sha: HEAD_SHA,
      confirm: githubBranchDeleteConfirmation("main"),
      fetchImpl: queuedFetch([{ status: 200, payload: { default_branch: "main" } }]),
    }),
    (error) => error.code === "github_branch_delete_protected"
  );
}


{
  await assert.rejects(
    () => deleteGithubBranchRef({
      owner: OWNER,
      repo: REPO,
      default_branch: "main",
      token: "test-token",
      branch: "gpt/contains-valid-work",
      expected_head_sha: HEAD_SHA,
      confirm: githubBranchDeleteConfirmation("gpt/contains-valid-work"),
      fetchImpl: queuedFetch([
        { status: 200, payload: { default_branch: "main" } },
        { status: 200, payload: { object: { sha: HEAD_SHA } } },
        { status: 200, payload: [] },
        { status: 200, payload: { status: "diverged", ahead_by: 2, behind_by: 9 } },
      ]),
    }),
    (error) => error.code === "github_branch_delete_contains_unique_commits"
      && error.details?.unique_commits === 2
  );
}

{
  await assert.rejects(
    () => deleteGithubBranchRef({
      owner: OWNER,
      repo: REPO,
      default_branch: "main",
      token: "test-token",
      branch: "trunk",
      allowed_prefixes: [],
      expected_head_sha: HEAD_SHA,
      confirm: githubBranchDeleteConfirmation("trunk"),
      fetchImpl: queuedFetch([{ status: 200, payload: { default_branch: "trunk" } }]),
    }),
    (error) => error.code === "github_branch_delete_protected"
      && error.details?.default_branch === "trunk"
  );
}

{
  await assert.rejects(
    () => deleteGithubBranchRef({
      owner: OWNER,
      repo: REPO,
      default_branch: "main",
      token: "test-token",
      branch: "docs-agent/race-after-validation",
      expected_head_sha: HEAD_SHA,
      confirm: githubBranchDeleteConfirmation("docs-agent/race-after-validation"),
      fetchImpl: queuedFetch([
        { status: 200, payload: { default_branch: "main" } },
        { status: 200, payload: { object: { sha: HEAD_SHA } } },
        { status: 200, payload: [] },
        { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 5 } },
        { status: 200, payload: { object: { sha: BASE_SHA } } },
      ]),
    }),
    (error) => error.code === "github_branch_delete_sha_mismatch"
      && error.details?.validation_phase === "pre_delete_readback"
  );
}

{
  const branch = "gpt/pr-close-success";
  const result = await closeGithubPullRequest({
    owner: OWNER,
    repo: REPO,
    token: "test-token",
    pull_number: 1570,
    delete_branch: true,
    fetchImpl: queuedFetch([
      { status: 200, payload: { number: 1570, html_url: "https://example/pr/1570", head: { ref: branch, sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
      { status: 200, payload: { number: 1570, state: "closed" } },
      { status: 200, payload: { default_branch: "main" } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: [] },
      { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 2 } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 204, payload: {} },
      { status: 404, payload: { message: "Not Found" } },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.pull_request.state, "closed");
  assert.equal(result.branch_cleanup.verified_absent, true);
}

{
  const branch = "gpt/pr-close-partial";
  const result = await closeGithubPullRequest({
    owner: OWNER,
    repo: REPO,
    token: "test-token",
    pull_number: 1571,
    delete_branch: true,
    fetchImpl: queuedFetch([
      { status: 200, payload: { number: 1571, head: { ref: branch, sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
      { status: 200, payload: { number: 1571, state: "closed" } },
      { status: 200, payload: { default_branch: "main" } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: [{ number: 2000 }] },
    ]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "partial_success");
  assert.equal(result.pull_request.state, "closed");
  assert.equal(result.branch_cleanup.error.code, "github_branch_delete_open_pr");
}

{
  const checks = [
    "Syntax Check",
    "Architecture Drift Detection",
    "Execution Resolver Gate",
    "Unit & Integration Tests",
  ].map((name, index) => ({
    name,
    status: "completed",
    conclusion: "success",
    completed_at: `2026-06-14T00:0${index}:00Z`,
    html_url: `https://example/check/${index}`,
  }));
  const result = await getGithubPullRequestCiGate({
    owner: OWNER,
    repo: REPO,
    token: "test-token",
    pull_number: 1584,
    fetchImpl: queuedFetch([
      { status: 200, payload: { number: 1584, mergeable: true, mergeable_state: "clean", base: { ref: "main", sha: BASE_SHA }, head: { ref: "gpt/fix", sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
      { status: 200, payload: { status: "ahead", ahead_by: 5, behind_by: 0 } },
      { status: 200, payload: { total_count: 4, check_runs: checks } },
    ]),
  });
  assert.equal(result.gate_status, "pass");
  assert.equal(result.base_is_fresh, true);
  assert.equal(result.successful_check_count, 4);
  assert.deepEqual(result.failed_checks, []);
}

{
  const calls = [];
  const branch = "gpt/finalize-success";
  const pullNumber = 1585;
  const checks = [
    "Syntax Check",
    "Architecture Drift Detection",
    "Execution Resolver Gate",
    "Unit & Integration Tests",
  ].map((name, index) => ({
    name,
    status: "completed",
    conclusion: "success",
    completed_at: `2026-06-14T01:0${index}:00Z`,
  }));
  const result = await finalizeGithubPullRequest({
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    token: "test-token",
    pull_number: pullNumber,
    expected_head_sha: HEAD_SHA,
    expected_base_sha: BASE_SHA,
    confirm: githubPullRequestFinalizeConfirmation(pullNumber, HEAD_SHA),
    merge_method: "squash",
    delete_branch: true,
    fetchImpl: queuedFetch([
      { status: 200, payload: { number: pullNumber, mergeable: true, mergeable_state: "clean", base: { ref: "main", sha: BASE_SHA }, head: { ref: branch, sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
      { status: 200, payload: { status: "ahead", ahead_by: 7, behind_by: 0 } },
      { status: 200, payload: { total_count: 4, check_runs: checks } },
      { status: 200, payload: { number: pullNumber, base: { ref: "main", sha: BASE_SHA }, head: { ref: branch, sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
      { status: 200, payload: { merged: true, sha: COMMIT_SHA, message: "merged" } },
      { status: 200, payload: { object: { sha: COMMIT_SHA } } },
      { status: 200, payload: { status: "identical", ahead_by: 0, behind_by: 0 } },
      { status: 200, payload: { default_branch: "main" } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: [] },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 204, payload: {} },
      { status: 404, payload: { message: "Not Found" } },
    ], calls),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.merge_sha, COMMIT_SHA);
  assert.equal(result.merge_method, "squash");
  assert.equal(result.ci_gate.gate_status, "pass");
  assert.equal(result.ancestry_readback.verified, true);
  assert.equal(result.branch_cleanup.verified_absent, true);
  const mergeCall = calls.find((call) => call.url.endsWith(`/pulls/${pullNumber}/merge`));
  assert.equal(mergeCall.method, "PUT");
  assert.equal(mergeCall.body.sha, HEAD_SHA);
  assert.equal(mergeCall.body.merge_method, "squash");
  const deleteIndex = calls.findIndex((call) => call.method === "DELETE");
  const ancestryIndex = calls.findIndex((call) => call.url.includes(`/compare/${COMMIT_SHA}...${COMMIT_SHA}`));
  assert(ancestryIndex >= 0 && deleteIndex > ancestryIndex, "branch cleanup must happen only after ancestry readback");
}

{
  await assert.rejects(
    () => finalizeGithubPullRequest({
      owner: OWNER,
      repo: REPO,
      token: "test-token",
      pull_number: 1586,
      expected_head_sha: HEAD_SHA,
      expected_base_sha: BASE_SHA,
      confirm: "WRONG",
      fetchImpl: queuedFetch([]),
    }),
    (error) => error.code === "github_pr_finalize_confirmation_required"
  );
}

{
  const calls = [];
  const result = await applyGithubRepositoryChangeSet({
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    token: "test-token",
    branch: "gpt/atomic-change-set",
    expected_base_sha: BASE_SHA,
    commit_message: "fix: apply one atomic change set",
    changes: [
      { action: "write_file", path: "http-generic-api/example.js", content: "export const ok = true;\n" },
      { action: "delete_file", path: "http-generic-api/obsolete.js" },
    ],
    fetchImpl: queuedFetch([
      { status: 200, payload: { object: { sha: BASE_SHA } } },
      { status: 404, payload: { message: "Not Found" } },
      { status: 200, payload: { sha: BASE_SHA, tree: { sha: TREE_SHA } } },
      { status: 201, payload: { sha: BLOB_SHA } },
      { status: 201, payload: { sha: TREE_SHA } },
      { status: 201, payload: { sha: COMMIT_SHA } },
      { status: 201, payload: { ref: "refs/heads/gpt/atomic-change-set", object: { sha: COMMIT_SHA } } },
      { status: 200, payload: { object: { sha: COMMIT_SHA } } },
    ], calls),
  });
  assert.equal(result.commit_sha, COMMIT_SHA);
  assert.equal(result.change_count, 2);
  assert.equal(result.branch_created, true);
  assert.equal(result.readback_verified, true);
  const treeCall = calls.find((call) => call.url.endsWith("/git/trees") && call.method === "POST");
  assert.equal(treeCall.body.tree.length, 2);
  assert.equal(treeCall.body.tree[1].sha, null);
  const commitCall = calls.find((call) => call.url.endsWith("/git/commits") && call.method === "POST");
  assert.deepEqual(commitCall.body.parents, [BASE_SHA]);
}

console.log("github repository lifecycle tests passed");
