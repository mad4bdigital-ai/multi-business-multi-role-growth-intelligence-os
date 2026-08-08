import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRepositoryAuthorityCheckedFetch } from "./githubRepositoryLifecycle.js";

const AUTHORIZED_SHA = "a".repeat(40);
const RESOLVED_PARENT_SHA = "b".repeat(40);
const BRANCH = "fix/authority-resolved-parent";
const REPO_URI = "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const ENVELOPE_ID = "envelope-resolved-parent";
const BINDING_ID = "binding-resolved-parent";

function envelopeRow() {
  return {
    envelope_id: ENVELOPE_ID,
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
    execution_status: "referenced",
    expires_at: "2099-01-01T00:00:00.000Z",
    secrets_included: 0,
    envelope_sha256: "d".repeat(64),
    envelope_json: JSON.stringify({
      request_context: {
        resource_type: "github_repo",
        resource_uri: REPO_URI,
        resource_branch: BRANCH,
        expected_commit_sha: AUTHORIZED_SHA,
        recipe_key: "repo_patch_batch_apply",
        operation_mode: "atomic_change_set",
        principal: { principal_type: "service", principal_id: "platform_admin_service" },
      },
      authority: {
        exact_platform_resource_authority_scope: {
          matched: true,
          binding_id: BINDING_ID,
          resource_branch: BRANCH,
          expected_commit_sha: AUTHORIZED_SHA,
          secrets_included: false,
        },
      },
    }),
  };
}

function liveBinding() {
  return {
    binding_id: BINDING_ID,
    tenant_id: "tenant-1",
    workspace_id: "workspace-1",
    user_id: "platform_admin_service",
    resource_type: "github_repo",
    resource_uri: REPO_URI,
    resource_ref_json: JSON.stringify({
      branch: BRANCH,
      expected_commit_sha: AUTHORIZED_SHA,
      principal: { principal_type: "service", principal_id: "platform_admin_service" },
    }),
    recipe_key: "repo_patch_batch_apply",
    permission_level: "patch",
    allowed_modes_json: JSON.stringify(["atomic_change_set"]),
    authority_source: "test",
    status: "active",
    expires_at: null,
    created_at: "2026-08-08T00:00:00.000Z",
  };
}

let envelopeReads = 0;
let bindingReads = 0;
const providerCalls = [];
const pool = {
  async query(sql, params) {
    const statement = String(sql);
    if (/capability_resolution_envelope_ledger/.test(statement)) {
      envelopeReads += 1;
      assert.deepEqual(params, [ENVELOPE_ID]);
      return [[envelopeRow()]];
    }
    if (/FROM platform_resource_authority_bindings/.test(statement)) {
      bindingReads += 1;
      assert.deepEqual(params, [BINDING_ID]);
      return [[liveBinding()]];
    }
    throw new Error(`Unexpected authority SQL: ${statement.slice(0, 120)}`);
  },
};

const checkedFetch = createRepositoryAuthorityCheckedFetch({
  pool,
  capability_envelope_id: ENVELOPE_ID,
  branch: BRANCH,
  expected_base_sha: AUTHORIZED_SHA,
  fetchImpl: async (url, init = {}) => {
    providerCalls.push({ url: String(url), method: String(init.method || "GET").toUpperCase() });
    return { ok: true, status: 200, async json() { return {}; } };
  },
});

await checkedFetch(
  `https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/commits/${RESOLVED_PARENT_SHA}`,
  { method: "GET" },
);
assert.equal(providerCalls.length, 1, "resolved commit-parent read must remain read-only provider preparation");
assert.equal(providerCalls[0].method, "GET");
assert.equal(envelopeReads, 0, "commit-parent discovery must not consume the first provider-write revalidation");

await assert.rejects(
  () => checkedFetch(
    "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/trees",
    { method: "POST", body: "{}" },
  ),
  (error) => error.code === "capability_resolution_envelope_commit_mismatch"
    && error.details?.write_boundary_phase === "pre_first_provider_write"
    && error.details?.resolved_commit_parent_sha === RESOLVED_PARENT_SHA,
);

assert.equal(envelopeReads, 1, "the first provider mutation must re-read the capability envelope");
assert.equal(bindingReads, 0, "commit-parent mismatch must fail before a stale binding can be treated as live authority");
assert.equal(
  providerCalls.filter((call) => call.method !== "GET").length,
  0,
  "authority for commit X must not transport any provider mutation when the resolved commit parent is Y",
);

const publicLifecycle = readFileSync(new URL("./githubRepositoryLifecycle.js", import.meta.url), "utf8");
const lifecycleCore = readFileSync(new URL("./githubRepositoryLifecycleCore.js", import.meta.url), "utf8");
assert.match(publicLifecycle, /resolvedCommitParentFromPathname/);
assert.match(publicLifecycle, /resolved_commit_parent_sha/);
assert.ok(
  lifecycleCore.includes('apiPath: `/git/commits/${commitParentSha}`'),
  "Core must read the resolved commit parent through the authority-checked transport before provider writes",
);
assert.ok(
  lifecycleCore.includes("parents: [commitParentSha]"),
  "Core must create the Git commit from the same resolved commit parent captured by the authority boundary",
);

console.log("Repository resolved commit-parent authority boundary regression passed");
