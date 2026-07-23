import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCapabilityExecutionEnvelope } from "./capabilityResolutionEnvelopeGuard.js";

const helper = readFileSync(new URL("./capabilityResolutionEnvelopeGuard.js", import.meta.url), "utf8");
const wordpress = readFileSync(new URL("./wordpressBlogPublishOrchestrator.js", import.meta.url), "utf8");
const hostinger = readFileSync(new URL("./hostingerSshDeployExecutor.js", import.meta.url), "utf8");

assert.match(helper, /export function extractCapabilityEnvelopeId/);
assert.match(helper, /export async function resolveCapabilityExecutionEnvelope/);
assert.match(helper, /capability_resolution_envelope_ledger/);
assert.match(helper, /ready_for_dispatch/);
assert.match(helper, /dispatch_allowed/);
assert.match(helper, /approval_required/);
assert.match(helper, /blocking_gap_count/);
assert.match(helper, /capability_resolution_envelope_commit_mismatch/);
assert.match(helper, /capability_resolution_envelope_workspace_mismatch/);
assert.match(helper, /capability_resolution_envelope_brand_mismatch/);
assert.match(helper, /capability_resolution_envelope_resource_uri_mismatch/);
assert.match(helper, /capability_resolution_envelope_binding_sha256_mismatch/);
assert.match(helper, /capability_resolution_envelope_capability_sha256_mismatch/);
assert.match(helper, /export async function markCapabilityEnvelopeReferenced/);
assert.match(helper, /secrets_included: false/);
assert.doesNotMatch(helper, /decryptToken|value_ciphertext|encrypted_credentials|oauth_token|private_key/i);
assert.doesNotMatch(helper, /fetch\(|axios|child_process|exec\(|spawn\(/);

assert.match(wordpress, /resolveCapabilityExecutionEnvelope/);
assert.match(wordpress, /acceptedAppKeys: \["wordpress_rest"\]/);
assert.match(wordpress, /acceptedIntents/);
assert.match(wordpress, /markCapabilityEnvelopeReferenced\(\{ pool: deps\.pool/);
assert.doesNotMatch(wordpress, /SELECT envelope_id, tenant_id, user_id, app_key, capability_key, operation_intent,[\s\S]*FROM capability_resolution_envelope_ledger/);

assert.match(hostinger, /resolveCapabilityExecutionEnvelope/);
assert.match(hostinger, /capabilityEnvelopeError/);
assert.match(hostinger, /acceptedAppKeys: \["remote_ssh_runtime", "hostinger"\]/);
assert.match(hostinger, /acceptedIntents: \["deploy", "restart", "write", "remote_runtime_deploy", "hostinger_ssh_deploy", "deploy_release"\]/);
assert.match(hostinger, /expectedCommitSha/);
assert.match(hostinger, /markCapabilityEnvelopeReferenced\(\{ pool, envelopeId: envelope\.envelope_id/);
assert.doesNotMatch(hostinger, /SELECT envelope_id, tenant_id, user_id, app_key, capability_key, operation_intent,[\s\S]*FROM capability_resolution_envelope_ledger/);

const expectedCommitSha = "a".repeat(40);
const expectedBindingSha256 = "b".repeat(64);
const expectedCapabilitySha256 = "c".repeat(64);
const expectedResourceUri = "repository-binding://growth_intelligence_platform.github.primary.production";

function envelopeRow(overrides = {}) {
  return {
    envelope_id: "envelope-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    workspace_key: "workspace-key",
    brand_key: "growth_intelligence_platform",
    app_key: "github",
    capability_key: "github_repository_main_moved_webhook_provision",
    operation_intent: "github_repository_main_moved_webhook_provision",
    risk_class: "high",
    selected_source_tier: "platform_managed_fallback",
    selected_runtime_surface: "system_layer",
    authority_status: "passed",
    decision: "ready_for_dispatch",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 1,
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
        resource_uri: expectedResourceUri,
        expected_commit_sha: expectedCommitSha,
        binding_sha256: expectedBindingSha256,
        capability_sha256: expectedCapabilitySha256,
      },
    }),
    ...overrides,
  };
}

function poolFor(row) {
  return {
    async query(sql, params) {
      assert.match(sql, /FROM capability_resolution_envelope_ledger/);
      assert.deepEqual(params, ["envelope-1"]);
      return [[row]];
    },
  };
}

async function resolveWith({ row = envelopeRow(), ...overrides } = {}) {
  return resolveCapabilityExecutionEnvelope({
    pool: poolFor(row),
    envelopeId: "envelope-1",
    acceptedAppKeys: ["github"],
    acceptedCapabilityKeys: ["github_repository_main_moved_webhook_provision"],
    acceptedIntents: ["github_repository_main_moved_webhook_provision"],
    expectedTenantId: "tenant-1",
    expectedUserId: "user-1",
    expectedWorkspaceId: "workspace-1",
    expectedBrandKey: "growth_intelligence_platform",
    expectedResourceUri,
    expectedCommitSha,
    expectedBindingSha256,
    expectedCapabilitySha256,
    requireCommitHint: true,
    allowReferenced: false,
    ...overrides,
  });
}

{
  const resolved = await resolveWith();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.workspace_id, "workspace-1");
  assert.equal(resolved.brand_key, "growth_intelligence_platform");
  assert.equal(resolved.resource_uri, expectedResourceUri);
  assert.equal(resolved.expected_commit_sha, expectedCommitSha);
  assert.equal(resolved.binding_sha256, expectedBindingSha256);
  assert.equal(resolved.capability_sha256, expectedCapabilitySha256);
  assert.equal(resolved.secrets_included, false);
}

{
  const failure = await resolveWith({ expectedWorkspaceId: "workspace-other" });
  assert.equal(failure.status, "capability_resolution_envelope_workspace_mismatch");
}
{
  const failure = await resolveWith({ expectedBrandKey: "brand-other" });
  assert.equal(failure.status, "capability_resolution_envelope_brand_mismatch");
}
{
  const failure = await resolveWith({ expectedResourceUri: "repository-binding://other" });
  assert.equal(failure.status, "capability_resolution_envelope_resource_uri_mismatch");
}
{
  const failure = await resolveWith({ expectedBindingSha256: "0".repeat(64) });
  assert.equal(failure.status, "capability_resolution_envelope_binding_sha256_mismatch");
}
{
  const failure = await resolveWith({ expectedCapabilitySha256: "0".repeat(64) });
  assert.equal(failure.status, "capability_resolution_envelope_capability_sha256_mismatch");
}
{
  const row = envelopeRow({ envelope_json: JSON.stringify({ request_context: {
    resource_uri: expectedResourceUri,
    binding_sha256: expectedBindingSha256,
    capability_sha256: expectedCapabilitySha256,
  } }) });
  const failure = await resolveWith({ row });
  assert.equal(failure.status, "capability_resolution_envelope_commit_mismatch");
  assert.equal(failure.commit_hint_required, true);
}

console.log("Capability resolution shared envelope guard tests passed");
