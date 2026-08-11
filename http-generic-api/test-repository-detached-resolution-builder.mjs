import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  branchDetachedResolutionCommitConfirmation,
  runGithubDetachedResolutionCommitCreate,
  validateDetachedResolutionEntries,
} from "./repositoryDetachedResolutionBuilder.js";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const BASE_TREE = "c".repeat(40);
const CREATED_TREE = "d".repeat(40);
const CREATED_COMMIT = "e".repeat(40);
const BLOB = "f".repeat(40);
const branch = "gpt/example-fix";
const confirmation = branchDetachedResolutionCommitConfirmation(branch);

assert.equal(confirmation, "CREATE_DETACHED_RESOLUTION_COMMIT_GPT_EXAMPLE_FIX");
assert.deepEqual(validateDetachedResolutionEntries({
  entries: [{ path: "a.js", mode: "100644", type: "blob", sha: BLOB }],
  branch_changed_files: ["a.js"],
}), [{ path: "a.js", mode: "100644", type: "blob", sha: BLOB }]);
assert.throws(() => validateDetachedResolutionEntries({
  entries: [{ path: "a.js", mode: "100644", type: "blob", sha: BLOB }, { path: "extra.js", mode: "100644", type: "blob", sha: BLOB }],
  branch_changed_files: ["a.js"],
}), (error) => error?.code === "github_detached_resolution_file_scope_mismatch");
assert.throws(() => validateDetachedResolutionEntries({
  entries: [{ path: "a.js", mode: "100644", type: "blob", sha: BLOB }],
  branch_changed_files: ["a.js", "missing.js"],
}), (error) => error?.code === "github_detached_resolution_file_scope_mismatch");
assert.throws(() => validateDetachedResolutionEntries({
  entries: [{ path: "a.js", mode: "100644", type: "blob", sha: BLOB }, { path: "a.js", mode: "100644", type: "blob", sha: BLOB }],
}), (error) => error?.code === "github_detached_resolution_duplicate_path");
assert.throws(() => validateDetachedResolutionEntries({
  entries: Array.from({ length: 51 }, (_, index) => ({ path: `f-${index}.js`, mode: "100644", type: "blob", sha: BLOB })),
}), (error) => error?.code === "github_detached_resolution_scope_exceeds_limit");
for (const path of ["../a.js", "/a.js", ".git/config", "a\\b.js"]) {
  assert.throws(() => validateDetachedResolutionEntries({ entries: [{ path, mode: "100644", type: "blob", sha: BLOB }] }), (error) => error?.code === "github_detached_resolution_path_invalid");
}
assert.throws(() => validateDetachedResolutionEntries({ entries: [{ path: "a.js", mode: "120000", type: "blob", sha: BLOB }] }), (error) => error?.code === "github_detached_resolution_mode_invalid");
assert.throws(() => validateDetachedResolutionEntries({ entries: [{ path: "a.js", mode: "100644", type: "tree", sha: BLOB }] }), (error) => error?.code === "github_detached_resolution_type_invalid");
assert.throws(() => validateDetachedResolutionEntries({ entries: [{ path: "a.js", mode: "100644", type: "blob", sha: "bad" }] }), (error) => error?.code === "github_detached_resolution_blob_sha_invalid");

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function makeProvider({ baseSha = BASE, branchSha = HEAD, resolutionFiles = ["a.js"] } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const pathname = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, pathname, body });

    if (method === "GET" && pathname.endsWith("/git/ref/heads/main")) return response({ object: { sha: baseSha } });
    if (method === "GET" && pathname.endsWith("/git/ref/heads/gpt/example-fix")) return response({ object: { sha: branchSha } });
    if (method === "GET" && pathname.includes("/compare/main...gpt%2Fexample-fix")) {
      return response({ status: "diverged", ahead_by: 1, behind_by: 1, files: [{ filename: "a.js" }] });
    }
    if (method === "GET" && pathname.includes("/compare/gpt%2Fexample-fix...main")) {
      return response({ status: "diverged", ahead_by: 1, behind_by: 1, files: [{ filename: "a.js" }] });
    }
    if (method === "GET" && pathname.endsWith(`/git/commits/${BASE}`)) return response({ sha: BASE, tree: { sha: BASE_TREE }, parents: [] });
    if (method === "POST" && pathname.endsWith("/git/trees")) return response({ sha: CREATED_TREE }, 201);
    if (method === "POST" && pathname.endsWith("/git/commits")) return response({ sha: CREATED_COMMIT }, 201);
    if (method === "GET" && pathname.endsWith(`/git/commits/${CREATED_COMMIT}`)) {
      return response({ sha: CREATED_COMMIT, tree: { sha: CREATED_TREE }, parents: [{ sha: BASE }] });
    }
    if (method === "GET" && pathname.includes(`/compare/${BASE}...${CREATED_COMMIT}`)) {
      return response({ status: "ahead", ahead_by: 1, behind_by: 0, files: resolutionFiles.map((filename) => ({ filename })) });
    }
    throw new Error(`Unexpected provider call: ${method} ${pathname}`);
  };
  return { calls, fetchImpl };
}

function leaseArgs(overrides = {}) {
  return {
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
    branch,
    default_branch: "main",
    recipe_key: "repo.pr.reconcile_and_finalize",
    repository_reconciliation_operation_id: "run-12345678",
    repository_holder_run_id: "run-12345678",
    repository_lease_id: "lease-12345678",
    repository_resource_fingerprint: "1".repeat(64),
    expected_base_sha: BASE,
    expected_branch_sha: HEAD,
    confirm: confirmation,
    entries: [{ path: "a.js", mode: "100644", type: "blob", sha: BLOB }],
    ...overrides,
  };
}

let leaseChecks = 0;
const provider = makeProvider();
const result = await runGithubDetachedResolutionCommitCreate(leaseArgs(), {
  token: "test-token",
  fetchImpl: provider.fetchImpl,
  assertLeaseHolder: async () => {
    leaseChecks += 1;
    assert.equal(provider.calls.length, 0, "lease verification must happen before provider access");
    return { lease_status: "active" };
  },
});
assert.equal(leaseChecks, 1);
assert.equal(result.ok, true);
assert.equal(result.detached, true);
assert.equal(result.resolution.commit_sha, CREATED_COMMIT);
assert.deepEqual(result.resolution.parent_shas, [BASE]);
assert.equal(result.verification.base_ref_unchanged, true);
assert.equal(result.verification.branch_ref_unchanged, true);
assert.equal(result.verification.ref_update_attempted, false);
assert.equal(result.verification.force_push_allowed, false);
const treePost = provider.calls.find((call) => call.method === "POST" && call.pathname.endsWith("/git/trees"));
const commitPost = provider.calls.find((call) => call.method === "POST" && call.pathname.endsWith("/git/commits"));
assert.equal(treePost.body.base_tree, BASE_TREE);
assert.deepEqual(treePost.body.tree, [{ path: "a.js", mode: "100644", type: "blob", sha: BLOB }]);
assert.deepEqual(commitPost.body.parents, [BASE]);
assert.equal(commitPost.body.tree, CREATED_TREE);
assert.equal(provider.calls.some((call) => call.method === "PATCH" || call.method === "DELETE"), false);
assert.equal(provider.calls.some((call) => call.method === "POST" && call.pathname.endsWith("/git/refs")), false);

const staleProvider = makeProvider({ baseSha: "9".repeat(40) });
await assert.rejects(
  () => runGithubDetachedResolutionCommitCreate(leaseArgs(), {
    token: "test-token",
    fetchImpl: staleProvider.fetchImpl,
    assertLeaseHolder: async () => ({ lease_status: "active" }),
  }),
  (error) => error?.code === "github_detached_resolution_stale_ref_evidence"
);
assert.equal(staleProvider.calls.some((call) => call.method === "POST"), false, "stale ref evidence must fail before Git object creation");

let badConfirmationProviderCalls = 0;
await assert.rejects(
  () => runGithubDetachedResolutionCommitCreate(leaseArgs({ confirm: "WRONG" }), {
    token: "test-token",
    fetchImpl: async () => { badConfirmationProviderCalls += 1; throw new Error("must not call provider"); },
    assertLeaseHolder: async () => ({ lease_status: "active" }),
  }),
  (error) => error?.code === "github_detached_resolution_confirmation_required"
);
assert.equal(badConfirmationProviderCalls, 0);

await assert.rejects(
  () => runGithubDetachedResolutionCommitCreate(leaseArgs({ force: true }), {
    token: "test-token",
    fetchImpl: async () => { throw new Error("must not call provider"); },
    assertLeaseHolder: async () => ({ lease_status: "active" }),
  }),
  (error) => error?.code === "github_detached_resolution_force_forbidden"
);

const invalidReadbackProvider = makeProvider({ resolutionFiles: ["a.js", "extra.js"] });
await assert.rejects(
  () => runGithubDetachedResolutionCommitCreate(leaseArgs(), {
    token: "test-token",
    fetchImpl: invalidReadbackProvider.fetchImpl,
    assertLeaseHolder: async () => ({ lease_status: "active" }),
  }),
  (error) => error?.code === "github_detached_resolution_commit_readback_failed" && error?.details?.ref_update_attempted === false
);
assert.equal(invalidReadbackProvider.calls.some((call) => call.method === "PATCH" || call.method === "DELETE"), false);
assert.equal(invalidReadbackProvider.calls.some((call) => call.method === "POST" && call.pathname.endsWith("/git/refs")), false);

const routeSource = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const builderSource = readFileSync(new URL("./repositoryDetachedResolutionBuilder.js", import.meta.url), "utf8");
assert.doesNotMatch(routeSource, /name: "github_detached_resolution_commit_create"/, "detached builder readiness must not expose an Admin tool surface yet");
assert.doesNotMatch(builderSource, /force: true/);
assert.doesNotMatch(builderSource, /apiPath:\s*`?\/git\/refs/);
assert.match(builderSource, /apiPath: "\/git\/trees"/);
assert.match(builderSource, /apiPath: "\/git\/commits"/);
assert.match(builderSource, /parents: \[expectedBaseSha\]/);
assert.match(builderSource, /assertRepositoryReconciliationMergeLease/);
assert.match(builderSource, /validateGithubMergeResolutionEvidence/);
assert.match(builderSource, /ref_update_attempted: false/);

console.log("repository detached resolution builder tests passed");
