import assert from "node:assert/strict";
import {
  applyGithubExistingBlobChangeSet,
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
const NEW_TREE_SHA = "2".repeat(40);
const BLOB_SHA = "e".repeat(40);
const PATCH_BLOB_SHA = "1".repeat(40);

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

function authorityHarness({ branch, expectedSha }) {
  const slug = branch.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 32);
  const envelopeId = `envelope-${slug}`;
  const bindingId = `binding-${slug}`;
  const resourceUri = `github://${OWNER}/${REPO}`;
  const envelopeRow = {
    envelope_id: envelopeId,
    tenant_id: "tenant-1",
    user_id: "platform_admin_service",
    workspace_id: "workspace-1",
    workspace_key: "workspace-key",
    brand_key: null,
    app_key: "github",
    capability_key: "repo_patch_apply",
    operation_intent: "repo_patch_apply",
    risk_class: "high",
    selected_source_tier: "platform_managed_fallback",
    selected_runtime_surface: "repo_patch_batch_apply",
    authority_status: "passed",
    decision: "ready_for_dispatch",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 0,
    approval_required: 0,
    quota_required: 1,
    audit_required: 1,
    readback_required: 1,
    blocking_gap_count: 0,
    execution_status: "not_executed",
    expires_at: "2099-01-01T00:00:00.000Z",
    secrets_included: 0,
    envelope_sha256: "9".repeat(64),
    envelope_json: JSON.stringify({
      request_context: {
        resource_type: "github_repo",
        resource_uri: resourceUri,
        resource_branch: branch,
        expected_commit_sha: expectedSha,
        recipe_key: "repo_patch_batch_apply",
        operation_mode: "atomic_change_set",
        principal: { principal_type: "service", principal_id: "platform_admin_service" },
      },
      authority: {
        exact_platform_resource_authority_scope: {
          matched: true,
          binding_id: bindingId,
          resource_branch: branch,
          expected_commit_sha: expectedSha,
          secrets_included: false,
        },
      },
    }),
  };
  const liveBinding = {
    binding_id: bindingId,
    tenant_id: "tenant-1",
    workspace_id: "workspace-1",
    user_id: "platform_admin_service",
    resource_type: "github_repo",
    resource_uri: resourceUri,
    resource_ref_json: JSON.stringify({
      branch,
      expected_commit_sha: expectedSha,
      principal: { principal_type: "service", principal_id: "platform_admin_service" },
    }),
    recipe_key: "repo_patch_batch_apply",
    permission_level: "patch",
    allowed_modes_json: JSON.stringify(["atomic_change_set"]),
    authority_source: "test_fixture",
    status: "active",
    expires_at: null,
    created_at: "2026-08-08T00:00:00.000Z",
  };
  return {
    capability_envelope_id: envelopeId,
    pool: {
      async query(sql, params) {
        const statement = String(sql);
        if (/capability_resolution_envelope_ledger/.test(statement)) {
          assert.equal(Array.isArray(params), true);
          assert.equal(params.length, 1);
          assert.equal(String(params[0]), envelopeId);
          return [[envelopeRow]];
        }
        if (/FROM platform_resource_authority_bindings/.test(statement)) {
          assert.equal(Array.isArray(params), true);
          assert.equal(params.length, 1);
          assert.equal(String(params[0]), bindingId);
          return [[liveBinding]];
        }
        throw new Error(`Unexpected authority SQL: ${statement.slice(0, 120)}`);
      },
    },
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
  const calls = [];
  const sleepCalls = [];
  const branch = "gpt/delayed-delete-readback";
  const result = await deleteGithubBranchRef({
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    token: "test-token",
    branch,
    expected_head_sha: HEAD_SHA,
    confirm: githubBranchDeleteConfirmation(branch),
    branch_delete_readback_attempts: 3,
    branch_delete_readback_delay_ms: 1,
    sleep_impl: async (delayMs) => { sleepCalls.push(delayMs); },
    fetchImpl: queuedFetch([
      { status: 200, payload: { default_branch: "main" } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: [] },
      { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 4 } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 204, payload: {} },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 404, payload: { message: "Not Found" } },
    ], calls),
  });
  assert.equal(result.deleted, true);
  assert.equal(result.verified_absent, true);
  assert.deepEqual(sleepCalls, [1, 2]);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 1, "delayed readback must not repeat DELETE");
}

{
  const calls = [];
  const branch = "gpt/delete-readback-timeout";
  await assert.rejects(
    () => deleteGithubBranchRef({
      owner: OWNER,
      repo: REPO,
      default_branch: "main",
      token: "test-token",
      branch,
      expected_head_sha: HEAD_SHA,
      confirm: githubBranchDeleteConfirmation(branch),
      branch_delete_readback_attempts: 3,
      branch_delete_readback_delay_ms: 0,
      fetchImpl: queuedFetch([
        { status: 200, payload: { default_branch: "main" } },
        { status: 200, payload: { object: { sha: HEAD_SHA } } },
        { status: 200, payload: [] },
        { status: 200, payload: { status: "behind", ahead_by: 0, behind_by: 4 } },
        { status: 200, payload: { object: { sha: HEAD_SHA } } },
        { status: 204, payload: {} },
        { status: 200, payload: { object: { sha: HEAD_SHA } } },
        { status: 200, payload: { object: { sha: HEAD_SHA } } },
        { status: 200, payload: { object: { sha: HEAD_SHA } } },
      ], calls),
    }),
    (error) => error.code === "github_branch_delete_readback_failed"
      && error.details?.readback_attempts === 3
      && error.details?.max_readback_attempts === 3
  );
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 1, "failed readback retries must not repeat DELETE");
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
  const branch = "gpt/atomic-change-set";
  const result = await applyGithubRepositoryChangeSet({
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    token: "test-token",
    branch,
    expected_base_sha: BASE_SHA,
    commit_message: "fix: apply one atomic change set",
    changes: [
      { action: "write_file", path: "http-generic-api/example.js", content: "export const ok = true;\n" },
      { action: "delete_file", path: "http-generic-api/obsolete.js" },
      {
        action: "apply_unified_diff",
        path: "http-generic-api/config.js",
        diff: "@@ -1,2 +1,2 @@\n export const alpha = true;\n-export const beta = false;\n+export const beta = true;",
      },
    ],
    ...authorityHarness({ branch, expectedSha: BASE_SHA }),
    fetchImpl: queuedFetch([
      { status: 200, payload: { object: { sha: BASE_SHA } } },
      { status: 404, payload: { message: "Not Found" } },
      { status: 200, payload: { sha: BASE_SHA, tree: { sha: TREE_SHA } } },
      { status: 200, payload: { type: "file", sha: PATCH_BLOB_SHA, encoding: "base64", content: Buffer.from("export const alpha = true;\nexport const beta = false;\n").toString("base64") } },
      { status: 201, payload: { sha: BLOB_SHA } },
      { status: 201, payload: { sha: PATCH_BLOB_SHA } },
      { status: 201, payload: { sha: NEW_TREE_SHA } },
      { status: 201, payload: { sha: COMMIT_SHA } },
      { status: 201, payload: { ref: "refs/heads/gpt/atomic-change-set", object: { sha: COMMIT_SHA } } },
      { status: 200, payload: { object: { sha: COMMIT_SHA } } },
    ], calls),
  });
  assert.equal(result.commit_sha, COMMIT_SHA);
  assert.equal(result.change_count, 3);
  assert.equal(result.branch_created, true);
  assert.equal(result.readback_verified, true);
  const treeCall = calls.find((call) => call.url.endsWith("/git/trees") && call.method === "POST");
  assert.equal(treeCall.body.tree.length, 3);
  assert.equal(treeCall.body.tree[1].sha, null);
  assert.equal(treeCall.body.tree[2].sha, PATCH_BLOB_SHA);
  assert.equal(result.items[2].action, "apply_unified_diff");
  assert.equal(result.items[2].base_blob_sha, PATCH_BLOB_SHA);
  assert.match(result.items[2].patch_sha256, /^[0-9a-f]{64}$/);
  const blobCalls = calls.filter((call) => call.url.endsWith("/git/blobs") && call.method === "POST");
  assert.equal(blobCalls.length, 2);
  assert.equal(blobCalls[1].body.content, "export const alpha = true;\nexport const beta = true;\n");
  const commitCall = calls.find((call) => call.url.endsWith("/git/commits") && call.method === "POST");
  assert.equal(commitCall.body.tree, NEW_TREE_SHA);
  assert.deepEqual(commitCall.body.parents, [BASE_SHA]);
}

{
  const calls = [];
  await assert.rejects(
    () => applyGithubRepositoryChangeSet({
      owner: OWNER, repo: REPO, default_branch: "main", token: "test-token",
      branch: "gpt/atomic-diff-mismatch", expected_base_sha: BASE_SHA,
      commit_message: "fix: reject mismatched atomic diff",
      changes: [{ action: "apply_unified_diff", path: "http-generic-api/config.js", diff: "@@ -1,2 +1,2 @@\n export const alpha = true;\n-WRONG CONTEXT\n+export const beta = true;" }],
      fetchImpl: queuedFetch([
        { status: 200, payload: { object: { sha: BASE_SHA } } },
        { status: 404, payload: { message: "Not Found" } },
        { status: 200, payload: { sha: BASE_SHA, tree: { sha: TREE_SHA } } },
        { status: 200, payload: { type: "file", sha: PATCH_BLOB_SHA, encoding: "base64", content: Buffer.from("export const alpha = true;\nexport const beta = false;\n").toString("base64") } },
      ], calls),
    }),
    (error) => error.code === "repo_patch_removal_mismatch"
  );
  assert.equal(calls.some((call) => call.method === "POST"), false, "invalid diff must fail before any Git write");
}

{
  const calls = [];
  await assert.rejects(
    () => applyGithubRepositoryChangeSet({
      owner: OWNER, repo: REPO, default_branch: "main", token: "test-token",
      branch: "gpt/atomic-duplicate-path", expected_base_sha: BASE_SHA,
      commit_message: "fix: reject duplicate batch paths",
      changes: [
        { action: "write_file", path: "http-generic-api/config.js", content: "one" },
        { action: "apply_unified_diff", path: "http-generic-api/config.js", diff: "@@ -1 +1 @@\n-one\n+two" },
      ],
      fetchImpl: queuedFetch([], calls),
    }),
    (error) => error.code === "github_change_set_duplicate_path"
  );
  assert.equal(calls.length, 0, "duplicate paths must fail before GitHub reads or writes");
}

{
  const calls = [];
  const docsTreeSha = "f".repeat(40);
  const branch = "gpt/existing-blob-change-set";
  const result = await applyGithubExistingBlobChangeSet({
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    token: "test-token",
    branch,
    expected_head_sha: HEAD_SHA,
    commit_message: "fix: reuse existing generated report blob",
    changes: [
      { path: "docs/surface-contract-discovery-status.json", blob_sha: BLOB_SHA },
    ],
    ...authorityHarness({ branch, expectedSha: HEAD_SHA }),
    fetchImpl: queuedFetch([
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: { sha: HEAD_SHA, tree: { sha: TREE_SHA } } },
      { status: 201, payload: { sha: docsTreeSha } },
      { status: 201, payload: { sha: COMMIT_SHA } },
      { status: 200, payload: { object: { sha: HEAD_SHA } } },
      { status: 200, payload: { object: { sha: COMMIT_SHA } } },
      { status: 200, payload: { object: { sha: COMMIT_SHA } } },
      { status: 200, payload: { tree: [{ path: "docs", type: "tree", sha: TREE_SHA }] } },
      { status: 200, payload: { tree: [{ path: "surface-contract-discovery-status.json", type: "blob", sha: BLOB_SHA }] } },
    ], calls),
  });
  assert.equal(result.commit_sha, COMMIT_SHA);
  assert.equal(result.change_count, 1);
  assert.equal(result.force_used, false);
  assert.equal(result.ref_readback_verified, true);
  assert.equal(result.path_readback_verified, true);
  assert.equal(result.items[0].readback_blob_sha, BLOB_SHA);
  const treeCall = calls.find((call) => call.url.endsWith("/git/trees") && call.method === "POST");
  assert.deepEqual(treeCall.body.tree, [{ path: "docs/surface-contract-discovery-status.json", mode: "100644", type: "blob", sha: BLOB_SHA }]);
  const blobCalls = calls.filter((call) => call.url.includes("/git/blobs"));
  assert.equal(blobCalls.length, 0, "existing-blob commit must not upload or download blob content");
  const refUpdate = calls.find((call) => call.url.includes("/git/refs/heads/gpt/existing-blob-change-set") && call.method === "PATCH");
  assert.equal(refUpdate.body.force, false);
}

{
  await assert.rejects(
    () => applyGithubExistingBlobChangeSet({
      owner: OWNER,
      repo: REPO,
      default_branch: "main",
      token: "test-token",
      branch: "gpt/existing-blob-change-set",
      expected_head_sha: HEAD_SHA,
      commit_message: "fix: reject stale existing blob update",
      changes: [{ path: "docs/report.json", blob_sha: BLOB_SHA }],
      fetchImpl: queuedFetch([{ status: 200, payload: { object: { sha: BASE_SHA } } }]),
    }),
    (error) => error.code === "github_existing_blob_head_mismatch"
  );
}

console.log("github repository lifecycle tests passed");