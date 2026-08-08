import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveExactPlatformAuthorityExecutionScope } from "./scripts/capability-resolution-dry-run.mjs";
import { buildDryRunArgs, buildBindingContext } from "./scripts/capability-resolution-envelope-create.mjs";
import { resolveCapabilityExecutionEnvelope } from "./capabilityResolutionEnvelopeGuard.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const BRANCH_A = "gpt/019-governed-database-lifecycle-pressure-relief-20260807";
const BRANCH_B = "gpt/other-branch";
const EXACT_REPO = "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";

const bindings = [
  { binding_id: "binding-a", branch: BRANCH_A, expected_commit_sha: SHA_A },
];

{
  const exact = resolveExactPlatformAuthorityExecutionScope({
    bindings,
    resourceBranch: BRANCH_A,
    expectedCommitSha: SHA_A,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.branch, BRANCH_A);
  assert.equal(exact.expected_commit_sha, SHA_A);
  assert.equal(exact.binding_id, "binding-a");
}

{
  const mismatch = resolveExactPlatformAuthorityExecutionScope({ bindings, resourceBranch: BRANCH_B, expectedCommitSha: SHA_A });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "resource_branch_mismatch");
}

{
  const mismatch = resolveExactPlatformAuthorityExecutionScope({ bindings, resourceBranch: BRANCH_A, expectedCommitSha: SHA_B });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "expected_commit_sha_mismatch");
}

{
  const missing = resolveExactPlatformAuthorityExecutionScope({ bindings, resourceBranch: BRANCH_A });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "expected_commit_sha_missing_or_invalid");
}

{
  const derived = resolveExactPlatformAuthorityExecutionScope({ bindings, expectedCommitSha: SHA_A });
  assert.equal(derived.ok, true);
  assert.equal(derived.branch, BRANCH_A);
}

{
  const ambiguous = resolveExactPlatformAuthorityExecutionScope({
    bindings: [
      ...bindings,
      { binding_id: "binding-b", branch: BRANCH_B, expected_commit_sha: SHA_A },
    ],
    expectedCommitSha: SHA_A,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, "resource_branch_ambiguous");
}

{
  const parsed = buildDryRunArgs([
    "--resource-branch", BRANCH_A,
    "--expected-commit-sha", SHA_A,
    "--resource-uri", EXACT_REPO,
  ]);
  assert.equal(parsed.resourceBranch, BRANCH_A);
  assert.equal(parsed.expectedCommitSha, SHA_A);

  const context = buildBindingContext([
    "--resource-branch", BRANCH_A,
    "--expected-commit-sha", SHA_A,
  ]);
  assert.equal(context.resource_branch, BRANCH_A);
  assert.equal(context.expected_commit_sha, SHA_A);
}

function serviceEnvelopeRow(overrides = {}) {
  return {
    envelope_id: "envelope-branch-scope",
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
    envelope_sha256: "d".repeat(64),
    envelope_json: JSON.stringify({
      request_context: {
        resource_uri: EXACT_REPO,
        resource_branch: BRANCH_A,
        expected_commit_sha: SHA_A,
        principal: { principal_type: "service", principal_id: "platform_admin_service" },
      },
      authority: {
        exact_platform_resource_authority_scope: {
          matched: true,
          binding_id: "binding-a",
          resource_branch: BRANCH_A,
          expected_commit_sha: SHA_A,
          secrets_included: false,
        },
      },
    }),
    ...overrides,
  };
}

function poolFor(row) {
  return {
    async query(sql, params) {
      assert.match(String(sql), /capability_resolution_envelope_ledger/);
      assert.deepEqual(params, ["envelope-branch-scope"]);
      return [[row]];
    },
  };
}

async function dispatchScope(overrides = {}) {
  const row = overrides.row || serviceEnvelopeRow();
  return resolveCapabilityExecutionEnvelope({
    pool: poolFor(row),
    envelopeId: "envelope-branch-scope",
    source: {
      owner: "mad4bdigital-ai",
      repo: "multi-business-multi-role-growth-intelligence-os",
      branch: BRANCH_A,
      expected_base_sha: SHA_A,
      ...(overrides.source || {}),
    },
    acceptedAppKeys: ["github"],
    acceptedCapabilityKeys: ["repo_patch_apply"],
    acceptedIntents: ["repo_patch_apply"],
    expectedTenantId: "tenant-1",
    expectedUserId: overrides.expectedUserId || "",
  });
}

{
  const resolved = await dispatchScope();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.resource_uri, EXACT_REPO);
  assert.equal(resolved.resource_branch, BRANCH_A);
  assert.equal(resolved.expected_commit_sha, SHA_A);
  assert.equal(resolved.principal_id, "platform_admin_service");
}

{
  const failure = await dispatchScope({ source: { branch: BRANCH_B } });
  assert.equal(failure.ok, false);
  assert.equal(failure.status, "capability_resolution_envelope_resource_branch_mismatch");
}

{
  const failure = await dispatchScope({ source: { expected_base_sha: SHA_B } });
  assert.equal(failure.ok, false);
  assert.equal(failure.status, "capability_resolution_envelope_commit_mismatch");
}

{
  const failure = await dispatchScope({ source: { branch: "" } });
  assert.equal(failure.ok, false);
  assert.equal(failure.status, "capability_resolution_envelope_resource_branch_target_unresolved");
}

{
  const failure = await dispatchScope({ expectedUserId: "different-admin-user" });
  assert.equal(failure.ok, false);
  assert.equal(failure.status, "capability_resolution_envelope_user_mismatch");
}

const guard = readFileSync(new URL("./capabilityResolutionEnvelopeGuard.js", import.meta.url), "utf8");
assert.match(guard, /capability_resolution_envelope_resource_branch_mismatch/);
assert.match(guard, /capability_resolution_envelope_commit_mismatch/);
assert.match(guard, /expected_branch_sha/);
assert.match(guard, /expected_base_sha/);
assert.match(guard, /exact_platform_authority_scope_matched/);

console.log("Platform resource authority branch/commit scope regression passed");
